-- ==============================================================================
-- MIGRATION: ATOMIC PAYMENT CONFIRMATION, STOCK INTEGRITY & TENANT SAFETY
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- 1. Ensure Partial Unique Index exists on successful payments per order
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_successful_payment_per_order 
ON public.payments (order_id) 
WHERE status = 'success';

-- 2. Atomic Payment Confirmation & Stock Finalization Procedure
CREATE OR REPLACE FUNCTION public.confirm_order_payment(
    p_organization_id VARCHAR(50),
    p_order_id UUID,
    p_paystack_reference VARCHAR(150),
    p_amount_paid NUMERIC(10, 2),
    p_currency VARCHAR(10),
    p_channel VARCHAR(50),
    p_paystack_response JSONB,
    p_paid_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB AS $$
DECLARE
    v_order RECORD;
    v_payment RECORD;
    v_res RECORD;
    v_on_hand INTEGER;
    v_reserved INTEGER;
    v_payment_id UUID;
    v_items_finalized INTEGER := 0;
BEGIN
    -- 1. Lock the order row FOR UPDATE to serialize operations
    SELECT id, organization_id, customer_id, total_amount, currency, payment_status, fulfillment_status, order_number
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Order % not found for organization %', p_order_id, p_organization_id;
    END IF;

    -- 2. Check Idempotency: If already marked paid, return existing payment details
    IF v_order.payment_status = 'paid' THEN
        SELECT id, amount_paid, currency INTO v_payment
        FROM public.payments
        WHERE order_id = p_order_id AND status = 'success'
        LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'payment_id', v_payment.id,
            'order_id', p_order_id,
            'order_number', v_order.order_number,
            'amount_paid', v_payment.amount_paid,
            'currency', v_payment.currency
        );
    END IF;

    -- 3. Currency and Financial Integrity Verifications
    IF UPPER(p_currency) != UPPER(v_order.currency) THEN
        RAISE EXCEPTION 'Currency mismatch for order %: expected %, got %',
            p_order_id, v_order.currency, p_currency;
    END IF;

    IF p_amount_paid < v_order.total_amount THEN
        RAISE EXCEPTION 'Payment amount mismatch for order %: expected at least %, got %',
            p_order_id, v_order.total_amount, p_amount_paid;
    END IF;

    -- 4. Finalize Stock: Deduct inventory for all items on this order
    FOR v_res IN 
        SELECT id, organization_id, jersey_id, size, quantity, status
        FROM public.stock_reservations
        WHERE order_id = p_order_id
        ORDER BY jersey_id, size
        FOR UPDATE
    LOOP
        SELECT quantity_on_hand, quantity_reserved
        INTO v_on_hand, v_reserved
        FROM public.jersey_inventory
        WHERE jersey_id = v_res.jersey_id AND size = v_res.size
        FOR UPDATE;

        IF v_res.status = 'active' THEN
            IF v_on_hand < v_res.quantity OR v_reserved < v_res.quantity THEN
                RAISE EXCEPTION 'Stock integrity failure on reservation %: on_hand=%, reserved=%, requested=%',
                    v_res.id, v_on_hand, v_reserved, v_res.quantity;
            END IF;

            UPDATE public.jersey_inventory
            SET quantity_on_hand = quantity_on_hand - v_res.quantity,
                quantity_reserved = quantity_reserved - v_res.quantity,
                updated_at = NOW()
            WHERE jersey_id = v_res.jersey_id AND size = v_res.size;

            UPDATE public.stock_reservations
            SET status = 'finalized', finalized_at = NOW(), updated_at = NOW()
            WHERE id = v_res.id;

            INSERT INTO public.inventory_movements (
                organization_id, jersey_id, size, movement_type, quantity_delta,
                quantity_on_hand_before, quantity_on_hand_after,
                quantity_reserved_before, quantity_reserved_after,
                order_id, reservation_id, actor, reason
            ) VALUES (
                p_organization_id, v_res.jersey_id, v_res.size, 'purchase', -v_res.quantity,
                v_on_hand, v_on_hand - v_res.quantity, v_reserved, v_reserved - v_res.quantity,
                p_order_id, v_res.id, 'paystack_webhook', 'Order payment confirmed'
            );

            v_items_finalized := v_items_finalized + 1;

        ELSIF v_res.status IN ('expired', 'released') THEN
            -- Reservation expired during checkout, but customer paid. Deduct directly from on_hand if available.
            IF v_on_hand < v_res.quantity THEN
                RAISE EXCEPTION 'Inventory exhausted for jersey % size % after reservation expired. OnHand: %, Required: %',
                    v_res.jersey_id, v_res.size, v_on_hand, v_res.quantity;
            END IF;

            UPDATE public.jersey_inventory
            SET quantity_on_hand = quantity_on_hand - v_res.quantity,
                updated_at = NOW()
            WHERE jersey_id = v_res.jersey_id AND size = v_res.size;

            UPDATE public.stock_reservations
            SET status = 'finalized', finalized_at = NOW(), updated_at = NOW()
            WHERE id = v_res.id;

            INSERT INTO public.inventory_movements (
                organization_id, jersey_id, size, movement_type, quantity_delta,
                quantity_on_hand_before, quantity_on_hand_after,
                quantity_reserved_before, quantity_reserved_after,
                order_id, reservation_id, actor, reason
            ) VALUES (
                p_organization_id, v_res.jersey_id, v_res.size, 'purchase', -v_res.quantity,
                v_on_hand, v_on_hand - v_res.quantity, v_reserved, v_reserved,
                p_order_id, v_res.id, 'paystack_webhook', 'Order payment confirmed after hold expiration'
            );

            v_items_finalized := v_items_finalized + 1;
        END IF;
    END LOOP;

    -- 5. Record the verified payment (guaranteed unique per order via partial unique index)
    INSERT INTO public.payments (
        organization_id, order_id, paystack_reference, amount_paid,
        currency, channel, status, paystack_response, verified_at
    ) VALUES (
        p_organization_id, p_order_id, p_paystack_reference, p_amount_paid,
        p_currency, p_channel, 'success', p_paystack_response, COALESCE(p_paid_at, NOW())
    ) RETURNING id INTO v_payment_id;

    -- 6. Update order status to paid and fulfillment to printing
    UPDATE public.orders
    SET payment_status = 'paid',
        fulfillment_status = 'printing',
        updated_at = NOW()
    WHERE id = p_order_id AND organization_id = p_organization_id;

    -- 7. Update customer statistics
    IF v_order.customer_id IS NOT NULL THEN
        UPDATE public.customers
        SET total_orders = total_orders + 1,
            total_spend = total_spend + p_amount_paid,
            last_contact_at = NOW(),
            updated_at = NOW()
        WHERE id = v_order.customer_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'payment_id', v_payment_id,
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'amount_paid', p_amount_paid,
        'currency', p_currency,
        'items_finalized', v_items_finalized
    );
END;
$$ LANGUAGE plpgsql;

-- 3. Atomic Order Cancellation & Stock Reservation Release
CREATE OR REPLACE FUNCTION public.cancel_order_and_release_stock(
    p_organization_id VARCHAR(50),
    p_order_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_res RECORD;
    v_on_hand INTEGER;
    v_reserved INTEGER;
    v_count INTEGER := 0;
BEGIN
    FOR v_res IN 
        SELECT id, jersey_id, size, quantity 
        FROM public.stock_reservations
        WHERE order_id = p_order_id AND organization_id = p_organization_id AND status = 'active'
        ORDER BY jersey_id, size
        FOR UPDATE
    LOOP
        SELECT quantity_on_hand, quantity_reserved
        INTO v_on_hand, v_reserved
        FROM public.jersey_inventory
        WHERE jersey_id = v_res.jersey_id AND size = v_res.size
        FOR UPDATE;

        IF v_reserved >= v_res.quantity THEN
            UPDATE public.jersey_inventory
            SET quantity_reserved = quantity_reserved - v_res.quantity,
                updated_at = NOW()
            WHERE jersey_id = v_res.jersey_id AND size = v_res.size;
        END IF;

        UPDATE public.stock_reservations
        SET status = 'released', released_at = NOW(), updated_at = NOW()
        WHERE id = v_res.id;

        INSERT INTO public.inventory_movements (
            organization_id, jersey_id, size, movement_type, quantity_delta,
            quantity_on_hand_before, quantity_on_hand_after,
            quantity_reserved_before, quantity_reserved_after,
            order_id, reservation_id, actor, reason
        ) VALUES (
            p_organization_id, v_res.jersey_id, v_res.size, 'reservation_release', -v_res.quantity,
            v_on_hand, v_on_hand, v_reserved, GREATEST(0, v_reserved - v_res.quantity),
            p_order_id, v_res.id, 'cancel_checkout', 'Order cancelled and hold released'
        );

        v_count := v_count + 1;
    END LOOP;

    UPDATE public.orders
    SET fulfillment_status = 'cancelled', updated_at = NOW()
    WHERE id = p_order_id AND organization_id = p_organization_id;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 4. Helper Procedure: Increment Customer Lifetime Spend and Orders
CREATE OR REPLACE FUNCTION public.increment_customer_orders(
    p_customer_id UUID,
    p_spend NUMERIC
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.customers
    SET total_orders = total_orders + 1,
        total_spend = total_spend + p_spend,
        last_contact_at = NOW(),
        updated_at = NOW()
    WHERE id = p_customer_id;
END;
$$ LANGUAGE plpgsql;

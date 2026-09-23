-- ==============================================================================
-- JERSEY AUTOMATE - MULTI-TENANT PRODUCTION DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- ==============================================================================
-- Architecture:
-- 1. Multi-Tenant Ready from Day 1 (`organizations` table + `organization_id` FKs).
-- 2. Size-Level Physical Inventory & Atomic Stock Holds (`stock_reservations`).
-- 3. Dedicated `inventory_movements` ledger for complete stock reconciliation.
-- 4. Concurrency-Safe AI Budget Engine (`ai_monthly_budgets` with row-level locks).
-- 5. Automatic Expired Reservation Cleaner (`release_expired_reservations`).
-- 6. Full Row-Level Security (RLS) with zero public access to sensitive business data.
-- 7. 100% Safely Rerunnable (Idempotent DDL, safe trigger drops).
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. ORGANIZATIONS TABLE (Tenant Foundation)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
    id VARCHAR(50) PRIMARY KEY,                -- e.g. 'org_default', 'org_belhomz'
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default organization for initial single-store testing
INSERT INTO public.organizations (id, name, slug)
VALUES ('org_default', 'Jersey Reseller Hub', 'jersey-hub')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ------------------------------------------------------------------------------
-- 2. SETTINGS TABLE (Per-Organization Store Configuration & WhatsApp Secrets)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
    organization_id VARCHAR(50) PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    store_name VARCHAR(255) NOT NULL DEFAULT 'Jersey Reseller Hub',
    currency VARCHAR(10) NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN', 'GHS', 'ZAR', 'USD', 'EUR', 'GBP')),
    default_shipping_fee NUMERIC(10, 2) NOT NULL DEFAULT 2000.00 CHECK (default_shipping_fee >= 0),
    custom_printing_fee NUMERIC(10, 2) NOT NULL DEFAULT 3000.00 CHECK (custom_printing_fee >= 0),
    
    -- WhatsApp Meta Integration Secrets (Protected; Backend-Only Access)
    waba_id VARCHAR(100),
    phone_number_id VARCHAR(100),
    display_phone_number VARCHAR(50),
    access_token_encrypted TEXT,
    token_expires_at TIMESTAMPTZ,
    webhook_verify_token VARCHAR(255),
    is_whatsapp_connected BOOLEAN DEFAULT FALSE,
    
    -- AI Governance Settings
    max_monthly_ai_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 15.00 CHECK (max_monthly_ai_budget_usd > 0),
    ai_enabled_globally BOOLEAN NOT NULL DEFAULT TRUE,
    
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default settings row
INSERT INTO public.settings (organization_id, store_name, currency)
VALUES ('org_default', 'Jersey Reseller Hub', 'NGN')
ON CONFLICT (organization_id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. DISCOVERED KITS TABLE (Global FootyHeadlines Scraped Library)
-- ------------------------------------------------------------------------------
-- Shared discovery pool. Tenants import from here into their private `jerseys` table.
CREATE TABLE IF NOT EXISTS public.discovered_kits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    league VARCHAR(100) NOT NULL,
    team VARCHAR(150) NOT NULL,
    season VARCHAR(50) NOT NULL,
    kit_type VARCHAR(100) NOT NULL,            -- 'Home', 'Away', 'Third', 'Goalkeeper'
    title VARCHAR(255) NOT NULL,
    raw_image_url TEXT NOT NULL,
    storage_image_url TEXT,                    -- Public Supabase CDN URL
    source_url TEXT,
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_discovered_kit UNIQUE (league, team, season, kit_type)
);

CREATE INDEX IF NOT EXISTS idx_discovered_kits_lookup ON public.discovered_kits (league, team, season);

-- ------------------------------------------------------------------------------
-- 4. JERSEYS TABLE (Tenant Product Catalog)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jerseys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    discovered_kit_id UUID REFERENCES public.discovered_kits(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    league VARCHAR(100) NOT NULL,
    team VARCHAR(150) NOT NULL,
    season VARCHAR(50) NOT NULL,
    kit_type VARCHAR(100) NOT NULL,
    base_price NUMERIC(10, 2) NOT NULL CHECK (base_price >= 0), -- Tenant-managed price
    image_url TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jerseys_org_search ON public.jerseys (organization_id, team, league, is_active);

-- ------------------------------------------------------------------------------
-- 5. JERSEY INVENTORY TABLE (Per-Size Stock Levels & Reserved Holds)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jersey_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    jersey_id UUID NOT NULL REFERENCES public.jerseys(id) ON DELETE CASCADE,
    size VARCHAR(20) NOT NULL CHECK (size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL')),
    quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
    quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_jersey_size UNIQUE (jersey_id, size),
    CONSTRAINT chk_reserved_not_exceed_on_hand CHECK (quantity_reserved <= quantity_on_hand)
);

CREATE INDEX IF NOT EXISTS idx_inventory_lookup ON public.jersey_inventory (organization_id, jersey_id);

-- ------------------------------------------------------------------------------
-- 6. CUSTOMERS TABLE (Tenant-Scoped WhatsApp Buyers)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    phone_number VARCHAR(50) NOT NULL,         -- E.164 MSISDN (e.g. +2348012345678)
    display_name VARCHAR(150),
    shipping_address TEXT,
    notes TEXT,
    total_orders INTEGER NOT NULL DEFAULT 0 CHECK (total_orders >= 0),
    total_spend NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (total_spend >= 0),
    last_contact_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_customer_org_phone UNIQUE (organization_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_customers_org_phone ON public.customers (organization_id, phone_number);

-- ------------------------------------------------------------------------------
-- 7. CONVERSATIONS TABLE (Chat Threads & Human Takeover)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'needs_reply', 'resolved', 'archived')),
    is_ai_enabled BOOLEAN NOT NULL DEFAULT TRUE, -- False = Human Takeover
    last_message_preview TEXT,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_org ON public.conversations (organization_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON public.conversations (customer_id);

-- ------------------------------------------------------------------------------
-- 8. MESSAGES TABLE (WhatsApp 2-Way Message Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    meta_message_id VARCHAR(150) UNIQUE,       -- WhatsApp WAMID for deduplication
    direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    type VARCHAR(50) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'interactive_kit', 'payment_link')),
    body TEXT,
    media_url TEXT,
    jersey_id UUID REFERENCES public.jerseys(id) ON DELETE SET NULL,
    delivery_status VARCHAR(50) NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('received', 'sent', 'delivered', 'read', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_meta_id ON public.messages (meta_message_id);

-- ------------------------------------------------------------------------------
-- 9. ORDERS TABLE (Sales Pipeline & Financial Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    order_number SERIAL UNIQUE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    
    subtotal NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
    shipping_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (shipping_fee >= 0),
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN', 'GHS', 'ZAR', 'USD', 'EUR', 'GBP')),
    
    payment_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
    fulfillment_status VARCHAR(50) NOT NULL DEFAULT 'unfulfilled' CHECK (fulfillment_status IN ('unfulfilled', 'printing', 'shipped', 'delivered', 'cancelled')),
    
    paystack_reference VARCHAR(150) UNIQUE,
    paystack_access_code VARCHAR(150),
    payment_url TEXT,
    reservation_expires_at TIMESTAMPTZ,
    
    shipping_address TEXT,
    shipping_tracking_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_org ON public.orders (organization_id, payment_status, fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_paystack_ref ON public.orders (paystack_reference);
CREATE INDEX IF NOT EXISTS idx_orders_reservations ON public.orders (payment_status, reservation_expires_at);

-- ------------------------------------------------------------------------------
-- 10. ORDER_ITEMS TABLE (Multiple Jerseys per Order)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    jersey_id UUID NOT NULL REFERENCES public.jerseys(id) ON DELETE RESTRICT,
    size VARCHAR(20) NOT NULL CHECK (size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    custom_name VARCHAR(100),
    custom_number VARCHAR(10),
    printing_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (printing_fee >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);

-- ------------------------------------------------------------------------------
-- 11. STOCK_RESERVATIONS TABLE (Order-Linked Inventory Holds)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
    jersey_id UUID NOT NULL REFERENCES public.jerseys(id) ON DELETE RESTRICT,
    size VARCHAR(20) NOT NULL CHECK (size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finalized', 'released', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    finalized_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservations_org ON public.stock_reservations (organization_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_reservations_order ON public.stock_reservations (order_id);

-- ------------------------------------------------------------------------------
-- 12. INVENTORY_MOVEMENTS TABLE (Immutable Stock Audit Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    jersey_id UUID NOT NULL REFERENCES public.jerseys(id) ON DELETE RESTRICT,
    size VARCHAR(20) NOT NULL CHECK (size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL')),
    movement_type VARCHAR(50) NOT NULL CHECK (movement_type IN ('purchase', 'restock', 'manual_adjustment', 'reservation_hold', 'reservation_release', 'damage_loss')),
    quantity_delta INTEGER NOT NULL CHECK (quantity_delta != 0),
    quantity_on_hand_before INTEGER NOT NULL CHECK (quantity_on_hand_before >= 0),
    quantity_on_hand_after INTEGER NOT NULL CHECK (quantity_on_hand_after >= 0),
    quantity_reserved_before INTEGER NOT NULL CHECK (quantity_reserved_before >= 0),
    quantity_reserved_after INTEGER NOT NULL CHECK (quantity_reserved_after >= 0),
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    reservation_id UUID REFERENCES public.stock_reservations(id) ON DELETE SET NULL,
    actor VARCHAR(100) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movements_org ON public.inventory_movements (organization_id, jersey_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_order ON public.inventory_movements (order_id);

-- ------------------------------------------------------------------------------
-- 13. PAYMENTS TABLE (Paystack Transaction Verification Log)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    paystack_reference VARCHAR(150) UNIQUE NOT NULL,
    amount_paid NUMERIC(10, 2) NOT NULL CHECK (amount_paid > 0),
    currency VARCHAR(10) NOT NULL CHECK (currency IN ('NGN', 'GHS', 'ZAR', 'USD', 'EUR', 'GBP')),
    channel VARCHAR(50),
    status VARCHAR(50) NOT NULL CHECK (status IN ('success', 'failed', 'abandoned')),
    paystack_response JSONB NOT NULL,
    verified_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_org ON public.payments (organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_ref ON public.payments (paystack_reference);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_successful_payment_per_order 
ON public.payments (order_id) 
WHERE status = 'success';

-- ------------------------------------------------------------------------------
-- 14. AUDIT_LOGS TABLE (Security & Action Auditing)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    actor VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_entity VARCHAR(50) NOT NULL,
    target_id VARCHAR(100),
    details JSONB,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON public.audit_logs (organization_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 15. AI_MONTHLY_BUDGETS TABLE (Concurrency-Safe Budget Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_monthly_budgets (
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    month_date DATE NOT NULL,                  -- First day of month (e.g. '2026-09-01')
    max_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 15.00 CHECK (max_budget_usd > 0),
    current_spend_usd NUMERIC(10, 6) NOT NULL DEFAULT 0.000000 CHECK (current_spend_usd >= 0),
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (organization_id, month_date)
);

-- ------------------------------------------------------------------------------
-- 16. AI_USAGE_LOGS TABLE (Append-Only Token Tracking)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    model VARCHAR(100) NOT NULL,
    prompt_tokens INTEGER NOT NULL CHECK (prompt_tokens >= 0),
    completion_tokens INTEGER NOT NULL CHECK (completion_tokens >= 0),
    total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0),
    estimated_cost_usd NUMERIC(10, 6) NOT NULL CHECK (estimated_cost_usd >= 0),
    tools_called TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_org ON public.ai_usage_logs (organization_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 17. WEBHOOK_LOGS TABLE (Raw Ingest Audit with Idempotency Key)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id VARCHAR(50) REFERENCES public.organizations(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL CHECK (source IN ('whatsapp', 'paystack')),
    event_type VARCHAR(100),
    idempotency_key VARCHAR(150) UNIQUE,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_key ON public.webhook_logs (idempotency_key);

-- ------------------------------------------------------------------------------
-- 18. SAFELY RERUNNABLE TRIGGERS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_orgs_updated_at ON public.organizations;
CREATE TRIGGER set_orgs_updated_at BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_jerseys_updated_at ON public.jerseys;
CREATE TRIGGER set_jerseys_updated_at BEFORE UPDATE ON public.jerseys
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_customers_updated_at ON public.customers;
CREATE TRIGGER set_customers_updated_at BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_conversations_updated_at ON public.conversations;
CREATE TRIGGER set_conversations_updated_at BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_orders_updated_at ON public.orders;
CREATE TRIGGER set_orders_updated_at BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_reservations_updated_at ON public.stock_reservations;
CREATE TRIGGER set_reservations_updated_at BEFORE UPDATE ON public.stock_reservations
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- Trigger: Automatically update conversation snippet and customer last_contact_at
CREATE OR REPLACE FUNCTION public.trigger_on_message_insert()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET 
    last_message_preview = CASE 
      WHEN NEW.type = 'image' THEN '📷 Photo'
      WHEN NEW.type = 'interactive_kit' THEN '⚽ Jersey Card'
      WHEN NEW.type = 'payment_link' THEN '💳 Payment Link'
      ELSE SUBSTRING(NEW.body FROM 1 FOR 80)
    END,
    last_message_at = NEW.created_at,
    unread_count = CASE 
      WHEN NEW.direction = 'inbound' THEN unread_count + 1 
      ELSE unread_count 
    END,
    updated_at = NOW()
  WHERE id = NEW.conversation_id;

  UPDATE public.customers
  SET last_contact_at = NEW.created_at
  WHERE id = (SELECT customer_id FROM public.conversations WHERE id = NEW.conversation_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_new_message_update_conversation ON public.messages;
CREATE TRIGGER on_new_message_update_conversation
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.trigger_on_message_insert();

-- ------------------------------------------------------------------------------
-- 19. ATOMIC MULTI-ITEM INVENTORY FUNCTIONS
-- ------------------------------------------------------------------------------

/**
 * Atomically reserves all items for an order.
 * Sorts items deterministically to avoid cross-transaction deadlocks.
 */
CREATE OR REPLACE FUNCTION public.reserve_order_stock(
    p_order_id UUID,
    p_ttl_minutes INTEGER DEFAULT 15
)
RETURNS TABLE (
    reservation_id UUID,
    order_item_id UUID,
    jersey_id UUID,
    size VARCHAR,
    quantity INTEGER,
    expires_at TIMESTAMPTZ
) AS $$
DECLARE
    v_order RECORD;
    v_item RECORD;
    v_avail INTEGER;
    v_on_hand INTEGER;
    v_reserved INTEGER;
    v_expires_at TIMESTAMPTZ;
    v_res_id UUID;
BEGIN
    IF p_ttl_minutes <= 0 THEN
        RAISE EXCEPTION 'Reservation TTL must be greater than zero minutes.';
    END IF;

    SELECT id, organization_id, payment_status INTO v_order
    FROM public.orders
    WHERE id = p_order_id;

    IF v_order.id IS NULL OR v_order.payment_status != 'pending' THEN
        RAISE EXCEPTION 'Order % does not exist or is not in pending status.', p_order_id;
    END IF;

    v_expires_at := NOW() + (p_ttl_minutes || ' minutes')::INTERVAL;

    -- Sort items to prevent deadlocks
    FOR v_item IN 
        SELECT oi.id AS item_id, oi.jersey_id, oi.size, oi.quantity 
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
        ORDER BY oi.jersey_id ASC, oi.size ASC
    LOOP
        IF v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be > 0.';
        END IF;

        -- Lock inventory row
        SELECT quantity_on_hand, quantity_reserved, (quantity_on_hand - quantity_reserved)
        INTO v_on_hand, v_reserved, v_avail
        FROM public.jersey_inventory
        WHERE jersey_id = v_item.jersey_id AND size = v_item.size
        FOR UPDATE;

        IF v_avail IS NULL THEN
            RAISE EXCEPTION 'Inventory not found for Jersey % Size %.', v_item.jersey_id, v_item.size;
        END IF;

        IF v_avail < v_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for Jersey % Size %: Available: %, Requested: %',
                v_item.jersey_id, v_item.size, v_avail, v_item.quantity;
        END IF;

        -- Insert reservation
        INSERT INTO public.stock_reservations (
            organization_id, order_id, order_item_id, jersey_id, size, quantity, status, expires_at
        ) VALUES (
            v_order.organization_id, p_order_id, v_item.item_id, v_item.jersey_id, v_item.size, v_item.quantity, 'active', v_expires_at
        ) RETURNING id INTO v_res_id;

        -- Increment quantity_reserved
        UPDATE public.jersey_inventory
        SET quantity_reserved = quantity_reserved + v_item.quantity,
            updated_at = NOW()
        WHERE jersey_id = v_item.jersey_id AND size = v_item.size;

        -- Ledger record
        INSERT INTO public.inventory_movements (
            organization_id, jersey_id, size, movement_type, quantity_delta,
            quantity_on_hand_before, quantity_on_hand_after,
            quantity_reserved_before, quantity_reserved_after,
            order_id, reservation_id, actor, reason
        ) VALUES (
            v_order.organization_id, v_item.jersey_id, v_item.size, 'reservation_hold', v_item.quantity,
            v_on_hand, v_on_hand, v_reserved, v_reserved + v_item.quantity,
            p_order_id, v_res_id, 'system_reservation', 'Order checkout stock hold'
        );

        reservation_id := v_res_id;
        order_item_id  := v_item.item_id;
        jersey_id      := v_item.jersey_id;
        size           := v_item.size;
        quantity       := v_item.quantity;
        expires_at     := v_expires_at;
        RETURN NEXT;
    END LOOP;

    UPDATE public.orders
    SET reservation_expires_at = v_expires_at, updated_at = NOW()
    WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql;

/**
 * Finalizes order reservations upon verified payment confirmation.
 */
CREATE OR REPLACE FUNCTION public.finalize_order_stock(p_order_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_res RECORD;
    v_on_hand INTEGER;
    v_reserved INTEGER;
    v_count INTEGER := 0;
BEGIN
    FOR v_res IN 
        SELECT id, organization_id, jersey_id, size, quantity 
        FROM public.stock_reservations
        WHERE order_id = p_order_id AND status = 'active'
        ORDER BY jersey_id, size
        FOR UPDATE
    LOOP
        SELECT quantity_on_hand, quantity_reserved
        INTO v_on_hand, v_reserved
        FROM public.jersey_inventory
        WHERE jersey_id = v_res.jersey_id AND size = v_res.size
        FOR UPDATE;

        IF v_on_hand < v_res.quantity OR v_reserved < v_res.quantity THEN
            RAISE EXCEPTION 'Integrity failure finalizing reservation %. OnHand: %, Reserved: %, Requested: %',
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
            v_res.organization_id, v_res.jersey_id, v_res.size, 'purchase', -v_res.quantity,
            v_on_hand, v_on_hand - v_res.quantity, v_reserved, v_reserved - v_res.quantity,
            p_order_id, v_res.id, 'paystack_webhook', 'Order payment confirmed'
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

/**
 * Periodic cleanup function to release all expired 15-minute reservations.
 * Designed to be called by Node.js cron on Render every 5 minutes.
 */
CREATE OR REPLACE FUNCTION public.release_expired_reservations(p_organization_id VARCHAR(50) DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
    v_res RECORD;
    v_on_hand INTEGER;
    v_reserved INTEGER;
    v_count INTEGER := 0;
BEGIN
    FOR v_res IN 
        SELECT id, organization_id, order_id, jersey_id, size, quantity 
        FROM public.stock_reservations
        WHERE status = 'active' AND expires_at < NOW()
          AND (p_organization_id IS NULL OR organization_id = p_organization_id)
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
        SET status = 'expired', released_at = NOW(), updated_at = NOW()
        WHERE id = v_res.id;

        INSERT INTO public.inventory_movements (
            organization_id, jersey_id, size, movement_type, quantity_delta,
            quantity_on_hand_before, quantity_on_hand_after,
            quantity_reserved_before, quantity_reserved_after,
            order_id, reservation_id, actor, reason
        ) VALUES (
            v_res.organization_id, v_res.jersey_id, v_res.size, 'reservation_release', -v_res.quantity,
            v_on_hand, v_on_hand, v_reserved, GREATEST(0, v_reserved - v_res.quantity),
            v_res.order_id, v_res.id, 'cron_cleanup', 'Stock reservation expired'
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

/**
 * Atomic Payment Confirmation & Stock Finalization Procedure.
 * Handles payment recording, order status update, stock reservation finalization,
 * and customer metric updates in ONE transactional execution.
 * If any step fails (e.g. stock integrity, tenant mismatch, currency mismatch), 
 * the entire transaction is rolled back by PostgreSQL.
 */
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

/**
 * Atomic order cancellation and stock reservation release.
 */
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


-- ------------------------------------------------------------------------------
-- 20. ATOMIC CONCURRENCY-SAFE AI BUDGET ENFORCEMENT
-- ------------------------------------------------------------------------------

/**
 * Concurrency-safe AI budget check and recording procedure.
 * Uses row-level lock (FOR UPDATE) to prevent race condition overshoots.
 */
CREATE OR REPLACE FUNCTION public.check_and_record_ai_usage(
    p_organization_id VARCHAR(50),
    p_conversation_id UUID,
    p_model VARCHAR(100),
    p_prompt_tokens INTEGER,
    p_completion_tokens INTEGER,
    p_estimated_cost_usd NUMERIC(10, 6),
    p_tools_called TEXT[]
)
RETURNS BOOLEAN AS $$
DECLARE
    v_month_date DATE := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_budget RECORD;
    v_max_budget NUMERIC;
BEGIN
    -- Look up tenant max monthly budget setting
    SELECT max_monthly_ai_budget_usd INTO v_max_budget
    FROM public.settings
    WHERE organization_id = p_organization_id;

    IF v_max_budget IS NULL THEN
        v_max_budget := 15.00;
    END IF;

    -- Ensure budget row exists
    INSERT INTO public.ai_monthly_budgets (organization_id, month_date, max_budget_usd, current_spend_usd)
    VALUES (p_organization_id, v_month_date, v_max_budget, 0.000000)
    ON CONFLICT (organization_id, month_date) DO NOTHING;

    -- ROW LOCK: Blocks concurrent requests until this check commits
    SELECT * INTO v_budget
    FROM public.ai_monthly_budgets
    WHERE organization_id = p_organization_id AND month_date = v_month_date
    FOR UPDATE;

    -- Enforce hard limit
    IF v_budget.is_locked OR (v_budget.current_spend_usd + p_estimated_cost_usd > v_budget.max_budget_usd) THEN
        UPDATE public.ai_monthly_budgets
        SET is_locked = TRUE, updated_at = NOW()
        WHERE organization_id = p_organization_id AND month_date = v_month_date;

        RETURN FALSE; -- Abort AI call (Limit exceeded)
    END IF;

    -- Atomically increment current spend
    UPDATE public.ai_monthly_budgets
    SET current_spend_usd = current_spend_usd + p_estimated_cost_usd,
        updated_at = NOW()
    WHERE organization_id = p_organization_id AND month_date = v_month_date;

    -- Log append-only audit record
    INSERT INTO public.ai_usage_logs (
        organization_id, conversation_id, model, prompt_tokens,
        completion_tokens, total_tokens, estimated_cost_usd, tools_called
    ) VALUES (
        p_organization_id, p_conversation_id, p_model, p_prompt_tokens,
        p_completion_tokens, p_prompt_tokens + p_completion_tokens,
        p_estimated_cost_usd, p_tools_called
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 21. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovered_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jerseys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jersey_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_monthly_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- Public can view active jerseys in the catalog
DROP POLICY IF EXISTS "Public can view active jerseys" ON public.jerseys;
CREATE POLICY "Public can view active jerseys"
ON public.jerseys FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

-- Public can check size availability
DROP POLICY IF EXISTS "Public can view stock availability" ON public.jersey_inventory;
CREATE POLICY "Public can view stock availability"
ON public.jersey_inventory FOR SELECT TO anon, authenticated
USING (jersey_id IN (SELECT id FROM public.jerseys WHERE is_active = TRUE));

-- Note: All remaining tables (settings, orders, payments, reservations, chat) have 0 public policies.
-- They are accessible strictly by your Node.js backend using SUPABASE_SERVICE_ROLE_KEY.

-- ------------------------------------------------------------------------------
-- 22. SUPABASE REALTIME CONFIGURATION (SAFELY RERUNNABLE)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END $$;

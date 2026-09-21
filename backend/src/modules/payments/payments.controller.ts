import { Request, Response, NextFunction } from 'express';
import { paymentsService } from './payments.service.js';
import { InitializePaymentDTO } from './payments.types.js';

export const paymentsController = {
  /**
   * POST /api/v1/payments/initialize
   * Generates a Paystack checkout URL for an existing pending order.
   */
  async initialize(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { orderId, email } = req.body as InitializePaymentDTO;
      const result = await paymentsService.initializePayment(
        req.organizationId,
        orderId,
        email
      );

      res.json({
        success: true,
        message: 'Paystack transaction initialized',
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/payments/verify/:reference
   * Verifies payment status directly against Paystack API.
   */
  async verify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const reference = req.params.reference as string;
      const record = await paymentsService.processVerifiedPayment(reference);
      res.json({
        success: true,
        message: 'Payment verified and stock finalized',
        data: record
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/payments/webhook
   * Ingests Paystack webhook events with mandatory HMAC-SHA512 verification.
   */
  async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const signature = req.headers['x-paystack-signature'] as string;
      const isValid = paymentsService.verifyWebhookSignature(req.rawBody, signature);

      if (!isValid) {
        res.status(401).json({ success: false, message: 'Invalid Paystack webhook signature' });
        return;
      }

      const event = req.body;

      // Immediately acknowledge receipt to Paystack (< 50ms)
      res.status(200).json({ status: 'success' });

      // Process charge.success asynchronously
      if (event.event === 'charge.success') {
        const reference = event.data?.reference;
        if (reference) {
          paymentsService.processVerifiedPayment(reference, event.data).catch((err) => {
            console.error(`[Paystack Webhook] Processing failed for ${reference}:`, err.message);
          });
        }
      }
    } catch (error) {
      next(error);
    }
  }
};

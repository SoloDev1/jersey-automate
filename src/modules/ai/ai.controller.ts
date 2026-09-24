import { Request, Response, NextFunction } from 'express';
import { aiService } from './ai.service.js';

export const aiController = {
  /**
   * GET /api/v1/ai/budget
   * Retrieves organization monthly AI budget status and token spend.
   */
  async getBudget(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const budget = await aiService.getBudgetStatus(req.organizationId);
      res.json({
        success: true,
        data: budget
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/ai/test-chat
   * Allows store owner to simulate/test AI responses in dashboard sandbox.
   */
  async testChat(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { message, conversationId } = req.body;
      if (!message) {
        res.status(400).json({ success: false, error: { message: 'Message is required' } });
        return;
      }

      await aiService.handleInboundCustomerMessage(
        req.organizationId,
        conversationId || '00000000-0000-0000-0000-000000000000',
        {
          id: 'test-customer',
          phoneNumber: '+2348000000000',
          displayName: 'Test Customer'
        },
        message
      );

      res.json({
        success: true,
        message: 'Test message processed by AI assistant'
      });
    } catch (error) {
      next(error);
    }
  }
};

import { Request, Response, NextFunction } from 'express';
import { whatsappService } from './whatsapp.service.js';
import { OnboardDTO } from './whatsapp.types.js';

export const whatsappController = {
  /**
   * GET /api/v1/whatsapp/status
   */
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await whatsappService.getStatus(req.organizationId);
      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/whatsapp/onboard
   */
  async onboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as OnboardDTO;
      const result = await whatsappService.onboardTenant(req.organizationId, body);
      res.json({
        success: true,
        message: 'WhatsApp Business connected successfully',
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/whatsapp/disconnect
   */
  async disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await whatsappService.disconnect(req.organizationId);
      res.json({ success: true, message: 'WhatsApp disconnected' });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/whatsapp/test-message
   */
  async testMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { toPhone, message } = req.body;
      if (!toPhone) {
        res.status(400).json({ success: false, error: 'toPhone is required' });
        return;
      }
      const text = message || '⚽ Hello from Jersey Automate Backend! Your WhatsApp Cloud API connection is working.';
      const wamid = await whatsappService.sendTextMessage(req.organizationId, {
        toPhone,
        body: text
      });
      res.json({
        success: true,
        message: 'Test message sent successfully',
        data: { wamid }
      });
    } catch (error) {
      next(error);
    }
  }
};

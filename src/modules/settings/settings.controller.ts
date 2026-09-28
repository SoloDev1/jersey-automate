import { Request, Response } from 'express';
import { settingsService } from './settings.service.js';
import { updateStoreSettingsSchema } from './settings.schema.js';

export class SettingsController {
  async getSettings(req: Request, res: Response): Promise<void> {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: 'Missing organization context' });
      return;
    }

    try {
      const settings = await settingsService.getSettings(organizationId);
      res.json({ success: true, data: settings });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve settings';
      res.status(500).json({ error: msg });
    }
  }

  async updateSettings(req: Request, res: Response): Promise<void> {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: 'Missing organization context' });
      return;
    }

    const parseResult = updateStoreSettingsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid settings payload',
        details: parseResult.error.flatten()
      });
      return;
    }

    try {
      const updated = await settingsService.updateSettings(organizationId, parseResult.data);
      res.json({ success: true, data: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update settings';
      res.status(500).json({ error: msg });
    }
  }
}

export const settingsController = new SettingsController();

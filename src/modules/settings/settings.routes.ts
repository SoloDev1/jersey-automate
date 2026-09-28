import { Router } from 'express';
import { settingsController } from './settings.controller.js';

export const settingsRouter = Router();

settingsRouter.get('/', (req, res) => settingsController.getSettings(req, res));
settingsRouter.patch('/', (req, res) => settingsController.updateSettings(req, res));

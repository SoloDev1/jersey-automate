import { Router } from 'express';
import { whatsappController } from './whatsapp.controller.js';
import { validateRequest } from '../../core/middleware/validateRequest.js';
import { onboardSchema } from './whatsapp.schema.js';

export const whatsappRouter = Router();

whatsappRouter.get('/status', whatsappController.getStatus);
whatsappRouter.post('/onboard', validateRequest({ body: onboardSchema }), whatsappController.onboard);
whatsappRouter.post('/disconnect', whatsappController.disconnect);

import { Router } from 'express';
import { aiController } from './ai.controller.js';
import { validateRequest } from '../../core/middleware/validateRequest.js';
import { testChatSchema } from './ai.schema.js';

export const aiRouter = Router();

// Retrieve monthly AI budget consumption and limit status
aiRouter.get('/budget', aiController.getBudget);

// Sandbox chat simulator for testing prompts and tools from CRM
aiRouter.post(
  '/test-chat',
  validateRequest({ body: testChatSchema }),
  aiController.testChat
);


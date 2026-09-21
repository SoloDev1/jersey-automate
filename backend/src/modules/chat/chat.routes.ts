import { Router } from 'express';
import { chatController } from './chat.controller.js';
import { validateRequest } from '../../core/middleware/validateRequest.js';
import {
  sendMessageSchema,
  sendKitCardSchema,
  toggleAiSchema,
  conversationFilterSchema
} from './chat.schema.js';

export const chatRouter = Router();

// List conversations with pagination & filtering
chatRouter.get(
  '/conversations',
  validateRequest({ query: conversationFilterSchema }),
  chatController.listConversations
);

// Fetch message thread for a conversation
chatRouter.get('/conversations/:id/messages', chatController.getMessages);

// Store owner sends manual text message (triggers instant Human Takeover)
chatRouter.post(
  '/send',
  validateRequest({ body: sendMessageSchema }),
  chatController.sendTextMessage
);

// Store owner sends interactive jersey kit card directly to WhatsApp
chatRouter.post(
  '/send-kit',
  validateRequest({ body: sendKitCardSchema }),
  chatController.sendKitCard
);

// Toggle AI auto-reply on/off for a conversation
chatRouter.patch(
  '/conversations/:id/ai',
  validateRequest({ body: toggleAiSchema }),
  chatController.toggleAi
);

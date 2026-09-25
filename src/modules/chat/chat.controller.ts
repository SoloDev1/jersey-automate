import { Request, Response, NextFunction } from 'express';
import { chatService } from './chat.service.js';
import {
  SendMessageDTO,
  SendKitCardDTO,
  ToggleAiDTO,
  ConversationFilterDTO
} from './chat.types.js';

export const chatController = {
  /**
   * GET /api/v1/chat/conversations
   */
  async listConversations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = req.query as unknown as ConversationFilterDTO;
      const result = await chatService.listConversations(req.organizationId, filters);
      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/chat/conversations/:id/messages
   */
  async getMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const conversationId = req.params.id as string;
      const result = await chatService.getMessages(req.organizationId, conversationId);
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/chat/send
   * Store owner sends manual text message to customer (triggers Human Takeover).
   */
  async sendTextMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as SendMessageDTO;
      const message = await chatService.sendManualMessage(req.organizationId, body);
      res.status(201).json({
        success: true,
        message: 'Message sent and AI auto-reply paused for this conversation',
        data: message
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/chat/send-kit
   * Store owner dispatches interactive kit card to customer WhatsApp.
   */
  async sendKitCard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as SendKitCardDTO;
      const message = await chatService.sendKitCard(req.organizationId, body);
      res.status(201).json({
        success: true,
        message: 'Jersey kit card sent to WhatsApp',
        data: message
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/chat/conversations/:id/ai
   * Manually enable or disable AI for a conversation.
   */
  async toggleAi(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const conversationId = req.params.id as string;
      const { isAiEnabled } = req.body as ToggleAiDTO;
      await chatService.toggleAi(req.organizationId, conversationId, isAiEnabled);
      res.json({
        success: true,
        message: `AI auto-reply ${isAiEnabled ? 'enabled' : 'disabled'} for this conversation`
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/v1/chat/conversations/:id/messages
   * Clears all message history in a conversation thread.
   */
  async clearMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const conversationId = req.params.id as string;
      await chatService.clearChatHistory(req.organizationId, conversationId);
      res.json({
        success: true,
        message: 'Chat history cleared successfully'
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/v1/chat/conversations/:id
   * Permanently deletes a conversation and all its messages.
   */
  async deleteConversation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const conversationId = req.params.id as string;
      await chatService.deleteConversation(req.organizationId, conversationId);
      res.json({
        success: true,
        message: 'Conversation deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
};

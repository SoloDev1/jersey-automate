import axios from 'axios';
import {
  Conversation,
  Message,
  Jersey,
  Order,
  AiBudget,
  WhatsAppStatus
} from '../types/crm.types.js';

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json'
  }
});

export const crmApi = {
  // --- Live Chat ---
  async getConversations(status?: string): Promise<Conversation[]> {
    const res = await api.get('/chat/conversations', { params: { status, limit: 50 } });
    return res.data?.data || [];
  },

  async getMessages(conversationId: string): Promise<{ conversation: Conversation; messages: Message[] }> {
    const res = await api.get(`/chat/conversations/${conversationId}/messages`);
    return res.data?.data;
  },

  async sendTextMessage(conversationId: string, message: string): Promise<Message> {
    const res = await api.post('/chat/send', { conversationId, message });
    return res.data?.data;
  },

  async sendKitCard(conversationId: string, jerseyId: string, customPrice?: number): Promise<Message> {
    const res = await api.post('/chat/send-kit', { conversationId, jerseyId, customPrice });
    return res.data?.data;
  },

  async toggleAi(conversationId: string, isAiEnabled: boolean): Promise<void> {
    await api.patch(`/chat/conversations/${conversationId}/ai`, { isAiEnabled });
  },

  // --- Catalog ---
  async getCatalog(search?: string, league?: string): Promise<Jersey[]> {
    const res = await api.get('/catalog', { params: { search, league, limit: 50 } });
    return res.data?.data || [];
  },

  async updateJersey(id: string, updates: Partial<Jersey>): Promise<Jersey> {
    const res = await api.patch(`/catalog/${id}`, updates);
    return res.data?.data;
  },

  // --- Orders ---
  async getOrders(paymentStatus?: string, fulfillmentStatus?: string): Promise<Order[]> {
    const res = await api.get('/orders', {
      params: { paymentStatus, fulfillmentStatus, limit: 50 }
    });
    return res.data?.data || [];
  },

  async updateOrderStatus(
    orderId: string,
    fulfillmentStatus: string,
    shippingTrackingNumber?: string
  ): Promise<Order> {
    const res = await api.patch(`/orders/${orderId}/status`, {
      fulfillmentStatus,
      shippingTrackingNumber
    });
    return res.data?.data;
  },

  // --- Settings & AI ---
  async getWhatsAppStatus(): Promise<WhatsAppStatus> {
    const res = await api.get('/whatsapp/status');
    return res.data?.data;
  },

  async onboardWhatsApp(payload: {
    accessToken?: string;
    phoneNumberId?: string;
    wabaId?: string;
    code?: string;
  }): Promise<WhatsAppStatus> {
    const res = await api.post('/whatsapp/onboard', payload);
    return res.data?.data;
  },

  async getAiBudget(): Promise<AiBudget> {
    const res = await api.get('/ai/budget');
    return res.data?.data;
  }
};

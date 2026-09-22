import { supabase } from '../../core/database/supabase.js';
import {
  ConversationRecord,
  MessageRecord,
  ConversationFilterDTO
} from './chat.types.js';
import { PaginatedResult } from '../catalog/catalog.types.js';

export const chatRepository = {
  /**
   * Lists customer conversation threads with unread counts and latest snippet.
   */
  async listConversations(
    organizationId: string,
    filter: ConversationFilterDTO
  ): Promise<PaginatedResult<ConversationRecord>> {
    const page = filter.page || 1;
    const limit = filter.limit || 30;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('conversations')
      .select('*, customers(phone_number, display_name, shipping_address, notes, total_orders, total_spend)', { count: 'exact' })
      .eq('organization_id', organizationId);

    if (filter.status) {
      query = query.eq('status', filter.status);
    }

    query = query
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const total = count || 0;
    const formatted: ConversationRecord[] = (data || []).map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      customerId: row.customer_id,
      status: row.status,
      isAiEnabled: row.is_ai_enabled,
      lastMessagePreview: row.last_message_preview,
      lastMessageAt: row.last_message_at,
      unreadCount: row.unread_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      customerPhone: row.customers?.phone_number,
      customerName: row.customers?.display_name,
      customerAddress: row.customers?.shipping_address,
      customerNotes: row.customers?.notes,
      customerTotalOrders: row.customers?.total_orders || 0,
      customerTotalSpend: Number(row.customers?.total_spend) || 0,
    }));

    return {
      data: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  },

  /**
   * Retrieves single conversation details.
   */
  async getConversationById(
    organizationId: string,
    conversationId: string
  ): Promise<ConversationRecord | null> {
    const { data, error } = await supabase
      .from('conversations')
      .select('*, customers(phone_number, display_name, shipping_address, notes, total_orders, total_spend)')
      .eq('organization_id', organizationId)
      .eq('id', conversationId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      organizationId: data.organization_id,
      customerId: data.customer_id,
      status: data.status,
      isAiEnabled: data.is_ai_enabled,
      lastMessagePreview: data.last_message_preview,
      lastMessageAt: data.last_message_at,
      unreadCount: data.unread_count,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      customerPhone: data.customers?.phone_number,
      customerName: data.customers?.display_name,
      customerAddress: data.customers?.shipping_address,
      customerNotes: data.customers?.notes,
      customerTotalOrders: data.customers?.total_orders || 0,
      customerTotalSpend: Number(data.customers?.total_spend) || 0,
    };
  },

  /**
   * Finds existing conversation by customer ID or creates a new one.
   */
  async findOrCreateConversation(
    organizationId: string,
    customerId: string
  ): Promise<ConversationRecord> {
    const { data: existing } = await supabase
      .from('conversations')
      .select('*, customers(phone_number, display_name)')
      .eq('organization_id', organizationId)
      .eq('customer_id', customerId)
      .maybeSingle();

    if (existing) {
      return {
        id: existing.id,
        organizationId: existing.organization_id,
        customerId: existing.customer_id,
        status: existing.status,
        isAiEnabled: existing.is_ai_enabled,
        lastMessagePreview: existing.last_message_preview,
        lastMessageAt: existing.last_message_at,
        unreadCount: existing.unread_count,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
        customerPhone: existing.customers?.phone_number,
        customerName: existing.customers?.display_name
      };
    }

    const { data: created, error } = await supabase
      .from('conversations')
      .insert({
        organization_id: organizationId,
        customer_id: customerId,
        status: 'open',
        is_ai_enabled: true
      })
      .select('*, customers(phone_number, display_name)')
      .single();

    if (error || !created) throw error;

    return {
      id: created.id,
      organizationId: created.organization_id,
      customerId: created.customer_id,
      status: created.status,
      isAiEnabled: created.is_ai_enabled,
      lastMessagePreview: created.last_message_preview,
      lastMessageAt: created.last_message_at,
      unreadCount: created.unread_count,
      createdAt: created.created_at,
      updatedAt: created.updated_at,
      customerPhone: created.customers?.phone_number,
      customerName: created.customers?.display_name
    };
  },

  /**
   * Retrieves message thread for a conversation ordered chronologically.
   */
  async getMessages(
    organizationId: string,
    conversationId: string,
    limit = 50
  ): Promise<MessageRecord[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*, jerseys(title, image_url)')
      .eq('organization_id', organizationId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      conversationId: row.conversation_id,
      metaMessageId: row.meta_message_id,
      direction: row.direction,
      type: row.type,
      body: row.body,
      mediaUrl: row.media_url,
      jerseyId: row.jersey_id,
      deliveryStatus: row.delivery_status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      jerseyTitle: row.jerseys?.title,
      jerseyImage: row.jerseys?.image_url
    }));
  },

  /**
   * Inserts a message into the database.
   * Enforces deduplication on meta_message_id.
   */
  async insertMessage(
    organizationId: string,
    data: {
      conversationId: string;
      metaMessageId?: string | null;
      direction: 'inbound' | 'outbound';
      type: 'text' | 'image' | 'interactive_kit' | 'payment_link';
      body?: string | null;
      mediaUrl?: string | null;
      jerseyId?: string | null;
      deliveryStatus?: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
    }
  ): Promise<MessageRecord | null> {
    // Deduplication check for inbound Meta webhooks
    if (data.metaMessageId) {
      const { data: existing } = await supabase
        .from('messages')
        .select('id')
        .eq('meta_message_id', data.metaMessageId)
        .maybeSingle();

      if (existing) {
        return null; // Duplicate event dropped cleanly
      }
    }

    const { data: created, error } = await supabase
      .from('messages')
      .insert({
        organization_id: organizationId,
        conversation_id: data.conversationId,
        meta_message_id: data.metaMessageId || null,
        direction: data.direction,
        type: data.type,
        body: data.body || null,
        media_url: data.mediaUrl || null,
        jersey_id: data.jerseyId || null,
        delivery_status: data.deliveryStatus || (data.direction === 'inbound' ? 'received' : 'sent')
      })
      .select('*, jerseys(title, image_url)')
      .single();

    if (error || !created) throw error;

    // Update conversation snippet and timestamp
    const previewText = data.body || (data.type === 'interactive_kit' ? '⚽ Jersey Card' : 'Media attachment');
    const updatePayload: Record<string, any> = {
      last_message_preview: previewText.slice(0, 150),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (data.direction === 'inbound') {
      updatePayload.status = 'needs_reply';
    }
    await supabase
      .from('conversations')
      .update(updatePayload)
      .eq('organization_id', organizationId)
      .eq('id', data.conversationId);

    return {
      id: created.id,
      organizationId: created.organization_id,
      conversationId: created.conversation_id,
      metaMessageId: created.meta_message_id,
      direction: created.direction,
      type: created.type,
      body: created.body,
      mediaUrl: created.media_url,
      jerseyId: created.jersey_id,
      deliveryStatus: created.delivery_status,
      errorMessage: created.error_message,
      createdAt: created.created_at,
      jerseyTitle: created.jerseys?.title,
      jerseyImage: created.jerseys?.image_url
    };
  },

  /**
   * Sets AI auto-reply enabled or disabled for a conversation (Human Takeover).
   */
  async setAiEnabled(
    organizationId: string,
    conversationId: string,
    isAiEnabled: boolean
  ): Promise<void> {
    const { error } = await supabase
      .from('conversations')
      .update({
        is_ai_enabled: isAiEnabled,
        updated_at: new Date().toISOString()
      })
      .eq('organization_id', organizationId)
      .eq('id', conversationId);

    if (error) throw error;
  },

  /**
   * Resets unread counter when a conversation is opened.
   */
  async markAsRead(organizationId: string, conversationId: string): Promise<void> {
    await supabase
      .from('conversations')
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('id', conversationId);
  },

  /**
   * Updates message delivery status (e.g. delivered, read, failed) from Meta webhook events.
   */
  async updateMessageStatus(
    metaMessageId: string,
    status: 'delivered' | 'read' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    const updateData: Record<string, any> = {
      delivery_status: status
    };
    if (errorMessage) {
      updateData.error_message = errorMessage;
    }
    await supabase
      .from('messages')
      .update(updateData)
      .eq('meta_message_id', metaMessageId);
  }
};


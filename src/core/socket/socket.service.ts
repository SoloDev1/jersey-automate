import { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { MessageRecord, ConversationRecord } from '../../modules/chat/chat.types.js';

const TENANT_ID_REGEX = /^[a-zA-Z0-9_-]{1,50}$/;
const DEFAULT_ORGANIZATION_ID = 'org_default';

interface SocketData {
  organizationId: string;
  activeConversationId?: string;
}

export interface MessageStatusEvent {
  metaMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error?: string | null;
  organizationId: string;
}

export class SocketService {
  private io: SocketIOServer | null = null;

  /**
   * Initializes the Socket.IO server attached to Node's HTTP server.
   */
  init(httpServer: HttpServer): SocketIOServer {
    const corsOrigin =
      process.env.NODE_ENV === 'production' && process.env.FRONTEND_URL
        ? process.env.FRONTEND_URL.split(',').map((u) => u.trim())
        : '*';

    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: corsOrigin,
        methods: ['GET', 'POST'],
        credentials: true
      },
      pingTimeout: 30000,
      pingInterval: 25000
    });

    // Connection Handshake Middleware: Validate Tenant Organization
    this.io.use((socket: Socket, next) => {
      const authOrg = socket.handshake.auth?.organizationId;
      const queryOrg = socket.handshake.query?.organizationId;

      const rawCandidate = typeof authOrg === 'string' ? authOrg : typeof queryOrg === 'string' ? queryOrg : '';
      const candidate = rawCandidate.trim();

      const organizationId =
        candidate && TENANT_ID_REGEX.test(candidate) ? candidate : DEFAULT_ORGANIZATION_ID;

      const data: SocketData = { organizationId };
      socket.data = data;
      next();
    });

    this.io.on('connection', (socket: Socket) => {
      const data = socket.data as SocketData;
      const orgRoom = `org:${data.organizationId}`;

      // Automatically join the organization's tenant room (inbox list updates)
      socket.join(orgRoom);

      // Handle joining a specific conversation room for live chat stream
      socket.on('join:conversation', (payload: unknown) => {
        if (!payload || typeof payload !== 'object') return;
        const conversationId = (payload as { conversationId?: unknown }).conversationId;
        if (typeof conversationId !== 'string' || !conversationId.trim()) return;

        const targetRoom = `conversation:${conversationId.trim()}`;

        // Leave previous conversation room if switching
        if (data.activeConversationId && data.activeConversationId !== conversationId) {
          socket.leave(`conversation:${data.activeConversationId}`);
        }

        socket.join(targetRoom);
        data.activeConversationId = conversationId.trim();
        socket.emit('joined:conversation', { conversationId: data.activeConversationId });
      });

      // Handle leaving conversation room
      socket.on('leave:conversation', (payload: unknown) => {
        if (!payload || typeof payload !== 'object') return;
        const conversationId = (payload as { conversationId?: unknown }).conversationId;
        if (typeof conversationId !== 'string' || !conversationId.trim()) return;

        socket.leave(`conversation:${conversationId.trim()}`);
        if (data.activeConversationId === conversationId.trim()) {
          data.activeConversationId = undefined;
        }
      });

      socket.on('disconnect', () => {
        // Clean disconnect handled by Socket.IO
      });
    });

    return this.io;
  }

  /**
   * Retrieves the raw Socket.IO server instance.
   */
  getIO(): SocketIOServer | null {
    return this.io;
  }

  /**
   * Emits a new message event to:
   * 1. The specific conversation room ("conversation:<id>") for the active chat window.
   * 2. The tenant organization room ("org:<orgId>") for the CRM inbox preview & unread counts.
   */
  emitNewMessage(organizationId: string, message: MessageRecord): void {
    if (!this.io) return;

    // 1. Thread-level event for active conversation participants
    this.io.to(`conversation:${message.conversationId}`).emit('message:new', message);

    // 2. Organization-level event for inbox list updates
    this.io.to(`org:${organizationId}`).emit('conversation:message', {
      conversationId: message.conversationId,
      message
    });
  }

  /**
   * Emits a message delivery status change (sent -> delivered -> read -> failed)
   * to all connected CRM clients in the organization.
   */
  emitMessageStatus(organizationId: string, event: MessageStatusEvent): void {
    if (!this.io) return;
    this.io.to(`org:${organizationId}`).emit('message:status', event);
  }

  /**
   * Emits a conversation metadata change (e.g. AI toggled, unread count reset, resolved).
   */
  emitConversationUpdated(organizationId: string, conversation: ConversationRecord): void {
    if (!this.io) return;
    this.io.to(`org:${organizationId}`).emit('conversation:updated', conversation);
  }

  /**
   * Emits a conversation deleted event to remove the thread from connected CRM clients.
   */
  emitConversationDeleted(organizationId: string, conversationId: string): void {
    if (!this.io) return;
    this.io.to(`org:${organizationId}`).emit('conversation:deleted', { conversationId });
    this.io.to(`conversation:${conversationId}`).emit('conversation:deleted', { conversationId });
  }

  /**
   * Emits a messages cleared event to clear the active chat window on connected CRM clients.
   */
  emitMessagesCleared(organizationId: string, conversationId: string): void {
    if (!this.io) return;
    this.io.to(`conversation:${conversationId}`).emit('messages:cleared', { conversationId });
    this.io.to(`org:${organizationId}`).emit('messages:cleared', { conversationId });
  }
}

export const socketService = new SocketService();

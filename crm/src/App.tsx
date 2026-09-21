import React, { useState, useEffect } from 'react';
import { Sidebar, WorkspaceTab } from './components/layout/Sidebar.js';
import { ConversationList } from './components/chat/ConversationList.js';
import { ChatWindow } from './components/chat/ChatWindow.js';
import { KitSelectorModal } from './components/chat/KitSelectorModal.js';
import { CatalogGrid } from './components/catalog/CatalogGrid.js';
import { OrdersPipeline } from './components/orders/OrdersPipeline.js';
import { SettingsWorkspace } from './components/settings/SettingsWorkspace.js';
import { Conversation, Message } from './types/crm.types.js';
import { crmApi } from './services/api.js';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isKitModalOpen, setIsKitModalOpen] = useState(false);
  const [isWhatsAppConnected, setIsWhatsAppConnected] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(false);

  // Poll for conversation list and WhatsApp connection status
  useEffect(() => {
    loadConversations();
    checkConnectionStatus();

    // Periodic polling every 4 seconds to catch new incoming WhatsApp messages
    const interval = setInterval(() => {
      loadConversations();
      if (activeConversationId) {
        loadMessages(activeConversationId, false);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [activeConversationId]);

  // When active conversation changes, load its message thread
  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId, true);
    } else {
      setActiveConversation(null);
      setMessages([]);
    }
  }, [activeConversationId]);

  const checkConnectionStatus = async () => {
    try {
      const status = await crmApi.getWhatsAppStatus();
      setIsWhatsAppConnected(Boolean(status?.isConnected));
    } catch {
      // Backend not reached or offline
    }
  };

  const loadConversations = async () => {
    try {
      const data = await crmApi.getConversations();
      setConversations(data);
      if (!activeConversationId && data.length > 0) {
        setActiveConversationId(data[0].id);
      }
    } catch {
      // Ignored during background poll
    }
  };

  const loadMessages = async (id: string, showLoader = false) => {
    try {
      if (showLoader) setIsLoadingChats(true);
      const res = await crmApi.getMessages(id);
      if (res) {
        setActiveConversation(res.conversation);
        setMessages(res.messages || []);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      if (showLoader) setIsLoadingChats(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!activeConversationId) return;
    const sent = await crmApi.sendTextMessage(activeConversationId, text);
    setMessages((prev) => [...prev, sent]);

    // Update conversation state locally to reflect Human Takeover
    if (activeConversation) {
      setActiveConversation({ ...activeConversation, isAiEnabled: false });
    }
  };

  const handleSendKitCard = async (jerseyId: string, customPrice?: number) => {
    if (!activeConversationId) return;
    const sent = await crmApi.sendKitCard(activeConversationId, jerseyId, customPrice);
    setMessages((prev) => [...prev, sent]);
  };

  const handleToggleAi = async (isAiEnabled: boolean) => {
    if (!activeConversationId) return;
    await crmApi.toggleAi(activeConversationId, isAiEnabled);
    if (activeConversation) {
      setActiveConversation({ ...activeConversation, isAiEnabled });
    }
  };

  const unreadTotal = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Primary Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        unreadTotal={unreadTotal}
        isWhatsAppConnected={isWhatsAppConnected}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 flex overflow-hidden">
        {activeTab === 'chat' && (
          <>
            <ConversationList
              conversations={conversations}
              activeId={activeConversationId}
              onSelect={setActiveConversationId}
              isLoading={isLoadingChats}
            />
            <ChatWindow
              conversation={activeConversation}
              messages={messages}
              onSendMessage={handleSendMessage}
              onOpenKitSelector={() => setIsKitModalOpen(true)}
              onToggleAi={handleToggleAi}
            />
          </>
        )}

        {activeTab === 'catalog' && <CatalogGrid />}

        {activeTab === 'orders' && <OrdersPipeline />}

        {activeTab === 'settings' && <SettingsWorkspace />}
      </main>

      {/* Kit Card Selector Modal */}
      <KitSelectorModal
        isOpen={isKitModalOpen}
        onClose={() => setIsKitModalOpen(false)}
        onSendKit={handleSendKitCard}
      />
    </div>
  );
};

export default App;

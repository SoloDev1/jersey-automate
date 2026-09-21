import React, { useState, useRef, useEffect } from 'react';
import { Conversation, Message } from '../../types/crm.types.js';
import { Send, Check, CheckCheck, Shirt, Bot, UserCheck } from 'lucide-react';

interface ChatWindowProps {
  conversation: Conversation | null;
  messages: Message[];
  onSendMessage: (text: string) => Promise<void>;
  onOpenKitSelector: () => void;
  onToggleAi: (isAiEnabled: boolean) => Promise<void>;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  conversation,
  messages,
  onSendMessage,
  onOpenKitSelector,
  onToggleAi
}) => {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!conversation) {
    return (
      <div className="flex-1 bg-slate-950 flex flex-col items-center justify-center text-slate-500">
        <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center text-3xl mb-3">
          ⚽
        </div>
        <p className="text-sm font-medium text-slate-400">Select a conversation to start chatting</p>
        <p className="text-xs text-slate-600 mt-1">Live 2-way WhatsApp messages appear here</p>
      </div>
    );
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending) return;

    try {
      setIsSending(true);
      await onSendMessage(inputText.trim());
      setInputText('');
    } finally {
      setIsSending(false);
    }
  };

  const renderReceipt = (msg: Message) => {
    if (msg.direction !== 'outbound') return null;
    const status = msg.deliveryStatus || 'sent';

    if (status === 'read') {
      return <CheckCheck className="w-3.5 h-3.5 text-sky-400 shrink-0 inline ml-1" />;
    }
    if (status === 'delivered') {
      return <CheckCheck className="w-3.5 h-3.5 text-slate-400 shrink-0 inline ml-1" />;
    }
    return <Check className="w-3.5 h-3.5 text-slate-400 shrink-0 inline ml-1" />;
  };

  return (
    <div className="flex-1 bg-slate-950 flex flex-col min-w-0">
      {/* Chat Header */}
      <div className="p-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-950 border border-emerald-700/60 flex items-center justify-center font-bold text-emerald-400 text-sm">
            {conversation.customerName ? conversation.customerName.charAt(0).toUpperCase() : '⚽'}
          </div>
          <div>
            <h2 className="font-semibold text-sm text-slate-100 flex items-center gap-2">
              {conversation.customerName || 'WhatsApp Customer'}
              <span className="font-mono text-xs font-normal text-slate-400">
                ({conversation.customerPhone})
              </span>
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  conversation.isAiEnabled
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                    : 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
                }`}
              >
                {conversation.isAiEnabled ? (
                  <>
                    <Bot className="w-3 h-3" /> AI Assistant Active
                  </>
                ) : (
                  <>
                    <UserCheck className="w-3 h-3" /> Human Takeover Active
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Toggle AI Button */}
          <button
            onClick={() => onToggleAi(!conversation.isAiEnabled)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              conversation.isAiEnabled
                ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
                : 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            {conversation.isAiEnabled ? 'Pause AI' : 'Resume AI'}
          </button>

          {/* Send Kit Card Button */}
          <button
            onClick={onOpenKitSelector}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Shirt className="w-3.5 h-3.5" />
            Send Kit Card
          </button>
        </div>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#0b141a]">
        {messages.map((msg) => {
          const isOutbound = msg.direction === 'outbound';
          const isKitCard = msg.type === 'interactive_kit';

          return (
            <div
              key={msg.id}
              className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-xl p-3 shadow-md text-sm ${
                  isOutbound
                    ? 'bg-[#005c4b] text-slate-100 rounded-tr-none'
                    : 'bg-[#202c33] text-slate-100 rounded-tl-none'
                }`}
              >
                {/* Interactive Kit Card Display */}
                {isKitCard && msg.jerseyImage && (
                  <div className="mb-2.5 rounded-lg overflow-hidden border border-emerald-600/40 bg-slate-950/40">
                    <img
                      src={msg.jerseyImage}
                      alt={msg.jerseyTitle || 'Jersey'}
                      className="w-full h-44 object-cover"
                    />
                    <div className="p-2.5 bg-slate-900/90">
                      <div className="font-bold text-xs text-white">{msg.jerseyTitle}</div>
                    </div>
                  </div>
                )}

                {/* Message Text Body */}
                <div className="whitespace-pre-wrap break-words leading-relaxed text-xs">
                  {msg.body}
                </div>

                {/* Media Image Attachment */}
                {!isKitCard && msg.mediaUrl && (
                  <div className="mt-2 rounded-md overflow-hidden">
                    <img src={msg.mediaUrl} alt="Attachment" className="max-h-60 rounded object-cover" />
                  </div>
                )}

                {/* Timestamp & Receipt Checkmarks */}
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400/90">
                  <span>
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  {renderReceipt(msg)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Human Takeover Notice Banner */}
      {conversation.isAiEnabled && (
        <div className="px-4 py-1.5 bg-slate-900/90 border-t border-slate-800 text-[11px] text-amber-300 flex items-center justify-center gap-1.5">
          <span>⚠️ Replying manually will automatically pause the AI assistant for this customer</span>
        </div>
      )}

      {/* Composer Input Area */}
      <form
        onSubmit={handleSend}
        className="p-3 bg-slate-900 border-t border-slate-800 flex items-center gap-2 shrink-0"
      >
        <input
          type="text"
          placeholder="Type a message to reply over WhatsApp..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || isSending}
          className="p-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg transition-colors shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};

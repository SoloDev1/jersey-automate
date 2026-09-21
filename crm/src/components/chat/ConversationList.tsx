import React, { useState } from 'react';
import { Conversation } from '../../types/crm.types.js';
import { Search, Bot, User } from 'lucide-react';

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  activeId,
  onSelect,
  isLoading
}) => {
  const [filter, setFilter] = useState<'all' | 'unread' | 'needs_reply'>('all');
  const [search, setSearch] = useState('');

  const filtered = conversations.filter((c) => {
    if (filter === 'unread' && c.unreadCount === 0) return false;
    if (filter === 'needs_reply' && c.status !== 'needs_reply') return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const phoneMatch = c.customerPhone?.toLowerCase().includes(q);
      const nameMatch = c.customerName?.toLowerCase().includes(q);
      return phoneMatch || nameMatch;
    }
    return true;
  });

  return (
    <div className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
      {/* Search Header */}
      <div className="p-3.5 border-b border-slate-800/80 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search phone or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex gap-1.5">
          {(['all', 'unread', 'needs_reply'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                filter === tab
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'needs_reply' ? 'Needs Reply' : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation Thread Items */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50">
        {isLoading && (
          <div className="p-8 text-center text-xs text-slate-400">Loading chats...</div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="p-8 text-center text-xs text-slate-500">No conversations found</div>
        )}

        {filtered.map((conv) => {
          const isSelected = activeId === conv.id;
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`w-full p-3.5 flex items-start gap-3 text-left transition-colors ${
                isSelected
                  ? 'bg-slate-800/80 border-l-4 border-emerald-500'
                  : 'hover:bg-slate-800/40'
              }`}
            >
              {/* Avatar Initial */}
              <div className="w-10 h-10 rounded-full bg-emerald-950 border border-emerald-700/50 flex items-center justify-center font-semibold text-emerald-400 text-sm shrink-0">
                {conv.customerName ? conv.customerName.charAt(0).toUpperCase() : '⚽'}
              </div>

              {/* Thread Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-medium text-sm text-slate-100 truncate">
                    {conv.customerName || conv.customerPhone || 'Customer'}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-400 truncate mb-1">
                  {conv.lastMessagePreview || 'No messages yet'}
                </p>

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="font-mono text-slate-400">{conv.customerPhone}</span>
                  <div className="flex items-center gap-1">
                    {conv.isAiEnabled ? (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                        <Bot className="w-3 h-3" /> AI
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium">
                        <User className="w-3 h-3" /> Human
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

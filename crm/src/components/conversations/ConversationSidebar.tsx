import React, { useState } from 'react';
import { Send, Search, SlidersHorizontal, Inbox, Users, CheckCircle2, Megaphone } from 'lucide-react';
import { Conversation } from '../../types';
import { ConversationCard } from './ConversationCard';

type SegmentId = 'all' | 'assigned' | 'resolved' | 'broadcast';

interface ConversationSidebarProps {
  conversations: Conversation[];
  selectedConversationId: string;
  onSelectConversation: (conv: Conversation) => void;
  onNewChat: () => void;
}

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  selectedConversationId,
  onSelectConversation,
  onNewChat,
}) => {
  const [activeSegment, setActiveSegment] = useState<SegmentId>('assigned');
  const [filterQuery, setFilterQuery] = useState('');

  const filterTabs: { id: SegmentId; label: string; icon: typeof Inbox; count: number }[] = [
    { id: 'all', label: 'All', icon: Inbox, count: 24 },
    { id: 'assigned', label: 'Assigned', icon: Users, count: 8 },
    { id: 'resolved', label: 'Paid & Done', icon: CheckCircle2, count: 36 },
    { id: 'broadcast', label: 'Kits Broadcast', icon: Megaphone, count: 2 },
  ];

  const filteredConversations = conversations.filter((c) => {
    if (filterQuery.trim() === '') return true;
    const q = filterQuery.toLowerCase();
    return (
      c.customer.name.toLowerCase().includes(q) ||
      c.customer.phone.includes(q) ||
      c.lastMessageSnippet.toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-[300px] sm:w-[320px] bg-white border-r border-slate-100 flex flex-col h-full flex-shrink-0 select-none">
      {/* Top CTA Row: + Send Message & Search Button */}
      <div className="p-4 pb-3 flex items-center gap-2">
        <button
          onClick={onNewChat}
          className="flex-1 h-10 px-4 rounded-full bg-gradient-to-r from-teal-500 via-teal-400 to-cyan-500 text-white text-xs font-bold tracking-wide flex items-center justify-center gap-2 hover:brightness-105 active:scale-[0.98] transition-all shadow-md shadow-teal-500/20"
        >
          <Send className="w-3.5 h-3.5 rotate-45" />
          <span>Send Message</span>
        </button>

        <button
          title="Filter conversations"
          className="w-10 h-10 rounded-full border border-slate-200/80 flex items-center justify-center text-slate-500 hover:bg-slate-50 active:scale-95 transition-all"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>

      {/* Segmented Filter Tabs with Counts */}
      <div className="px-4 py-1.5 flex items-center justify-between border-b border-slate-100/80">
        {filterTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSegment === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSegment(tab.id)}
              className={`flex items-center gap-1.5 pb-2.5 pt-1 px-1 border-b-2 text-xs font-semibold transition-all relative ${
                isActive
                  ? 'border-teal-600 text-teal-800'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <Icon className="w-3.5 h-3.5 stroke-[2]" />
              <span className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                isActive ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Section Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-800 tracking-tight">
          {activeSegment === 'assigned' ? 'Assigned Messages' : 'All Conversations'}
        </span>
        <button 
          title="Sort & Filters"
          className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable Conversation Cards List */}
      <div className="flex-1 overflow-y-auto space-y-1 pb-4">
        {filteredConversations.map((conv) => (
          <ConversationCard
            key={conv.id}
            conversation={conv}
            isSelected={conv.id === selectedConversationId}
            onSelect={onSelectConversation}
          />
        ))}
      </div>
    </div>
  );
};

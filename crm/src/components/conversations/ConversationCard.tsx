import React from 'react';
import { Conversation, LeadStage } from '../../types';
import { CornerDownLeft } from 'lucide-react';

interface ConversationCardProps {
  conversation: Conversation;
  isSelected: boolean;
  onSelect: (conv: Conversation) => void;
}

const getStagePillClasses = (stage: LeadStage): string => {
  switch (stage) {
    case 'NEW LEAD':
      return 'bg-cyan-50 text-cyan-700 border-cyan-200/80';
    case 'HOT LEAD':
      return 'bg-amber-50 text-amber-700 border-amber-200/80';
    case 'NEED FOLLOW UP':
      return 'bg-orange-50 text-orange-700 border-orange-200/80';
    case 'WAITING PAYMENT':
      return 'bg-purple-50 text-purple-700 border-purple-200/80';
    case 'PRINTING':
      return 'bg-teal-50 text-teal-700 border-teal-200/80';
    case 'SHIPPED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200/80';
    case 'GOING COLD':
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200/80';
  }
};

export const ConversationCard: React.FC<ConversationCardProps> = ({
  conversation,
  isSelected,
  onSelect,
}) => {
  const { customer, unreadCount, lastMessageSnippet, lastMessageTime, assignedAgent } = conversation;

  return (
    <div
      onClick={() => onSelect(conversation)}
      className={`p-3.5 mx-2 rounded-2xl cursor-pointer transition-all duration-150 border select-none relative group ${
        isSelected
          ? 'bg-slate-50/90 border-slate-200 shadow-sm'
          : 'bg-white border-transparent hover:bg-slate-50/50 hover:border-slate-100'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Customer Avatar & Unread Badge */}
        <div className="relative flex-shrink-0">
          <img
            src={customer.avatarUrl}
            alt={customer.name}
            className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200/60"
          />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white shadow-xs">
              {unreadCount}
            </span>
          )}
        </div>

        {/* Info & Content */}
        <div className="flex-1 min-w-0">
          {/* Header row: Name & Timestamp */}
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <h4 className={`text-xs font-bold truncate ${isSelected ? 'text-slate-900' : 'text-slate-800'}`}>
              {customer.name}
            </h4>
            <span className="text-[11px] font-medium text-slate-400 flex-shrink-0">
              {lastMessageTime}
            </span>
          </div>

          {/* Last message preview */}
          <p className="text-[11px] text-slate-500 truncate leading-relaxed flex items-center gap-1 mb-2">
            <CornerDownLeft className="w-2.5 h-2.5 text-slate-400 flex-shrink-0" />
            <span className="truncate">{lastMessageSnippet}</span>
          </p>

          {/* Footer: Stage Pill & Assigned Agent Mini-Pic */}
          <div className="flex items-center justify-between mt-1">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border tracking-wider uppercase ${getStagePillClasses(
                customer.stage
              )}`}
            >
              {customer.stage}
            </span>

            {/* Assigned agent thumbnail */}
            <div className="flex items-center gap-1" title={`Assigned to ${assignedAgent.name}`}>
              {conversation.isAiEnabled && (
                <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-teal-50 text-teal-700 font-bold border border-teal-200/60">
                  AI
                </span>
              )}
              <img
                src={assignedAgent.avatarUrl}
                alt={assignedAgent.name}
                className="w-4 h-4 rounded-full object-cover ring-1 ring-white"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

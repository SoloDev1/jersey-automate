import React, { useState } from 'react';
import { Bot, UserCheck, ChevronDown, MoreHorizontal, Sparkles } from 'lucide-react';
import { Conversation } from '../../types';

interface ChatHeaderProps {
  conversation: Conversation;
  onToggleAi: () => void;
  onReassign: (agentName: string) => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  conversation,
  onToggleAi,
  onReassign,
}) => {
  const { customer, topic, isAiEnabled, assignedAgent } = conversation;
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);

  const teamAgents = [
    { name: 'Maurice Robbins', role: 'Store Manager', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80' },
    { name: 'Sarah Adeyemi', role: 'Sales & Kit Printing Lead', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80' },
    { name: 'Emeka Okafor', role: 'Logistics & Dispatch', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80' }
  ];

  return (
    <div className="h-16 px-6 border-b border-slate-100 flex items-center justify-between bg-white relative z-20 select-none">
      {/* Topic & Channel details */}
      <div className="flex-1 min-w-0 pr-4">
        <h2 className="text-sm font-bold text-slate-900 truncate">
          {topic}
        </h2>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
          <span>Active WhatsApp Thread</span>
          <span>•</span>
          <span className="font-mono text-slate-500">{customer.phone}</span>
        </div>
      </div>

      {/* Admin Controls */}
      <div className="flex items-center gap-3">
        {/* Admin Function 1: 1-Click AI Auto-Pilot / Human Takeover Switch */}
        <button
          onClick={onToggleAi}
          title={isAiEnabled ? "Click to take over conversation manually" : "Click to activate AI Auto-Reply"}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 border ${
            isAiEnabled
              ? 'bg-teal-50 text-teal-700 border-teal-200/80 shadow-xs hover:bg-teal-100/60'
              : 'bg-amber-50 text-amber-800 border-amber-200/80 shadow-xs hover:bg-amber-100/60'
          }`}
        >
          {isAiEnabled ? (
            <>
              <Sparkles className="w-3.5 h-3.5 text-teal-500 animate-spin" />
              <span>AI Auto-Pilot</span>
            </>
          ) : (
            <>
              <UserCheck className="w-3.5 h-3.5 text-amber-600" />
              <span>Human Takeover</span>
            </>
          )}
        </button>

        {/* Admin Function 2: Assignee Selector Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowAssignDropdown(!showAssignDropdown)}
            className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-slate-200 hover:bg-slate-50 transition-all text-xs text-slate-700"
          >
            <img
              src={assignedAgent.avatarUrl}
              alt={assignedAgent.name}
              className="w-5 h-5 rounded-full object-cover"
            />
            <span className="font-medium max-w-[90px] truncate">{assignedAgent.name}</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {showAssignDropdown && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-apple-card border border-slate-100 p-2 z-50">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
                Assign In-Store Staff
              </p>
              {teamAgents.map((agent) => (
                <button
                  key={agent.name}
                  onClick={() => {
                    onReassign(agent.name);
                    setShowAssignDropdown(false);
                  }}
                  className="w-full flex items-center gap-2.5 p-2 rounded-xl text-left hover:bg-slate-50 transition-colors"
                >
                  <img src={agent.avatar} alt={agent.name} className="w-6 h-6 rounded-full object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800 truncate">{agent.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{agent.role}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* More Actions Menu */}
        <button 
          title="Conversation options"
          className="w-8 h-8 rounded-full border border-slate-200/80 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

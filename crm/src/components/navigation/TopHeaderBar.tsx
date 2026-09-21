import React from 'react';
import { Search, Zap, Bell } from 'lucide-react';

interface TopHeaderBarProps {
  title?: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onQuickAction?: () => void;
}

export const TopHeaderBar: React.FC<TopHeaderBarProps> = ({
  title = "Conversations",
  searchQuery,
  onSearchChange,
  onQuickAction,
}) => {
  return (
    <header className="h-16 px-6 border-b border-slate-100 flex items-center justify-between bg-white select-none">
      {/* Title */}
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
      </div>

      {/* Center Search Pill */}
      <div className="w-full max-w-md mx-6">
        <div className="relative flex items-center">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search customer phone, jersey team, order #..."
            className="w-full h-9 pl-4 pr-10 rounded-full bg-slate-50 border border-slate-200/80 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-150"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 pointer-events-none" />
        </div>
      </div>

      {/* Right Controls: Meta API Live Status, Quick Zap, Bell, Profile */}
      <div className="flex items-center gap-3">
        {/* WhatsApp Meta API Live Badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium border border-emerald-200/60">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Meta Cloud API Online</span>
        </div>

        {/* Quick Zap Action */}
        <button
          onClick={onQuickAction}
          title="Quick Order & Stock Hold"
          className="w-8 h-8 rounded-full bg-amber-400 text-slate-900 flex items-center justify-center hover:bg-amber-300 active:scale-95 transition-all shadow-sm"
        >
          <Zap className="w-4 h-4 fill-current stroke-none" />
        </button>

        {/* Notifications */}
        <button 
          title="Notifications"
          className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center relative hover:bg-slate-200 active:scale-95 transition-all"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
            2
          </span>
        </button>

        {/* Divider */}
        <div className="w-[1px] h-6 bg-slate-200 mx-1" />

        {/* Manager User Profile */}
        <div className="flex items-center gap-2.5 cursor-pointer pl-1 group">
          <div className="text-right">
            <p className="text-xs font-bold text-slate-900 leading-tight group-hover:text-teal-700 transition-colors">
              Maurice Robbins
            </p>
            <p className="text-[11px] font-normal text-slate-400 leading-none">Store Manager</p>
          </div>
          <div className="relative">
            <img
              src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80"
              alt="Maurice Robbins"
              className="w-9 h-9 rounded-full object-cover ring-2 ring-slate-100 group-hover:ring-teal-500/30 transition-all"
            />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white absolute bottom-0 right-0" />
          </div>
        </div>
      </div>
    </header>
  );
};

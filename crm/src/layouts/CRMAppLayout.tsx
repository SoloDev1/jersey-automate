import React from 'react';
import { IconNavDock } from '../components/navigation/IconNavDock';
import { TopHeaderBar } from '../components/navigation/TopHeaderBar';

interface CRMAppLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onQuickAction: () => void;
}

export const CRMAppLayout: React.FC<CRMAppLayoutProps> = ({
  children,
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  onQuickAction,
}) => {
  return (
    <div className="w-screen h-screen ambient-bg flex items-center justify-center p-3 sm:p-5 lg:p-6 select-none overflow-hidden">
      {/* Floating Rounded Canvas Shell (Apple HIG Window Frame) */}
      <div className="w-full h-full max-w-[1580px] bg-white rounded-[28px] border border-white/80 shadow-apple-floating flex overflow-hidden ring-1 ring-black/5">
        {/* Leftmost Dark Evergreen Navigation Dock */}
        <IconNavDock activeTab={activeTab} onTabChange={onTabChange} />

        {/* Main Work Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Top Header Bar */}
          <TopHeaderBar
            title="Conversations"
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            onQuickAction={onQuickAction}
          />

          {/* 3-Column Content Workspace */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

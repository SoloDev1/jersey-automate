import React from 'react';
import { MessageSquare, Shirt, PackageCheck, Settings, Radio } from 'lucide-react';

export type WorkspaceTab = 'chat' | 'catalog' | 'orders' | 'settings';

interface SidebarProps {
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  unreadTotal: number;
  isWhatsAppConnected: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  unreadTotal,
  isWhatsAppConnected
}) => {
  const navItems = [
    {
      id: 'chat' as WorkspaceTab,
      label: 'Live Chat',
      icon: MessageSquare,
      badge: unreadTotal > 0 ? unreadTotal : null
    },
    {
      id: 'catalog' as WorkspaceTab,
      label: 'Kits Catalog',
      icon: Shirt
    },
    {
      id: 'orders' as WorkspaceTab,
      label: 'Orders Pipeline',
      icon: PackageCheck
    },
    {
      id: 'settings' as WorkspaceTab,
      label: 'Settings & AI',
      icon: Settings
    }
  ];

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between shrink-0">
      <div>
        {/* Logo & Store Branding */}
        <div className="p-5 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">⚽</span>
            <div>
              <h1 className="font-bold text-base tracking-tight text-white">Jersey Automate</h1>
              <p className="text-xs text-slate-400">Store Owner CRM</p>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="p-3 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && (
                  <span className="bg-red-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Connection Status */}
      <div className="p-4 border-t border-slate-800/80">
        <div className="flex items-center justify-between bg-slate-900 px-3 py-2 rounded-md border border-slate-800">
          <div className="flex items-center gap-2">
            <Radio
              className={`w-4 h-4 ${
                isWhatsAppConnected ? 'text-emerald-400 animate-pulse' : 'text-slate-500'
              }`}
            />
            <span className="text-xs font-medium text-slate-300">
              {isWhatsAppConnected ? 'WhatsApp Live' : 'Not Connected'}
            </span>
          </div>
          <span
            className={`w-2 h-2 rounded-full ${
              isWhatsAppConnected ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
        </div>
      </div>
    </aside>
  );
};

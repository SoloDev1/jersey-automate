import React from 'react';
import { 
  MessageSquare, 
  Shirt, 
  Package, 
  Users, 
  Calendar, 
  BarChart2, 
  Wrench, 
  Headphones, 
  Settings, 
  ChevronsRight 
} from 'lucide-react';

interface IconNavDockProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const IconNavDock: React.FC<IconNavDockProps> = ({ activeTab, onTabChange }) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart2 },
    { id: 'chat', label: 'Conversations', icon: MessageSquare, badge: 2 },
    { id: 'catalog', label: 'Kit Catalog', icon: Shirt },
    { id: 'orders', label: 'Orders & Pipeline', icon: Package, badge: 1 },
    { id: 'calendar', label: 'Delivery Schedule', icon: Calendar },
    { id: 'customers', label: 'Customer Directory', icon: Users },
    { id: 'tools', label: 'Stock Reconciliation', icon: Wrench },
    { id: 'support', label: 'WhatsApp Health', icon: Headphones },
  ];

  return (
    <aside className="w-[76px] bg-[#0b3834] flex flex-col items-center py-6 justify-between select-none flex-shrink-0 transition-all duration-300">
      {/* Brand Crest */}
      <div className="flex flex-col items-center gap-6">
        <button 
          title="Jersey Automate Hub"
          className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-teal-500/20 to-teal-400/10 border border-teal-400/30 flex items-center justify-center text-teal-300 hover:scale-105 active:scale-95 transition-all duration-200 shadow-sm"
        >
          <svg className="w-6 h-6 fill-none stroke-current stroke-2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        </button>

        {/* Primary Navigation Icons */}
        <nav className="flex flex-col items-center gap-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <div key={item.id} className="relative group">
                <button
                  onClick={() => onTabChange(item.id)}
                  title={item.label}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 relative ${
                    isActive
                      ? 'bg-white text-[#0b3834] shadow-md shadow-black/20 font-semibold'
                      : 'text-teal-200/70 hover:text-white hover:bg-white/10 active:scale-95'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.8]'}`} />
                  {item.badge && !isActive && (
                    <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-accent-teal rounded-full ring-2 ring-[#0b3834]" />
                  )}
                </button>

                {/* Apple HIG Tooltip */}
                <span className="absolute left-[78px] top-1/2 -translate-y-1/2 px-2.5 py-1 bg-slate-900/90 text-white text-xs font-medium rounded-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap z-50 shadow-lg backdrop-blur-md">
                  {item.label}
                </span>
              </div>
            );
          })}
        </nav>
      </div>

      {/* Dock Bottom Items */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() => onTabChange('settings')}
          title="Store Settings & WhatsApp API"
          className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 text-teal-200/70 hover:text-white hover:bg-white/10 active:scale-95 ${
            activeTab === 'settings' ? 'bg-white text-[#0b3834]' : ''
          }`}
        >
          <Settings className="w-5 h-5 stroke-[1.8]" />
        </button>

        <button 
          title="Collapse Sidebar"
          className="w-10 h-10 rounded-full flex items-center justify-center text-teal-200/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};

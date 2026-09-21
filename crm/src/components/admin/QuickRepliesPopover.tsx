import React from 'react';
import { X, Zap, ChevronRight } from 'lucide-react';

interface QuickRepliesPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectReply: (replyText: string) => void;
}

export const QuickRepliesPopover: React.FC<QuickRepliesPopoverProps> = ({
  isOpen,
  onClose,
  onSelectReply,
}) => {
  if (!isOpen) return null;

  const replies = [
    {
      title: 'Size Guide & Fit',
      category: 'Sizing',
      text: '📏 Our authentic player-issue kits feature an athletic slim cut. If you prefer a relaxed fit, we recommend sizing up one size (e.g. from Medium to Large). Would you like our exact chest measurements chart?'
    },
    {
      title: 'Direct Bank Transfer Details',
      category: 'Payment',
      text: '🏦 You can transfer directly to our store business account:\nBank: GTBank\nAccount: 0123456789\nName: Jersey Automate Hub\nPlease reply with your payment receipt once sent!'
    },
    {
      title: 'Delivery & Shipping Schedule',
      category: 'Logistics',
      text: '🚚 Deliveries within Lagos arrive same-day or next-day via dispatch rider. Interstate deliveries nationwide take 24–48 hours via GIG Logistics with full tracking.'
    },
    {
      title: 'Name & Number Printing Quality',
      category: 'Customization',
      text: '⭐ We use official heat-pressed flocking and vinyl with a 100% anti-peel guarantee. Machine wash cold inside out to preserve the print forever!'
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-apple-modal border border-slate-100 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">Canned WhatsApp Quick Replies</h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* List of Replies */}
        <div className="p-3 space-y-2 max-h-[360px] overflow-y-auto">
          {replies.map((r, idx) => (
            <div
              key={idx}
              onClick={() => {
                onSelectReply(r.text);
                onClose();
              }}
              className="p-3 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-teal-50/50 hover:border-teal-200 cursor-pointer transition-all group"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-slate-800 group-hover:text-teal-800">
                  {r.title}
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-500">
                  {r.category}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                {r.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

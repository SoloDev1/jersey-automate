import React, { useState } from 'react';
import { Paperclip, Send, Shirt, Zap, CreditCard, AtSign } from 'lucide-react';

interface FloatingComposerProps {
  onSendMessage: (text: string) => void;
  onOpenKitPicker: () => void;
  onOpenQuickReplies: () => void;
  onOpenCreateOrder: () => void;
}

export const FloatingComposer: React.FC<FloatingComposerProps> = ({
  onSendMessage,
  onOpenKitPicker,
  onOpenQuickReplies,
  onOpenCreateOrder,
}) => {
  const [text, setText] = useState('');

  const handleSend = () => {
    if (!text.trim()) return;
    onSendMessage(text);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="p-4 bg-white/60 backdrop-blur-md border-t border-slate-100 flex flex-col gap-2">
      {/* Top Admin Quick Actions Toolbar */}
      <div className="flex items-center gap-2 px-1">
        <button
          onClick={onOpenKitPicker}
          title="Share Kit from FootyHeadlines Catalog"
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 hover:bg-teal-50 hover:text-teal-700 hover:border-teal-200 text-slate-700 text-[11px] font-semibold transition-all border border-slate-200/80 active:scale-95"
        >
          <Shirt className="w-3.5 h-3.5 text-teal-600" />
          <span>Insert Kit Card</span>
        </button>

        <button
          onClick={onOpenQuickReplies}
          title="Canned WhatsApp Answers"
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-200 text-slate-700 text-[11px] font-semibold transition-all border border-slate-200/80 active:scale-95"
        >
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          <span>Quick Replies</span>
        </button>

        <button
          onClick={onOpenCreateOrder}
          title="Generate Paystack Link & 30-min Stock Reservation"
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 hover:bg-cyan-50 hover:text-cyan-700 hover:border-cyan-200 text-slate-700 text-[11px] font-semibold transition-all border border-slate-200/80 active:scale-95"
        >
          <CreditCard className="w-3.5 h-3.5 text-cyan-600" />
          <span>Create Paystack Invoice</span>
        </button>
      </div>

      {/* Floating Pill Input Bar */}
      <div className="h-12 px-3 rounded-full bg-white border border-slate-200 shadow-apple-card flex items-center gap-2">
        {/* Attachment Paperclip */}
        <button
          type="button"
          title="Attach photo or size chart"
          className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Input */}
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message to customer..."
          className="flex-1 text-xs text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none"
        />

        {/* Formatting / Mention tools */}
        <div className="flex items-center gap-1 text-slate-400 text-xs font-serif px-1">
          <span className="cursor-pointer hover:text-slate-600 font-bold px-1">Ab</span>
          <button 
            type="button"
            title="Mention product"
            className="w-6 h-6 flex items-center justify-center hover:text-slate-600"
          >
            <AtSign className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Send Action */}
        <button
          onClick={handleSend}
          disabled={!text.trim()}
          title="Send via WhatsApp"
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
            text.trim()
              ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-md shadow-teal-500/20 hover:scale-105 active:scale-95'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          <Send className="w-4 h-4 rotate-45" />
        </button>
      </div>
    </div>
  );
};

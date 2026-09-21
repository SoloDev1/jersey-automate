import React, { useState, useEffect } from 'react';
import { Jersey } from '../../types/crm.types.js';
import { crmApi } from '../../services/api.js';
import { X, Search, Check, Send } from 'lucide-react';

interface KitSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendKit: (jerseyId: string, customPrice?: number) => Promise<void>;
}

export const KitSelectorModal: React.FC<KitSelectorModalProps> = ({
  isOpen,
  onClose,
  onSendKit
}) => {
  const [jerseys, setJerseys] = useState<Jersey[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customPrice, setCustomPrice] = useState<string>('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadKits();
    }
  }, [isOpen]);

  const loadKits = async () => {
    try {
      setIsLoading(true);
      const data = await crmApi.getCatalog(search);
      setJerseys(data);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleSelect = (jersey: Jersey) => {
    setSelectedId(jersey.id);
    setCustomPrice(String(jersey.basePrice));
  };

  const handleSend = async () => {
    if (!selectedId) return;
    try {
      setIsSending(true);
      const priceNum = customPrice ? Number(customPrice) : undefined;
      await onSendKit(selectedId, priceNum);
      onClose();
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚽</span>
            <h3 className="font-bold text-base text-white">Select Jersey to Send</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-slate-800/80">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search team or jersey title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadKits()}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Kits Grid */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {isLoading && (
            <div className="col-span-full py-12 text-center text-xs text-slate-400">
              Loading catalog jerseys...
            </div>
          )}

          {!isLoading && jerseys.length === 0 && (
            <div className="col-span-full py-12 text-center text-xs text-slate-500">
              No jerseys found. Add jerseys in the Kits Catalog tab.
            </div>
          )}

          {jerseys.map((jersey) => {
            const isSelected = selectedId === jersey.id;
            return (
              <div
                key={jersey.id}
                onClick={() => handleSelect(jersey)}
                className={`cursor-pointer rounded-lg border overflow-hidden transition-all bg-slate-950 ${
                  isSelected
                    ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="relative h-28 bg-slate-900 overflow-hidden">
                  <img
                    src={jersey.imageUrl}
                    alt={jersey.title}
                    className="w-full h-full object-cover"
                  />
                  {isSelected && (
                    <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <h4 className="font-semibold text-xs text-slate-100 truncate">{jersey.title}</h4>
                  <p className="text-[11px] text-emerald-400 font-mono mt-0.5 font-bold">
                    ₦{jersey.basePrice.toLocaleString()}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer with Custom Price and Dispatch CTA */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Offer Price (₦):</span>
            <input
              type="number"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              placeholder="Base price"
              className="w-28 bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!selectedId || isSending}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              {isSending ? 'Sending...' : 'Send Card to WhatsApp'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

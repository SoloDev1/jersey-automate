import React, { useState } from 'react';
import { X, Search, Check, Shirt, Sparkles } from 'lucide-react';
import { JerseyProduct } from '../../types';
import { MOCK_JERSEYS } from '../../data/mockData';

interface KitPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectKit: (kit: JerseyProduct, size: string, name: string, number: string, finalPrice: number) => void;
}

export const KitPickerModal: React.FC<KitPickerModalProps> = ({
  isOpen,
  onClose,
  onSelectKit,
}) => {
  const [selectedJersey, setSelectedJersey] = useState<JerseyProduct>(MOCK_JERSEYS[0]);
  const [selectedSize, setSelectedSize] = useState<string>('L');
  const [customName, setCustomName] = useState<string>('SAKA');
  const [customNumber, setCustomNumber] = useState<string>('7');
  const [search, setSearch] = useState<string>('');

  if (!isOpen) return null;

  const filteredJerseys = MOCK_JERSEYS.filter(j => 
    j.team.toLowerCase().includes(search.toLowerCase()) ||
    j.league.toLowerCase().includes(search.toLowerCase()) ||
    j.title.toLowerCase().includes(search.toLowerCase())
  );

  const printingFee = customName.trim() ? 3000 : 0;
  const shippingFee = 2000;
  const totalPrice = selectedJersey.basePriceNgn + printingFee + shippingFee;

  const handleSend = () => {
    onSelectKit(selectedJersey, selectedSize, customName, customNumber, totalPrice);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-apple-modal border border-slate-100 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-teal-50 border border-teal-200/60 flex items-center justify-center text-teal-700">
              <Shirt className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">FootyHeadlines Scraped Catalog</h3>
              <p className="text-[11px] text-slate-400">Select jersey to inject directly into WhatsApp chat</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Arsenal, Madrid, Premier League, Away..."
              className="w-full h-9 pl-9 pr-4 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
        </div>

        {/* Content Body: Left Kit Selector, Right Customization */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 divide-x divide-slate-100">
          {/* Kit List */}
          <div className="p-4 space-y-2 overflow-y-auto max-h-[360px]">
            {filteredJerseys.map((jersey) => {
              const isSelected = selectedJersey.id === jersey.id;
              return (
                <div
                  key={jersey.id}
                  onClick={() => setSelectedJersey(jersey)}
                  className={`p-2.5 rounded-2xl border cursor-pointer flex items-center gap-3 transition-all ${
                    isSelected
                      ? 'border-teal-500 bg-teal-50/40 ring-2 ring-teal-500/10'
                      : 'border-slate-200/80 hover:bg-slate-50'
                  }`}
                >
                  <img
                    src={jersey.imageUrl}
                    alt={jersey.title}
                    className="w-14 h-14 rounded-xl object-cover ring-1 ring-slate-200"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{jersey.title}</p>
                    <p className="text-[11px] text-slate-500">{jersey.league} • {jersey.kitType}</p>
                    <p className="text-xs font-bold text-teal-700 mt-1 font-mono">
                      ₦{jersey.basePriceNgn.toLocaleString()}
                    </p>
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-teal-600 text-white flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right Configuration: Sizes & Printing */}
          <div className="p-4 space-y-4 bg-slate-50/30">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
                Available Size
              </label>
              <div className="flex flex-wrap gap-2">
                {selectedJersey.sizes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelectedSize(s)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                      selectedSize === s
                        ? 'bg-[#0b3834] text-white border-[#0b3834] shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Printing Section */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Custom Printing (+₦3,000)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">Player Name</span>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value.toUpperCase())}
                    placeholder="e.g. SAKA"
                    className="w-full h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-xs font-mono uppercase font-bold focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">Squad Number</span>
                  <input
                    type="text"
                    value={customNumber}
                    onChange={(e) => setCustomNumber(e.target.value)}
                    placeholder="e.g. 7"
                    className="w-full h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Price Breakdown */}
            <div className="p-3 rounded-2xl bg-white border border-slate-200/80 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Base Jersey:</span>
                <span className="font-mono">₦{selectedJersey.basePriceNgn.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Custom Name & Number:</span>
                <span className="font-mono">₦{printingFee.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Estimated Shipping:</span>
                <span className="font-mono">₦{shippingFee.toLocaleString()}</span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex justify-between font-bold text-slate-900 text-sm">
                <span>Total Quote:</span>
                <span className="text-teal-700 font-mono">₦{totalPrice.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-white flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Sparkles className="w-4 h-4 text-teal-600" />
            <span>High-res CDN image & CTA buttons will be attached</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-full border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              className="px-5 py-2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-xs font-bold hover:brightness-105 active:scale-95 transition-all shadow-md shadow-teal-500/20"
            >
              Send Kit Card to WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

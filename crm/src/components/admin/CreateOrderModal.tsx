import React, { useState } from 'react';
import { X, CreditCard, ShieldCheck, Clock, Check, Send } from 'lucide-react';
import { Customer, JerseyProduct } from '../../types';
import { MOCK_JERSEYS } from '../../data/mockData';

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer;
  onGeneratePaystack: (orderNumber: number, amount: number, url: string) => void;
}

export const CreateOrderModal: React.FC<CreateOrderModalProps> = ({
  isOpen,
  onClose,
  customer,
  onGeneratePaystack,
}) => {
  const [selectedJersey] = useState<JerseyProduct>(MOCK_JERSEYS[0]);
  const [size, setSize] = useState('L');
  const [customName, setCustomName] = useState('SAKA');
  const [customNumber, setCustomNumber] = useState('7');
  const [shippingAddress, setShippingAddress] = useState(customer.address);
  const [isGenerating, setIsGenerating] = useState(false);

  if (!isOpen) return null;

  const jerseyPrice = selectedJersey.basePriceNgn;
  const printingFee = customName ? 3000 : 0;
  const shippingFee = 2000;
  const total = jerseyPrice + printingFee + shippingFee;

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      const randomOrder = Math.floor(1000 + Math.random() * 9000);
      const demoUrl = `https://checkout.paystack.com/pay_inv_${randomOrder}`;
      onGeneratePaystack(randomOrder, total, demoUrl);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-apple-modal border border-slate-100 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-cyan-50 border border-cyan-200/60 flex items-center justify-center text-cyan-700">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Create Paystack Invoice & Reserve Hold</h3>
              <p className="text-[11px] text-slate-400">Generates checkout link + 30-min inventory lock</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-4">
          {/* Customer Bar */}
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
            <div>
              <p className="font-bold text-slate-900">{customer.name}</p>
              <p className="text-slate-500 font-mono text-[11px]">{customer.phone}</p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-cyan-50 text-cyan-700 font-bold text-[10px] border border-cyan-200">
              WhatsApp Buyer
            </span>
          </div>

          {/* Jersey Overview */}
          <div className="flex items-center gap-3 p-3 rounded-2xl border border-slate-100 bg-white">
            <img
              src={selectedJersey.imageUrl}
              alt={selectedJersey.title}
              className="w-12 h-12 rounded-xl object-cover ring-1 ring-slate-200"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-900 truncate">{selectedJersey.title}</p>
              <p className="text-[11px] text-slate-500">Size: <span className="font-bold text-slate-800">{size}</span> • Print: <span className="font-mono font-bold text-slate-800">{customName} #{customNumber}</span></p>
            </div>
            <span className="text-xs font-bold text-slate-900 font-mono">
              ₦{jerseyPrice.toLocaleString()}
            </span>
          </div>

          {/* Delivery Address */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Delivery Address
            </label>
            <input
              type="text"
              value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)}
              className="w-full h-9 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          {/* Atomic Stock Reservation Banner */}
          <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80 flex items-start gap-2.5 text-xs text-amber-900">
            <Clock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Automatic 30-Minute Physical Stock Hold</p>
              <p className="text-[11px] text-amber-700/90 leading-relaxed">
                Size {size} will be atomically locked in the database. If payment is not completed within 30 minutes, stock returns to the pool automatically.
              </p>
            </div>
          </div>

          {/* Total Breakdown */}
          <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-500">
              <span>Jersey:</span>
              <span className="font-mono">₦{jerseyPrice.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Custom Printing:</span>
              <span className="font-mono">₦{printingFee.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Courier Delivery Fee:</span>
              <span className="font-mono">₦{shippingFee.toLocaleString()}</span>
            </div>
            <div className="pt-2 border-t border-slate-100 flex justify-between items-center">
              <span className="text-xs font-bold text-slate-900 uppercase">Total Invoice:</span>
              <span className="text-base font-extrabold text-teal-700 font-mono">
                ₦{total.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-5 py-2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 hover:brightness-105 active:scale-95 transition-all shadow-md shadow-teal-500/20"
          >
            <Send className="w-3.5 h-3.5 rotate-45" />
            <span>{isGenerating ? 'Generating...' : 'Drop Link into WhatsApp'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

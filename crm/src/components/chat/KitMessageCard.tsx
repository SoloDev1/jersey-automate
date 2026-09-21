import React from 'react';
import { JerseyProduct } from '../../types';
import { CreditCard, Check, Sparkles } from 'lucide-react';

interface KitMessageCardProps {
  jersey: JerseyProduct;
  selectedSize?: string;
  customName?: string;
  customNumber?: string;
  finalPriceNgn: number;
  onCreatePaymentLink?: () => void;
}

export const KitMessageCard: React.FC<KitMessageCardProps> = ({
  jersey,
  selectedSize = 'L',
  customName = 'SAKA',
  customNumber = '7',
  finalPriceNgn,
  onCreatePaymentLink,
}) => {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-apple-card transition-all hover:shadow-lg">
      {/* Kit Photo Banner */}
      <div className="relative h-44 bg-slate-900 overflow-hidden group">
        <img
          src={jersey.imageUrl}
          alt={jersey.title}
          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
        
        {/* League & Season Badge */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-md text-white text-[10px] font-semibold tracking-wide border border-white/10">
          <span>{jersey.league}</span>
          <span>•</span>
          <span>{jersey.season}</span>
        </div>

        {/* In-Stock Indicator */}
        <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-emerald-500/90 text-white text-[10px] font-bold flex items-center gap-1 backdrop-blur-md">
          <Check className="w-3 h-3 stroke-[3]" />
          <span>In Stock</span>
        </div>

        {/* Title over gradient */}
        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white text-xs font-bold tracking-tight truncate drop-shadow-sm">
            {jersey.title}
          </p>
        </div>
      </div>

      {/* Details & Specs */}
      <div className="p-3.5 space-y-3">
        {/* Sizes row */}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
            Available Sizes
          </span>
          <div className="flex items-center gap-1.5">
            {jersey.sizes.map((s) => {
              const isChosen = s === selectedSize;
              return (
                <span
                  key={s}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all ${
                    isChosen
                      ? 'bg-[#0b3834] text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {s}
                </span>
              );
            })}
          </div>
        </div>

        {/* Custom Printing Spec */}
        {customName && (
          <div className="px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500 text-[11px]">Custom Printing:</span>
            <span className="font-bold text-slate-800 tracking-wide font-mono">
              {customName} #{customNumber}
            </span>
          </div>
        )}

        {/* Price & Admin Quick Checkout Button */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div>
            <span className="text-[10px] font-medium text-slate-400 block">Total Quotation</span>
            <span className="text-base font-extrabold text-slate-900 tracking-tight">
              ₦{finalPriceNgn.toLocaleString()}
            </span>
          </div>

          <button
            onClick={onCreatePaymentLink}
            className="h-8 px-3.5 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 hover:brightness-105 active:scale-95 transition-all shadow-sm shadow-teal-500/20"
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Paystack Link</span>
          </button>
        </div>
      </div>
    </div>
  );
};

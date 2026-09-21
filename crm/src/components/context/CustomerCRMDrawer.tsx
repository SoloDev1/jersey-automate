import React, { useState, useEffect } from 'react';
import { 
  Mail, 
  Phone, 
  MapPin, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink, 
  CreditCard, 
  Package, 
  Truck, 
  Send, 
  FileText, 
  CheckCircle,
  Play
} from 'lucide-react';
import { Customer, ActiveOrder, LeadStage } from '../../types';

interface CustomerCRMDrawerProps {
  customer: Customer;
  activeOrder?: ActiveOrder;
  mediaGallery: { id: string; url: string; type: 'image' | 'video'; caption: string }[];
  onUpdateStage: (stage: LeadStage) => void;
  onSendTracking: (trackingNumber: string) => void;
}

export const CustomerCRMDrawer: React.FC<CustomerCRMDrawerProps> = ({
  customer,
  activeOrder,
  mediaGallery,
  onUpdateStage,
  onSendTracking,
}) => {
  const [isJourneyOpen, setIsJourneyOpen] = useState(true);
  const [isMediaOpen, setIsMediaOpen] = useState(true);
  const [isNotesOpen, setIsNotesOpen] = useState(true);
  const [trackingInput, setTrackingInput] = useState(activeOrder?.trackingNumber || 'GIG-9982410-LAG');
  const [staffNote, setStaffNote] = useState(customer.notes);
  const [countdownMinutes, setCountdownMinutes] = useState(24);
  const [countdownSeconds, setCountdownSeconds] = useState(18);

  // Simulated Apple-style ticking hold timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdownSeconds((sec) => {
        if (sec > 0) return sec - 1;
        setCountdownMinutes((min) => (min > 0 ? min - 1 : 0));
        return 59;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="w-[310px] sm:w-[330px] bg-white border-l border-slate-100 flex flex-col h-full flex-shrink-0 overflow-y-auto select-none">
      {/* Top Header metadata */}
      <div className="px-5 pt-4 pb-2 flex items-center justify-between text-xs text-slate-400">
        <span className="font-mono font-bold text-slate-700">#329</span>
        <span>Created {customer.createdAt}</span>
      </div>

      {/* Customer Profile Banner */}
      <div className="px-5 pb-5 text-center flex flex-col items-center border-b border-slate-100/80">
        <div className="relative mb-2">
          <img
            src={customer.avatarUrl}
            alt={customer.name}
            className="w-16 h-16 rounded-full object-cover ring-2 ring-slate-100 shadow-sm"
          />
          <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </div>

        <h3 className="text-sm font-bold text-slate-900 tracking-tight">{customer.name}</h3>

        <div className="flex items-center gap-2 mt-1.5">
          <span className="px-2.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700 text-[10px] font-bold border border-cyan-200/80 tracking-wide uppercase">
            {customer.stage}
          </span>
          <button 
            title="View customer lifetime spend and past orders"
            className="text-[11px] text-teal-600 hover:text-teal-700 font-semibold flex items-center gap-0.5"
          >
            <span>View more info</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Quick Contact Details List */}
      <div className="p-5 space-y-3 border-b border-slate-100/80 text-xs">
        <div className="flex items-center gap-3 text-slate-700 group cursor-pointer">
          <div className="w-7 h-7 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-teal-600 transition-colors">
            <Mail className="w-3.5 h-3.5" />
          </div>
          <span className="truncate group-hover:text-slate-900 transition-colors">{customer.email}</span>
        </div>

        <div className="flex items-center gap-3 text-slate-700 group cursor-pointer">
          <div className="w-7 h-7 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 group-hover:text-teal-600 transition-colors">
            <Phone className="w-3.5 h-3.5" />
          </div>
          <span className="font-mono text-[11px] group-hover:text-slate-900 transition-colors">{customer.phone}</span>
        </div>

        <div className="flex items-center gap-3 text-slate-700">
          <div className="w-7 h-7 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0">
            <MapPin className="w-3.5 h-3.5" />
          </div>
          <span className="truncate">{customer.address}</span>
        </div>

        <div className="flex items-center gap-3 text-slate-700">
          <div className="w-7 h-7 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0">
            <Clock className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] text-slate-500">{customer.timeZone}</span>
        </div>
      </div>

      {/* Accordion 1: Customer Journey / Active Order & Stock Hold */}
      <div className="border-b border-slate-100/80">
        <button
          onClick={() => setIsJourneyOpen(!isJourneyOpen)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
        >
          <span className="text-xs font-bold text-slate-800">Customer Journey</span>
          {isJourneyOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {isJourneyOpen && (
          <div className="px-5 pb-4 space-y-3">
            {activeOrder ? (
              <div className="p-3 rounded-2xl border border-slate-100 bg-slate-50/60 space-y-2.5">
                {/* Order Header & Hold countdown */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-teal-600" />
                    <span className="text-xs font-bold text-slate-900">Order #{activeOrder.orderNumber}</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold border border-amber-200">
                    Hold: {String(countdownMinutes).padStart(2, '0')}:{String(countdownSeconds).padStart(2, '0')}
                  </span>
                </div>

                <p className="text-[11px] text-slate-600 leading-tight font-medium">
                  {activeOrder.jerseyTitle}
                </p>

                {activeOrder.customPrinting && (
                  <div className="text-[10px] bg-white px-2 py-1 rounded-lg border border-slate-200/60 text-slate-700 flex justify-between font-mono">
                    <span>Printing: {activeOrder.customPrinting.name} #{activeOrder.customPrinting.number}</span>
                    <span>{activeOrder.customPrinting.badge}</span>
                  </div>
                )}

                {/* Fulfillment Dispatch Input */}
                <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Courier Dispatch
                  </span>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={trackingInput}
                      onChange={(e) => setTrackingInput(e.target.value)}
                      placeholder="Tracking #"
                      className="flex-1 h-7 px-2 rounded-lg bg-white border border-slate-200 text-[10px] font-mono focus:outline-none"
                    />
                    <button
                      onClick={() => onSendTracking(trackingInput)}
                      title="Send tracking via WhatsApp template"
                      className="h-7 px-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-bold flex items-center gap-1 active:scale-95 transition-all shadow-xs"
                    >
                      <Send className="w-2.5 h-2.5 rotate-45" />
                      <span>Notify</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-1">No active order for this inquiry.</p>
            )}

            <button 
              title="See all historical orders and payments"
              className="text-[11px] font-semibold text-teal-600 hover:text-teal-700"
            >
              View all activity
            </button>
          </div>
        )}
      </div>

      {/* Accordion 2: Images & Kit Media Gallery */}
      <div className="border-b border-slate-100/80">
        <button
          onClick={() => setIsMediaOpen(!isMediaOpen)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
        >
          <span className="text-xs font-bold text-slate-800">Inquired Kits & Photos</span>
          {isMediaOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {isMediaOpen && (
          <div className="px-5 pb-4">
            <div className="grid grid-cols-3 gap-2">
              {mediaGallery.map((item, idx) => (
                <div
                  key={item.id}
                  className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 cursor-pointer group"
                >
                  <img
                    src={item.url}
                    alt={item.caption}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                  {idx === 0 && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      <div className="w-6 h-6 rounded-full bg-white/90 text-slate-900 flex items-center justify-center shadow-xs">
                        <Play className="w-3 h-3 fill-current ml-0.5" />
                      </div>
                    </div>
                  )}
                  {idx === 2 && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs font-bold backdrop-blur-xs">
                      +2 more
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Accordion 3: Private Internal Notes (Staff-only, invisible to customer) */}
      <div className="border-b border-slate-100/80">
        <button
          onClick={() => setIsNotesOpen(!isNotesOpen)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-800">Internal Staff Notes</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-500 font-bold">
              Private
            </span>
          </div>
          {isNotesOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {isNotesOpen && (
          <div className="px-5 pb-4 space-y-2">
            <textarea
              value={staffNote}
              onChange={(e) => setStaffNote(e.target.value)}
              placeholder="Staff notes (e.g. VIP buyer, size preference, discount applied)..."
              rows={3}
              className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] text-slate-700 leading-relaxed focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
            />
            <div className="flex justify-end">
              <button 
                title="Save staff notes"
                className="px-3 py-1 rounded-full bg-slate-900 text-white text-[10px] font-bold hover:bg-slate-800 active:scale-95 transition-all"
              >
                Save Note
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

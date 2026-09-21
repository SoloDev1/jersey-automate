import React, { useState, useEffect } from 'react';
import { Order } from '../../types/crm.types.js';
import { crmApi } from '../../services/api.js';
import { Package, Truck, CheckCircle2, Clock, DollarSign, ChevronRight, ExternalLink } from 'lucide-react';

export const OrdersPipeline: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      setIsLoading(true);
      const data = await crmApi.getOrders();
      setOrders(data);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdvanceStatus = async (order: Order, nextStatus: string) => {
    try {
      const updated = await crmApi.updateOrderStatus(order.id, nextStatus);
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, fulfillmentStatus: updated.fulfillmentStatus } : o))
      );
    } catch (error) {
      console.error('Failed advancing order status:', error);
    }
  };

  const columns = [
    {
      id: 'pending_payment',
      label: 'Pending Payment',
      icon: Clock,
      color: 'text-amber-400',
      bgColor: 'bg-amber-950/20',
      borderColor: 'border-amber-900/40',
      filter: (o: Order) => o.paymentStatus === 'pending'
    },
    {
      id: 'paid',
      label: 'Paid (Ready to Print)',
      icon: DollarSign,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-950/20',
      borderColor: 'border-emerald-900/40',
      filter: (o: Order) => o.paymentStatus === 'paid' && o.fulfillmentStatus === 'unfulfilled'
    },
    {
      id: 'printing',
      label: 'Printing & Preparing',
      icon: Package,
      color: 'text-purple-400',
      bgColor: 'bg-purple-950/20',
      borderColor: 'border-purple-900/40',
      filter: (o: Order) => o.fulfillmentStatus === 'printing'
    },
    {
      id: 'shipped',
      label: 'Shipped (In Transit)',
      icon: Truck,
      color: 'text-sky-400',
      bgColor: 'bg-sky-950/20',
      borderColor: 'border-sky-900/40',
      filter: (o: Order) => o.fulfillmentStatus === 'shipped'
    },
    {
      id: 'delivered',
      label: 'Delivered',
      icon: CheckCircle2,
      color: 'text-slate-400',
      bgColor: 'bg-slate-900/30',
      borderColor: 'border-slate-800',
      filter: (o: Order) => o.fulfillmentStatus === 'delivered'
    }
  ];

  return (
    <div className="flex-1 bg-slate-950 flex flex-col overflow-hidden">
      {/* Pipeline Header */}
      <div className="p-6 border-b border-slate-800 bg-slate-900/60 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg text-white">Sales & Orders Pipeline</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Live tracking from WhatsApp checkout to verified delivery
            </p>
          </div>
          <button
            onClick={loadOrders}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 rounded-lg transition-colors"
          >
            Refresh Orders
          </button>
        </div>
      </div>

      {/* Kanban Board Columns */}
      <div className="flex-1 p-6 overflow-x-auto flex gap-4">
        {isLoading && orders.length === 0 ? (
          <div className="w-full flex items-center justify-center text-xs text-slate-400">
            Loading orders pipeline...
          </div>
        ) : (
          columns.map((col) => {
          const colOrders = orders.filter(col.filter);
          const Icon = col.icon;

          return (
            <div
              key={col.id}
              className={`w-72 shrink-0 rounded-xl border ${col.borderColor} ${col.bgColor} flex flex-col max-h-full`}
            >
              {/* Column Header */}
              <div className="p-3 border-b border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${col.color}`} />
                  <h3 className="font-semibold text-xs text-slate-200">{col.label}</h3>
                </div>
                <span className="text-xs font-mono font-bold text-slate-400 bg-slate-900 px-2 py-0.5 rounded-full">
                  {colOrders.length}
                </span>
              </div>

              {/* Order Cards Container */}
              <div className="p-3 overflow-y-auto space-y-3 flex-1">
                {colOrders.map((order) => (
                  <div
                    key={order.id}
                    className="bg-slate-900 border border-slate-800 rounded-lg p-3 shadow-md hover:border-slate-700 transition-colors"
                  >
                    {/* Order Number & Price */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-xs text-white">#{order.orderNumber}</span>
                      <span className="font-mono text-xs font-bold text-emerald-400">
                        ₦{order.totalAmount.toLocaleString()}
                      </span>
                    </div>

                    {/* Customer Info */}
                    <div className="text-xs text-slate-300 font-medium mb-1">
                      {order.customerName || order.customerPhone || 'Customer'}
                    </div>
                    {order.customerPhone && (
                      <div className="text-[11px] font-mono text-slate-500 mb-2">
                        {order.customerPhone}
                      </div>
                    )}

                    {/* Ordered Items Preview */}
                    <div className="border-t border-slate-800/80 pt-2 mb-3 space-y-1">
                      {order.items?.map((item) => (
                        <div key={item.id} className="text-[11px] text-slate-400">
                          <span className="text-slate-200 font-medium">{item.jerseyTitle || 'Jersey'}</span>{' '}
                          - <span className="font-mono text-emerald-400">Size {item.size}</span>
                          {item.customName && (
                            <div className="text-[10px] text-purple-300">
                              🖨️ Print: {item.customName} #{item.customNumber || ''}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                      {order.paymentStatus === 'pending' && order.paymentUrl ? (
                        <a
                          href={order.paymentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 font-medium"
                        >
                          <ExternalLink className="w-3 h-3" /> Paystack Link
                        </a>
                      ) : (
                        <span className="text-[10px] text-slate-500">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </span>
                      )}

                      {/* Next Stage Transitions */}
                      {col.id === 'paid' && (
                        <button
                          onClick={() => handleAdvanceStatus(order, 'printing')}
                          className="px-2 py-1 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 text-[10px] font-semibold rounded flex items-center gap-1 transition-colors"
                        >
                          To Printing <ChevronRight className="w-3 h-3" />
                        </button>
                      )}

                      {col.id === 'printing' && (
                        <button
                          onClick={() => handleAdvanceStatus(order, 'shipped')}
                          className="px-2 py-1 bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 text-[10px] font-semibold rounded flex items-center gap-1 transition-colors"
                        >
                          Mark Shipped <ChevronRight className="w-3 h-3" />
                        </button>
                      )}

                      {col.id === 'shipped' && (
                        <button
                          onClick={() => handleAdvanceStatus(order, 'delivered')}
                          className="px-2 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 text-[10px] font-semibold rounded flex items-center gap-1 transition-colors"
                        >
                          Delivered <CheckCircle2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }))}
      </div>
    </div>
  );
};

import React from 'react';
import { Message, Customer } from '../../types';
import { KitMessageCard } from './KitMessageCard';
import { CheckCheck } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
  customer: Customer;
  agentAvatarUrl: string;
  onCreatePaymentLink?: () => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  customer,
  agentAvatarUrl,
  onCreatePaymentLink,
}) => {
  if (message.type === 'system_alert') {
    return (
      <div className="flex justify-center my-4">
        <span className="px-4 py-1 rounded-full bg-slate-100/90 text-slate-500 text-[11px] font-medium border border-slate-200/50 shadow-xs">
          {message.body}
        </span>
      </div>
    );
  }

  const isInbound = message.direction === 'inbound';

  return (
    <div className={`flex items-end gap-2.5 my-3 ${isInbound ? 'justify-start' : 'justify-end'}`}>
      {/* Customer Avatar on Left for Inbound */}
      {isInbound && (
        <img
          src={customer.avatarUrl}
          alt={customer.name}
          className="w-7 h-7 rounded-full object-cover flex-shrink-0 ring-1 ring-slate-200/60 mb-1"
        />
      )}

      {/* Bubble Content */}
      <div className={`max-w-[78%] flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}>
        {/* Author Label */}
        <span className="text-[10px] font-medium text-slate-400 mb-1 px-1">
          {isInbound ? customer.name : 'Maurice Robbins (You)'}
        </span>

        {/* Regular Text Bubble */}
        {message.type === 'text' && (
          <div
            className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed shadow-apple-subtle ${
              isInbound
                ? 'bg-white text-slate-800 border border-slate-100 rounded-bl-xs'
                : 'bg-slate-100/90 text-slate-900 border border-slate-200/60 rounded-br-xs font-normal'
            }`}
          >
            <p className="whitespace-pre-wrap">{message.body}</p>
          </div>
        )}

        {/* Interactive Kit Card */}
        {message.type === 'interactive_kit' && message.kitData && (
          <div className="space-y-2">
            <p className="text-xs text-slate-600 px-1">{message.body}</p>
            <KitMessageCard
              jersey={message.kitData.jersey}
              selectedSize={message.kitData.selectedSize}
              customName={message.kitData.customName}
              customNumber={message.kitData.customNumber}
              finalPriceNgn={message.kitData.finalPriceNgn}
              onCreatePaymentLink={onCreatePaymentLink}
            />
          </div>
        )}

        {/* Timestamp & Delivery Indicators */}
        <div className="flex items-center gap-1 mt-1 px-1 text-[10px] text-slate-400">
          <span>{message.timestamp}</span>
          {!isInbound && (
            <CheckCheck
              className={`w-3.5 h-3.5 ${
                message.deliveryStatus === 'read' ? 'text-cyan-500' : 'text-slate-400'
              }`}
            />
          )}
        </div>
      </div>

      {/* Agent Avatar on Right for Outbound */}
      {!isInbound && (
        <img
          src={agentAvatarUrl}
          alt="Agent"
          className="w-7 h-7 rounded-full object-cover flex-shrink-0 ring-1 ring-slate-200/60 mb-1"
        />
      )}
    </div>
  );
};

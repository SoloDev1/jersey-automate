# Frontend CRM Specification (Single-Owner)

This document specifies the user interface, component architecture, state management, and user experience for the **Jersey Automate Store Owner CRM**.

---

## 🖥️ UI Layout Overview

The CRM consists of a sleek sidebar layout with four core workspaces:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  JERSEY AUTOMATE ⚽                                           [● Online]     │
├────────────┬────────────────────────────────────────────────────────────────┤
│            │                                                                │
│ 💬 Live    │                     WORKSPACE AREA                             │
│    Chat    │                                                                │
│            │   [Active View: Live WhatsApp Chat / Inventory / Orders]       │
│ 👕 Kits &  │                                                                │
│   Catalog  │                                                                │
│            │                                                                │
│ 📦 Orders  │                                                                │
│   Pipeline │                                                                │
│            │                                                                │
│ ⚙️ Settings│                                                                │
│            │                                                                │
└────────────┴────────────────────────────────────────────────────────────────┘
```

---

## 📱 Module Specifications

### 1. Live WhatsApp Chat (Primary Screen)
Designed for high-speed WhatsApp customer support and sales conversion:
- **Left Column: Conversation List**
  - Customer profile name and phone number (`+1 234 567 8900`).
  - Unread badge indicator (red pill count).
  - Last message snippet and relative timestamp ("2m ago", "1h ago").
  - Filter pills: `All`, `Unread`, `Needs Reply`.
- **Center Column: Active Message Thread**
  - Bubble history showing inbound (grey) and outbound (green) WhatsApp messages.
  - Media display: in-line images with full-resolution zoom modal.
  - Interactive Kit Cards: renders kit photo, title, price, and CTA buttons.
  - Delivery indicators: `sent`, `delivered` (double grey checks), `read` (double blue checks).
- **Composer Toolbar**
  - Text input with emoji picker.
  - **"Send Kit Card" Button**: Opens a kit selector drawer. The owner clicks any jersey from the catalog, selects an optional pre-filled price, and clicks "Send to WhatsApp".
  - **"Create Order" Button**: Opens quick order creation modal prefilled with this customer's details.

### 2. Kit Inventory & Catalog Browser
Visual catalog of all scraped and custom jerseys:
- **Header Controls**:
  - Search bar (by team name, league, or season).
  - Filter dropdowns: League (Premier League, La Liga, etc.), Kit Type (Home, Away, 3rd).
  - **"Sync Latest Kits" Button**: Triggers the background scraper job with a live progress spinner.
- **Kit Grid / Cards**:
  - High-res kit photo (loaded via Supabase CDN).
  - Club crest / team name and kit title.
  - Retail price badge with inline edit capability.
  - Stock toggle (In Stock / Out of Stock).
  - Size pills (`S`, `M`, `L`, `XL`, `XXL`).
  - Action buttons: "Edit Details", "Share on WhatsApp".

### 3. Orders & Sales Pipeline
Track customer orders from initial inquiry to delivery:
- **Pipeline Stages**:
  - `Pending Payment` ➔ `Paid` ➔ `Preparing Kit (Printing)` ➔ `Shipped` ➔ `Completed`.
- **Order Card Details**:
  - Order Number (e.g. `#1042`).
  - Customer Name & Phone Number (with one-click "Open Chat").
  - Jersey Ordered (e.g. Arsenal 26/27 Away - Size L).
  - Custom Printing: `Name: RICE`, `Number: 41`.
  - Total Price (`$55.00`).
  - Tracking Number input field.
  - One-click button: **"Send Tracking to WhatsApp"** (sends automated dispatch notification to customer).

### 4. Settings & WhatsApp Health Hub
- **Connection Card**:
  - Embedded Signup button or manual token configuration.
  - Current Status: `CONNECTED`, `DISCONNECTED`, or `TOKEN_EXPIRED`.
  - Display Phone Number & Quality Rating (e.g., `GREEN / HIGH`).
  - Webhook URL & Handshake Verify Token.
- **Live Event Log**: Real-time terminal box showing raw incoming Meta webhook events for debugging.

---

## ⚡ Real-Time State Management (Supabase)

```javascript
// Example React Hook: useRealtimeMessages.ts
import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

export function useRealtimeMessages(conversationId) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    // 1. Fetch initial message history
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages(data || []));

    // 2. Subscribe to incoming messages
    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  return messages;
}
```

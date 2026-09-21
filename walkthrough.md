# Walkthrough: Jersey Automate Backend & CRM Implementation

## Summary of Completed Architecture & Milestones

---

### Step 1: Multi-Tenant Database Schema (`database/schema.sql`)
- 15 relational tables with complete Row-Level Security (RLS).
- Size-level inventory (`XS` through `3XL`) with `quantity_on_hand` and `quantity_reserved`.
- Atomic PostgreSQL stored procedures:
  - `reserve_order_stock(order_id, ttl_minutes)`
  - `finalize_order_stock(order_id)`
  - `release_expired_reservations(org_id)`
  - `check_and_record_ai_usage(...)`

---

### Step 2: Backend Core Infrastructure (`backend/src/core/`)
- Strict TypeScript NodeNext ESM setup (`tsconfig.json`).
- Environment configuration with Zod validation (`core/config/env.ts`).
- Multi-tenant context middleware (`req.organizationId` defaulting to `org_default`).
- AES-256-GCM token encryption and E.164 phone normalization.
- 5-minute cron cleaner for expired stock reservations.

---

### Step 3: Catalog Module (`backend/src/modules/catalog/`)
- Full CRUD for jerseys and size-level inventory.
- Real-time stock availability endpoints.
- Scraper import synchronization (`discovered_kits` -> `jerseys`).
- Mounted at `/api/v1/catalog`.

---

### Step 4: Orders & Paystack Payment Modules (`backend/src/modules/orders/` & `backend/src/modules/payments/`)
- **Orders**: Server-side pricing engine, atomic 15-minute stock holds (`reserve_order_stock`), multi-jersey carts, customer persistence.
- **Payments**: Paystack transaction initialization, timing-safe HMAC-SHA512 webhook verification, mandatory Paystack verify API recheck, and atomic stock finalization (`finalize_order_stock`).
- Mounted at `/api/v1/orders` and `/api/v1/payments`.

---

### Step 5: WhatsApp Cloud API & 2-Way Live Chat Module (`backend/src/modules/whatsapp/`, `chat/`, `webhooks/`)
- **Live Chat**: Thread history, unread counters, manual text sending with Instant Human Takeover (`is_ai_enabled = false`), and interactive jersey photo cards.
- **Webhooks**: Meta challenge handshake with constant-time verification, HMAC-SHA256 signature check, sub-50ms HTTP 200 OK acknowledgment, and WAMID message deduplication.
- Mounted at `/api/v1/chat`, `/api/v1/whatsapp`, and `/api/v1/webhooks`.

---

### Step 6: AI Sales Assistant Module (`backend/src/modules/ai/`)
- **Pluggable Architecture**: `AiProvider` interface with OpenAI `gpt-4o-mini` default.
- **Safe Tools**: `search_catalog` (read-only), `check_stock` (read-only), `create_checkout` (mutating with atomic 15-minute stock reservation and Paystack link generation).
- **Pre-Flight Spending Guard**: Checks database budget before making any OpenAI API calls, preventing token costs once the monthly cap is reached.

---

### Step 7: Scraper Pipeline & Cloud Storage Sync (`scraper/scripts/scrape.js`)
- Dual-mode scraper: downloads kit images locally and streams high-res images to Supabase Storage `products` bucket.
- Automatically inserts discovered 2026/27 kits into `discovered_kits` table for one-click store catalog import.

---

### Step 8: Store Owner CRM Frontend (`crm/`)

A Vite + React 18 + TypeScript + Tailwind CSS dashboard with 4 primary workspaces:

1. **Live WhatsApp Chat (`ConversationList.tsx` & `ChatWindow.tsx`)**:
   - Sidebar of customer threads with unread pill counters, customer phone numbers, latest message snippets, and `All / Unread / Needs Reply` filter tabs.
   - Active WhatsApp chat view with inbound (dark slate) and outbound (emerald green) message bubbles.
   - Real-time delivery receipt checkmarks (sent, delivered, read in sky-blue).
   - Renderers for interactive jersey kit photo cards and Paystack payment links.
   - Instant Human Takeover: Disables AI auto-reply when the store owner sends a message.
   - One-click kit injector (`KitSelectorModal.tsx`): select any jersey from catalog, adjust price, and dispatch directly to customer's WhatsApp.
2. **Kits Catalog & Stock Browser (`CatalogGrid.tsx`)**:
   - Search by team/club and filter by league (Premier League, La Liga, Serie A, etc.).
   - Visual kit cards with high-res photos, season tags, inline base price editing, and physical size inventory breakdown (`XS` through `3XL`).
3. **Sales & Orders Pipeline (`OrdersPipeline.tsx`)**:
   - Visual Kanban columns: `Pending Payment`, `Paid (Ready to Print)`, `Printing & Preparing`, `Shipped (In Transit)`, and `Delivered`.
   - Order cards displaying order number, customer phone, ordered jerseys and sizes, custom player shirt printing (`RICE #41`), and status advance buttons.
4. **Settings & Integrations (`SettingsWorkspace.tsx`)**:
   - **WhatsApp Hub**:
     - Status indicator (`Connected & Active` vs `Not Connected`).
     - Manual API Key connection form (Token, Phone Number ID, WABA ID) with AES-256-GCM encryption.
     - Embedded Signup Facebook Login tab guidance.
     - Webhook configuration copy-paste box (Callback URL & Verify Token).
   - **AI Budget Meter**:
     - Visual progress bar showing monthly token spend vs maximum limit (`$0.00 / $15.00 USD`).
     - Hard stop status display.

---

## 🧪 Build & Compilation Verification
1. **Root Backend**: `npm run typecheck` (`tsc -p backend/tsconfig.json --noEmit`) $\to$ **Exited with code 0 (Zero errors)**.
2. **CRM Frontend**: `npm run build` (`tsc && vite build`) $\to$ **Built successfully into `crm/dist/` in 1m 26s with code 0 (Zero errors)**.

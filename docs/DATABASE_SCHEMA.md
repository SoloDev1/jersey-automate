# Multi-Tenant Production Database Schema Documentation (v3.0)

This document describes the multi-tenant production PostgreSQL schema defined in [`database/schema.sql`](file:///c:/Users/USER/Desktop/Jersey%20Automate/database/schema.sql).

---

## 🏛️ Multi-Tenant Architecture

```
                    ┌───────────────────────────────┐
                    │      organizations (Tenants)  │
                    │       (e.g., 'org_default')   │
                    └───────────────┬───────────────┘
                                    │
       ┌────────────────────────────┼───────────────────────────┬─────────────────────────┐
       ▼                            ▼                           ▼                         ▼
┌──────────────┐             ┌──────────────┐            ┌──────────────┐          ┌──────────────┐
│   settings   │             │   jerseys    │            │  customers   │          │    orders    │
│(org_id PK)   │             │ (org_id FK)  │            │ (org_id FK)  │          │ (org_id FK)  │
└──────────────┘             └──────┬───────┘            └──────┬───────┘          └──────┬───────┘
                                    │                           │                         │
                             ┌──────▼───────┐            ┌──────▼───────┐          ┌──────▼───────┐
                             │jersey_invent.│            │conversations │          │ order_items  │
                             │ (org_id FK)  │            │ (org_id FK)  │          │(via order_id)│
                             └──────────────┘            └──────┬───────┘          └──────┬───────┘
                                                                │                         │
                                                         ┌──────▼───────┐          ┌──────▼───────┐
                                                         │   messages   │          │stock_reserv. │
                                                         │ (org_id FK)  │          │ (org_id FK)  │
                                                         └──────────────┘          └──────┬───────┘
                                                                                          │
                                                                                   ┌──────▼───────┐
                                                                                   │   payments   │
                                                                                   │ (org_id FK)  │
                                                                                   └──────────────┘
```

### Shared Global Table:
* **`discovered_kits`**: Stores FootyHeadlines scraped metadata (leagues, teams, seasons, raw photo URLs). This table is global and shared across all tenants so kits are scraped only once. Individual tenants import kits from this discovery pool into their private `jerseys` catalog with their own selling prices and stock levels.

---

## 📋 Table Directory & Tenant Isolation

| Table Name | Primary Key | Tenant Key | Scope | Description |
| :--- | :--- | :--- | :--- | :--- |
| `organizations` | `id` (VARCHAR) | — | System | Tenant identity (e.g. `org_default`, `org_belhomz`) |
| `settings` | `organization_id` | `organization_id` | Tenant Private | Store profile, currency, WhatsApp secrets, AI budget |
| `discovered_kits`| `id` (UUID) | — | Global Shared | Raw FootyHeadlines discovery data |
| `jerseys` | `id` (UUID) | `organization_id` | Tenant Private | Tenant-managed kit catalog & custom retail prices |
| `jersey_inventory`| `id` (UUID) | `organization_id` | Tenant Private | Stock on hand and reserved per size (`S`, `M`, `L`, etc.) |
| `customers` | `id` (UUID) | `organization_id` | Tenant Private | WhatsApp buyers (Phone unique per organization) |
| `conversations` | `id` (UUID) | `organization_id` | Tenant Private | Chat threads with `is_ai_enabled` takeover switch |
| `messages` | `id` (UUID) | `organization_id` | Tenant Private | 2-way message history with unique `meta_message_id` |
| `orders` | `id` (UUID) | `organization_id` | Tenant Private | Sales pipeline with separated payment & fulfillment statuses |
| `order_items` | `id` (UUID) | `order_id` (FK) | Tenant Private | Order items, sizes, custom shirt printing |
| `stock_reservations`| `id` (UUID) | `organization_id`| Tenant Private | Order-linked stock holds with 15-minute TTL |
| `inventory_movements`| `id` (UUID)| `organization_id`| Tenant Private | Immutable audit ledger of all physical & reserved stock changes |
| `payments` | `id` (UUID) | `organization_id` | Tenant Private | Paystack transaction verification payloads |
| `ai_monthly_budgets`| `(organization_id, month_date)`| `organization_id` | Tenant Private | Concurrency-safe monthly spending limits |
| `ai_usage_logs` | `id` (UUID) | `organization_id` | Tenant Private | Append-only token usage and USD cost tracking |
| `audit_logs` | `id` (UUID) | `organization_id` | Tenant Private | Staff action and administrative audit trail |
| `webhook_logs` | `id` (UUID) | `organization_id` | Tenant Private | Raw Meta and Paystack webhook payloads |

---

## ⚙️ Stored Procedures & Atomic Functions

### 1. `reserve_order_stock(p_order_id UUID, p_ttl_minutes INTEGER DEFAULT 15)`
- Locks inventory rows with `FOR UPDATE` in deterministic order (`ORDER BY jersey_id, size`) to prevent deadlocks.
- Enforces `quantity > 0` and validates `quantity_on_hand - quantity_reserved >= quantity`.
- Atomically creates `stock_reservations`, increments `quantity_reserved`, logs to `inventory_movements`, and sets `orders.reservation_expires_at`.

### 2. `finalize_order_stock(p_order_id UUID)`
- Triggered upon verified Paystack payment.
- Idempotently deducts both `quantity_on_hand` and `quantity_reserved`.
- Marks reservations `finalized` and logs a permanent `purchase` movement.

### 3. `release_expired_reservations(p_organization_id VARCHAR DEFAULT NULL)`
- Called every 5 minutes by the Node.js `node-cron` worker on Render.
- Finds all reservations where `status = 'active'` and `expires_at < NOW()`.
- Decrements `quantity_reserved`, marks reservation `expired`, and records a `reservation_release` movement.

### 4. `check_and_record_ai_usage(...)`
- Locks the tenant's monthly budget row in `ai_monthly_budgets` with `FOR UPDATE`.
- Guarantees that two concurrent incoming WhatsApp messages cannot exceed the tenant's monthly spending limit.
- Appends token metrics to `ai_usage_logs`.

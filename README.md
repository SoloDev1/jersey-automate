# Jersey Automate ⚽📲

A clean, production-ready **Jersey E-Commerce CRM & WhatsApp Automation System** built for independent jersey merchants and kit resellers.

Powered by **Node.js, Supabase (PostgreSQL, Realtime, Storage), and Meta WhatsApp Cloud API**.

---

## 🌟 Key Features

- **Automated Kit Scraper & Catalog**: Crawls kit overviews from FootyHeadlines, downloads high-res images, optimizes them, and uploads them directly to Supabase Storage with public CDN URLs.
- **WhatsApp 2-Way Live Chat CRM**: Instant real-time messaging with buyers powered by Supabase Realtime WebSockets.
- **1-Click Kit Cards**: Send high-resolution kit photos, descriptions, sizes, and pricing buttons directly into customer WhatsApp chats.
- **Customer & Order Pipeline**: Track customer phone numbers, jersey requests, custom printing (player name & number), and order status (Pending, Paid, Shipped, Completed).
- **Meta WhatsApp Cloud API**: Supports 1-Click Embedded Signup or direct System User Token connection with HMAC SHA-256 webhook security.
- **Clean Architecture (No Spaghetti Code)**: Decoupled into Routes, Controllers, Domain Services, and Supabase Storage/DB integration.

---

## 🏗️ Architecture & Tech Stack

```
┌────────────────────────────────────────────────────────┐
│               FRONTEND SINGLE-OWNER CRM                │
│             (Vite + React / Tailwind CSS)              │
│    • Live Chat   • Kit Catalog   • Orders   • Settings │
└───────────────────────────┬────────────────────────────┘
                            │ REST APIs & Supabase Realtime
                            ▼
┌────────────────────────────────────────────────────────┐
│                     BACKEND ENGINE                     │
│                    (Node.js / Express)                 │
│  ┌───────────────┐ ┌───────────────┐ ┌──────────────┐  │
│  │ ScraperService│ │WhatsAppService│ │ OrderService │  │
│  └───────┬───────┘ └───────┬───────┘ └──────┬───────┘  │
└──────────┼─────────────────┼────────────────┼──────────┘
           │                 │                │
           ▼                 ▼                ▼
┌────────────────────────────────────────────────────────┐
│             SUPABASE INFRASTRUCTURE (Cloud)           │
│  ┌──────────────────────┐   ┌───────────────────────┐  │
│  │   PostgreSQL 16      │   │   Supabase Storage    │  │
│  │ • jerseys            │   │ • products/ (Kits)    │  │
│  │ • customers          │   │ • chat-attachments/   │  │
│  │ • conversations      │   └───────────────────────┘  │
│  │ • messages           │   ┌───────────────────────┐  │
│  │ • orders             │   │   Supabase Realtime   │  │
│  │ • settings           │   │ • Live Chat Stream    │  │
│  └──────────────────────┘   └───────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

- **Runtime**: Node.js (ES Modules)
- **Database**: PostgreSQL (via Supabase)
- **Object Storage**: Supabase Storage (public buckets for kit photos & chat attachments)
- **Real-Time Layer**: Supabase Realtime (Postgres Change Data Capture over WebSockets)
- **External APIs**: Meta WhatsApp Cloud API (Graph API v21.0)
- **Web Scraping**: Cheerio + Streams

---

## 📁 Repository Structure

```
.
├── backend/                      # Express.js REST API & Meta Webhooks
│   ├── src/
│   │   ├── config/               # Validated environment & configuration
│   │   ├── controllers/          # HTTP request/response handlers
│   │   ├── db/                   # Persistent storage abstraction & Supabase
│   │   ├── middleware/           # HMAC verification & auth handlers
│   │   ├── services/             # Meta Graph & business logic
│   │   ├── utils/                # Crypto & encryption utilities
│   │   └── server.js             # Express application bootstrap
│   ├── public/                   # Meta Embedded Signup & legal compliance pages
│   │   ├── index.html            # Onboarding & Connection Portal
│   │   ├── privacy.html          # Privacy Policy
│   │   └── data-deletion.html    # Data Deletion Request instructions
│   └── tests/                    # Integration & security test suite
│       ├── api.test.js
│       └── verify.test.js
├── crm/                          # Store Owner Frontend CRM (Vite + React)
│   └── README.md
├── scraper/                      # Kit Scraper & Ingestion Pipeline
│   ├── scripts/
│   │   └── scrape.js             # FootyHeadlines crawler & media processor
│   └── downloads/                # Download cache (.gitignored)
├── database/                     # PostgreSQL schema & migrations
│   └── schema.sql                # Complete Supabase PostgreSQL schema
├── docs/                         # Technical Specifications & Guides
│   ├── ARCHITECTURE.md           # System architecture & sequence diagrams
│   ├── API_SPECIFICATION.md      # Complete REST API reference
│   ├── DATABASE_SCHEMA.md        # Database & bucket documentation
│   ├── FRONTEND_CRM_SPEC.md      # Frontend layout & UI component specification
│   ├── SCRAPER_AND_CATALOG_GUIDE.md # FootyHeadlines crawler & storage guide
│   └── WHATSAPP_INTEGRATION_GUIDE.md # Meta WhatsApp setup & webhook guide
├── package.json
└── render.yaml
```

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- Node.js 18+ installed.
- A free account on [Supabase](https://supabase.com).
- A free Meta Developer account on [developers.facebook.com](https://developers.facebook.com).

### 2. Configure Supabase
1. Create a new project in your Supabase Dashboard.
2. Go to the **SQL Editor**, open `database/schema.sql`, and click **Run**.
3. Go to **Storage** and ensure two public buckets exist:
   - `products` (for high-res jersey images)
   - `chat-attachments` (for customer photos & voice notes)
4. Go to **Project Settings -> API** and copy:
   - Project URL (`SUPABASE_URL`)
   - Service Role Key (`SUPABASE_SERVICE_ROLE_KEY`)

### 3. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:

```env
PORT=3000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Meta WhatsApp Cloud API
META_APP_ID=your_facebook_app_id
META_APP_SECRET=your_facebook_app_secret
META_CONFIG_ID=your_embedded_signup_config_id
META_WEBHOOK_VERIFY_TOKEN=create_a_random_secure_string_here
ENCRYPTION_KEY=32_char_hex_key_for_token_encryption
```

### 4. Install Dependencies & Start Server
```bash
npm install
npm start
```
The server will start at `http://localhost:3000`.

---

## 📚 Documentation Index

For in-depth explanations, refer to the documentation files in `docs/`:
- [System Architecture & Layers](file:///c:/Users/USER/Desktop/Jersey%20Automate/docs/ARCHITECTURE.md)
- [Database Schema & SQL](file:///c:/Users/USER/Desktop/Jersey%20Automate/docs/DATABASE_SCHEMA.md)
- [WhatsApp Cloud API & Webhook Guide](file:///c:/Users/USER/Desktop/Jersey%20Automate/docs/WHATSAPP_INTEGRATION_GUIDE.md)
- [Kit Scraper & Storage Pipeline](file:///c:/Users/USER/Desktop/Jersey%20Automate/docs/SCRAPER_AND_CATALOG_GUIDE.md)
- [Frontend CRM Specification](file:///c:/Users/USER/Desktop/Jersey%20Automate/docs/FRONTEND_CRM_SPEC.md)
- [REST API Specification](file:///c:/Users/USER/Desktop/Jersey%20Automate/docs/API_SPECIFICATION.md)

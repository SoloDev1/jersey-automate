# System Architecture: Jersey Automate Engine

This document defines the architectural principles, structural layers, data flow, and security mechanisms of the **Jersey Automate** platform.

---

## 🏛️ Architectural Principles (Eliminating Spaghetti Code)

To prevent the common pitfalls of monolithic, tangled code ("spaghetti code"), this project enforces four design rules:

1. **Separation of Concerns**: Controllers only handle HTTP translation; Services only execute business logic; Repositories/Database clients only execute queries.
2. **Single Direction Dependency Flow**:
   `Routes` ➔ `Controllers` ➔ `Domain Services` ➔ `Supabase Client / Database`. Services never touch Express `req` or `res` objects.
3. **Stateless Backend**: The Node.js application maintains no local memory state. All state is persisted in Supabase (PostgreSQL), allowing seamless redeployments.
4. **Resilient Third-Party Integration**: Meta Graph API failures, rate limits, and network timeouts are trapped in isolated service methods with fallback strategies.

---

## 📐 Layered Architecture

```mermaid
graph TD
    subgraph PresentationLayer ["1. Presentation Layer (Frontend CRM)"]
        UI["React / Vite / Tailwind SPA"]
        RTClient["Supabase Realtime WebSocket Client"]
    end

    subgraph HttpLayer ["2. HTTP & Routing Layer (Express.js)"]
        Routes["Domain Routers (/api/catalog, /api/chat, etc.)"]
        Middlewares["HMAC Verifier, Body Parsers, Error Handler"]
        Controllers["Controllers (DTO validation, status codes)"]
    end

    subgraph ServiceLayer ["3. Domain Service Layer (Pure Business Logic)"]
        ScraperSvc["ScraperService: Crawling, Cheerio, Storage Upload"]
        CatalogSvc["CatalogService: Filtering, Stock, Pricing"]
        WhatsAppSvc["WhatsAppService: Message Dispatch, Interactive Kit Cards"]
        OrderSvc["OrderService: Sales Pipeline, Custom Printing Calculations"]
        MetaGraphSvc["MetaGraphService: OAuth Exchange, WABA Webhooks"]
    end

    subgraph DataLayer ["4. Persistence Layer (Supabase Platform)"]
        PostgresDB[("Supabase PostgreSQL")]
        RealtimeCDC["Supabase Realtime CDC"]
        ObjectStorage["Supabase Storage (products & chat-attachments)"]
    end

    UI -->|HTTP Requests| Routes
    RTClient <-->|WebSockets| RealtimeCDC
    Routes --> Middlewares --> Controllers
    Controllers --> ServiceLayer
    ServiceLayer --> PostgresDB
    ServiceLayer --> ObjectStorage
    PostgresDB --> RealtimeCDC
```

---

## 🔄 Core Execution Flows

### 1. Inbound WhatsApp Message Flow

```mermaid
sequenceDiagram
    autonumber
    actor Customer as WhatsApp Customer
    participant Meta as Meta Cloud Infrastructure
    participant Webhook as Webhook Controller
    participant WhatsAppSvc as WhatsApp Service
    participant SupabaseDB as Supabase PostgreSQL
    participant Realtime as Supabase Realtime
    participant CRM as CRM Live Chat Dashboard

    Customer->>Meta: "Do you have Arsenal 26/27 in Medium?"
    Meta->>Webhook: POST /api/webhooks/whatsapp (x-hub-signature-256)
    Webhook->>Webhook: Validate HMAC SHA-256 with App Secret
    Webhook->>WhatsAppSvc: processInboundPayload(body)
    WhatsAppSvc->>SupabaseDB: Upsert Customer (+Phone, Name)
    WhatsAppSvc->>SupabaseDB: Find or Create Open Conversation
    WhatsAppSvc->>SupabaseDB: INSERT into messages (body, inbound)
    SupabaseDB-->>Realtime: Trigger CDC Event (INSERT on messages)
    Realtime-->>CRM: Push WebSocket Event
    CRM->>CRM: Append message bubble instantly to screen
```

### 2. Kit Scrape & Ingestion Flow

```mermaid
sequenceDiagram
    autonumber
    actor Merchant as Store Owner
    participant CRM as CRM Inventory Page
    participant ScraperController as Scraper Controller
    participant ScraperSvc as Scraper Service
    participant Footy as FootyHeadlines Server
    participant SupaStorage as Supabase Storage (products)
    participant SupaDB as Supabase Database (jerseys)

    Merchant->>CRM: Clicks "Sync Latest Kits"
    CRM->>ScraperController: POST /api/scraper/sync
    ScraperController->>ScraperSvc: runScrapeJob(targetUrl)
    ScraperSvc->>Footy: Fetch kit overview HTML
    ScraperSvc->>ScraperSvc: Extract League, Team, Season, Kit Type, Image URLs
    loop For each discovered kit
        ScraperSvc->>Footy: Download image stream
        ScraperSvc->>SupaStorage: Upload buffer to /products/{league}/{team}/{kit}.jpg
        SupaStorage-->>ScraperSvc: Returns public CDN URL
        ScraperSvc->>SupaDB: Upsert row in jerseys table
    end
    ScraperSvc-->>ScraperController: Return sync summary (e.g. 48 kits added)
    ScraperController-->>CRM: 200 OK (Updates inventory grid)
```

---

## 🔒 Security Architecture

1. **Meta Webhook Signature Verification**:
   - Meta signs every webhook payload using HMAC-SHA256 with your `META_APP_SECRET`.
   - The server captures the raw binary buffer in Express (`req.rawBody`).
   - The signature middleware recomputes the HMAC digest and uses `crypto.timingSafeEqual()` to prevent timing attacks.

2. **Access Token Encryption**:
   - Meta long-lived system user tokens are never stored in plain text.
   - Encrypted at rest using **AES-256-GCM** with an initialization vector (IV) and authentication tag.

3. **Input Sanitization**:
   - Webhook inputs and customer message strings are sanitized before database insertion to prevent injection vulnerabilities.

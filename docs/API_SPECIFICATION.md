# API Specification: Jersey Automate REST & Webhooks

This document defines all backend API routes, query parameters, request bodies, and response schemas.

---

## 📡 Base URL
```
http://localhost:3000/api
```

---

## 1. Jersey Catalog API (`/api/jerseys`)

### `GET /api/jerseys`
Retrieve paginated and filtered jersey catalog.
- **Query Parameters**:
  - `league` (optional, string): Filter by league (e.g. `Premier League`).
  - `team` (optional, string): Filter by team (e.g. `Arsenal`).
  - `season` (optional, string): e.g. `26-27`.
  - `inStock` (optional, boolean): `true` or `false`.
  - `search` (optional, string): Text query for team or kit title.
  - `page` (optional, number, default: 1).
  - `limit` (optional, number, default: 20).
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
      "league": "Premier League",
      "team": "Arsenal",
      "season": "26-27",
      "kit_type": "Home",
      "title": "Arsenal 26-27 Home Kit",
      "image_url": "https://xyz.supabase.co/storage/v1/object/public/products/premier_league/arsenal/home.jpg",
      "price": 45.00,
      "sizes_available": ["S", "M", "L", "XL", "XXL"],
      "is_in_stock": true
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 142 }
}
```

### `PATCH /api/jerseys/:id`
Update jersey price, stock, or available sizes.
- **Request Body**:
```json
{
  "price": 49.99,
  "is_in_stock": true,
  "sizes_available": ["M", "L", "XL"]
}
```

---

## 2. WhatsApp Live Chat API (`/api/chat`)

### `GET /api/chat/conversations`
List all customer chat threads with unread counts.
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "c1f2e3d4-...",
      "customer": {
        "id": "a9b8c7...",
        "phone_number": "+447123456789",
        "display_name": "Marcus Rashford"
      },
      "last_message_preview": "Do you have the Away kit in M?",
      "last_message_at": "2026-09-21T11:20:00Z",
      "unread_count": 1,
      "status": "open"
    }
  ]
}
```

### `POST /api/chat/send`
Send outbound text message to a customer over WhatsApp Cloud API.
- **Request Body**:
```json
{
  "conversationId": "c1f2e3d4-...",
  "message": "Yes, we have 4 units left in Medium! Would you like printing?"
}
```

### `POST /api/chat/send-kit`
Send an interactive Jersey Kit Card with high-res photo, price, and CTA buttons to the customer.
- **Request Body**:
```json
{
  "conversationId": "c1f2e3d4-...",
  "jerseyId": "e3b0c442-...",
  "customPrice": 45.00
}
```

---

## 3. Orders API (`/api/orders`)

### `GET /api/orders`
List orders with status filtering.
- **Query Parameters**: `status` (`pending`, `paid`, `shipped`, etc.).
- **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "o8f7e6...",
      "order_number": 1042,
      "customer": { "display_name": "David Silva", "phone_number": "+34612345678" },
      "jersey": { "title": "Man City 26-27 Home Kit" },
      "size": "L",
      "custom_name": "HAALAND",
      "custom_number": "9",
      "total_price": 55.00,
      "status": "paid",
      "created_at": "2026-09-21T10:00:00Z"
    }
  ]
}
```

### `PATCH /api/orders/:id/status`
Update order progress and optionally notify customer via WhatsApp.
- **Request Body**:
```json
{
  "status": "shipped",
  "trackingNumber": "DHL982348123GB",
  "notifyCustomer": true
}
```

---

## 4. Scraper API (`/api/scraper`)

### `POST /api/scraper/sync`
Trigger the FootyHeadlines crawler to fetch kit releases and upload assets to Supabase Storage.
- **Request Body**:
```json
{
  "season": "26-27",
  "url": "https://www.footyheadlines.com/26-27-kit-overview/?section=Kits"
}
```
- **Response (202 Accepted)**:
```json
{
  "success": true,
  "message": "Scraper job started in background",
  "jobId": "job_984fbc"
}
```

---

## 5. Webhook API (`/api/webhooks/whatsapp`)

### `GET /api/webhooks/whatsapp`
Meta Webhook Verification Handshake.
- **Query Parameters**: `hub.mode`, `hub.challenge`, `hub.verify_token`.
- **Response**: `hub.challenge` string with status 200.

### `POST /api/webhooks/whatsapp`
Meta Inbound Event Ingestion (Encrypted HMAC SHA-256 header: `x-hub-signature-256`).
- Handles inbound messages, delivered/read receipts, customer media uploads, and updates Supabase database tables.

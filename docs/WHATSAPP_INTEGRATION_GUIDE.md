# WhatsApp Cloud API Integration Guide (Single-Owner)

This guide walks you through connecting your WhatsApp Business phone number to **Jersey Automate**.

---

## 🛠️ Step 1: Meta Developer App Setup

1. Log into [developers.facebook.com](https://developers.facebook.com).
2. Click **My Apps** ➔ **Create App**.
3. Select **Other** ➔ **Business** as the app type.
4. Name your app (e.g. `Jersey Automate Hub`) and select your Meta Business Account.
5. In the App Dashboard, scroll down and find **WhatsApp** ➔ Click **Set Up**.

---

## 🔑 Step 2: Get Your API Credentials

In the WhatsApp sidebar under **API Setup**:
1. Copy your **Temporary Access Token** (for testing) or generate a **System User Permanent Token** under Business Manager:
   - Go to **Meta Business Settings** ➔ **System Users** ➔ **Add**.
   - Assign permissions: `whatsapp_business_messaging`, `whatsapp_business_management`.
   - Generate a permanent token without expiration.
2. Copy your **Phone Number ID**.
3. Copy your **WhatsApp Business Account (WABA) ID**.
4. In the main app settings (Settings ➔ Basic), copy your **App ID** and **App Secret**.

Add these to your `.env` file:
```env
META_APP_ID=1234567890
META_APP_SECRET=abcdef1234567890
META_SYSTEM_USER_TOKEN=EAA...
DEFAULT_WABA_ID=1234567890
```

---

## 🌐 Step 3: Webhook Configuration

Meta needs to send incoming customer messages to your server.

1. In the WhatsApp sidebar, click **Configuration** ➔ **Edit** next to Callback URL.
2. Enter your public webhook URL:
   ```
   https://your-domain.com/api/webhooks/whatsapp
   ```
   *(If testing locally on your computer, use **ngrok** or **Cloudflare Tunnel**: `npx ngrok http 3000`)*
3. In **Verify Token**, enter the exact string you placed in `.env` under `META_WEBHOOK_VERIFY_TOKEN`.
4. Click **Verify and Save**.
5. Under **Webhook fields**, click **Manage** and subscribe to:
   - `messages` (incoming customer messages & media)
   - `message_template_status_update` (template approvals)

---

## 📲 Step 4: Connecting via 1-Click Embedded Signup

If you prefer connecting via the visual dashboard instead of manual token entry:

1. Open your CRM dashboard at `http://localhost:3000`.
2. Click **"Connect WhatsApp Business"**.
3. Meta's official login popup will appear:
   - Log into Facebook.
   - Select or create your WhatsApp Business Profile.
   - Enter your phone number and verify it via SMS or voice call.
4. When finished, the popup automatically passes the authorization code to your backend.
5. Your backend exchanges it for a permanent token, subscribes your webhook automatically, and updates your connection status to `CONNECTED`.

---

## 🧪 Step 5: Testing the End-to-End Chat

1. Take your personal phone and send a WhatsApp message to your connected WhatsApp Business number:
   ```
   "Hi, do you have the Real Madrid 26/27 Home kit?"
   ```
2. Open your CRM Live Chat tab.
3. You will see a new conversation appear in real time!
4. Click the conversation, type a reply, or click **"Send Kit Card"** to test outbound message delivery.

import axios from 'axios';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.AccessToken || process.env.META_SYSTEM_USER_TOKEN;
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.DEFAULT_WABA_ID;
const appId = process.env.META_APP_ID;
const appSecret = process.env.META_APP_SECRET;
const version = process.env.GRAPH_API_VERSION || 'v21.0';

// Check for target recipient in command line arguments: --to=+1234567890
const args = process.argv.slice(2);
let toPhone = process.env.TEST_RECIPIENT_PHONE || '';
for (const arg of args) {
  if (arg.startsWith('--to=')) {
    toPhone = arg.split('=')[1];
  } else if (arg.startsWith('+') || /^\d{10,15}$/.test(arg)) {
    toPhone = arg;
  }
}

async function runDiagnostic() {
  console.log('\n============================================================');
  console.log('   JERSEY AUTOMATE - WHATSAPP CLOUD API DIAGNOSTIC');
  console.log('============================================================\n');

  // 1. Check Configuration
  console.log('[1/4] Checking environment variables in .env:');
  console.log('  - META_APP_ID:', appId ? `OK (${appId})` : 'MISSING');
  console.log('  - META_APP_SECRET:', appSecret ? 'OK (Configured)' : 'MISSING');
  console.log('  - ACCESS_TOKEN:', token ? `OK (${token.substring(0, 15)}...${token.slice(-6)})` : 'MISSING');
  console.log('  - PHONE_NUMBER_ID:', phoneId ? `OK (${phoneId})` : 'MISSING (Get this from developers.facebook.com -> WhatsApp -> API Setup)');
  console.log('  - WABA_ID:', wabaId ? `OK (${wabaId})` : 'NOT SET (Optional for sending)');

  if (!token) {
    console.error('\n❌ Fatal: No WhatsApp access token found in .env.');
    process.exit(1);
  }

  // 2. Test Token against Meta Graph API
  console.log('\n[2/4] Testing token validity against Meta Graph API...');
  try {
    const meRes = await axios.get(`https://graph.facebook.com/${version}/me`, {
      params: { access_token: token },
      timeout: 10000
    });
    console.log('  ✅ Meta Token is VALID!');
    console.log('     Name:', meRes.data.name);
    console.log('     ID:', meRes.data.id);
  } catch (err: unknown) {
    const errorMsg = axios.isAxiosError(err) ? err.response?.data?.error?.message || err.message : String(err);
    console.error('  ❌ Meta rejected token:', errorMsg);
    process.exit(1);
  }

  // 3. Inspect Permissions / Scopes
  if (appId && appSecret) {
    try {
      const debugRes = await axios.get(`https://graph.facebook.com/${version}/debug_token`, {
        params: { input_token: token, access_token: `${appId}|${appSecret}` },
        timeout: 10000
      });
      const data = debugRes.data.data;
      console.log('\n[3/4] Inspecting Token Permissions:');
      console.log('  - App Name:', data.application);
      console.log('  - Type:', data.type);
      console.log('  - Expires In:', data.expires_at === 0 ? 'Never (Permanent Token) ✅' : `${new Date(data.expires_at * 1000).toLocaleString()}`);
      console.log('  - Granted Scopes:', data.scopes?.join(', '));
      
      const hasMessaging = data.scopes?.includes('whatsapp_business_messaging');
      if (!hasMessaging) {
        console.warn('  ⚠️ WARNING: "whatsapp_business_messaging" scope is missing! Messages cannot be sent.');
      }
    } catch (err: unknown) {
      const errorMsg = axios.isAxiosError(err) ? err.response?.data?.error?.message || err.message : String(err);
      console.log('  (Skipping token scope inspection:', errorMsg, ')');
    }
  }

  // 4. Send Live Test Message
  console.log('\n[4/4] Live WhatsApp Message Test:');
  if (!phoneId) {
    console.log('  ⚠️ Skipping message send: WHATSAPP_PHONE_NUMBER_ID is not configured in .env.');
    console.log('  👉 To complete the test, add WHATSAPP_PHONE_NUMBER_ID to .env and run this script again.');
    return;
  }

  if (!toPhone) {
    console.log('  ⚠️ No recipient phone number specified.');
    console.log('  👉 Run with: npm run test:whatsapp -- --to=+1234567890');
    console.log('     (Replace with your phone number including country code)');
    return;
  }

  const cleanTo = toPhone.replace(/\D/g, '');
  console.log(`  Sending test message from Phone ID (${phoneId}) to (+${cleanTo})...`);

  // First try: Plain text message
  try {
    const sendUrl = `https://graph.facebook.com/${version}/${phoneId}/messages`;
    const res = await axios.post(
      sendUrl,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'text',
        text: {
          preview_url: false,
          body: '⚽ *Jersey Automate Backend Connected!*\n\nYour WhatsApp Cloud API is functioning 100% and ready to process store orders and customer chats.'
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const messageId = res.data.messages?.[0]?.id;
    console.log('\n============================================================');
    console.log('  🎉 SUCCESS! WhatsApp message was dispatched by Meta!');
    console.log('  Message WAMID:', messageId);
    console.log('============================================================\n');
    return;
  } catch (err: unknown) {
    const isAxios = axios.isAxiosError(err);
    const metaError = isAxios ? (err.response?.data as { error?: { code?: number; error_subcode?: number; message?: string } })?.error : undefined;
    const msg = isAxios ? metaError?.message || err.message : String(err);
    console.error('\n  ❌ Text message failed:', msg);

    // If text message fails because 24-hr customer service window is closed (code 131030 / 131047), try official hello_world template
    if (metaError?.code === 131030 || metaError?.code === 131047 || metaError?.error_subcode === 131030) {
      console.log('\n  ℹ️ Meta requires a pre-approved template outside the 24h conversation window.');
      console.log('  Attempting to send the default Meta "hello_world" template...');

      try {
        const tplUrl = `https://graph.facebook.com/${version}/${phoneId}/messages`;
        const tplRes = await axios.post<{ messages?: Array<{ id: string }> }>(
          tplUrl,
          {
            messaging_product: 'whatsapp',
            to: cleanTo,
            type: 'template',
            template: {
              name: 'hello_world',
              language: { code: 'en_US' }
            }
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          }
        );

        const templateMsgId = tplRes.data.messages?.[0]?.id;
        console.log('\n============================================================');
        console.log('  🎉 SUCCESS! "hello_world" Template was dispatched by Meta!');
        console.log('  Message WAMID:', templateMsgId);
        console.log('============================================================\n');
        return;
      } catch (tplErr: unknown) {
        const tplMsg = axios.isAxiosError(tplErr) ? tplErr.response?.data?.error?.message || tplErr.message : String(tplErr);
        console.error('  ❌ Template send also failed:', tplMsg);
      }
    }

    if (metaError?.code === 131030 || metaError?.message?.includes('not in allowed list') || metaError?.error_subcode === 2388091) {
      console.log('\n  👉 Troubleshooting Sandbox Whitelist:');
      console.log('     Your Meta App is in Development mode.');
      console.log('     Go to developers.facebook.com -> WhatsApp -> API Setup');
      console.log('     Under "To", click "Manage phone number list" and add +' + cleanTo);
    }
  }
}

runDiagnostic();

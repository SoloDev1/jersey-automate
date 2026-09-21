import React, { useState, useEffect } from 'react';
import { WhatsAppStatus, AiBudget } from '../../types/crm.types.js';
import { crmApi } from '../../services/api.js';
import { Smartphone, Bot, Key, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';

export const SettingsWorkspace: React.FC = () => {
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [aiBudget, setAiBudget] = useState<AiBudget | null>(null);
  const [tab, setTab] = useState<'manual' | 'embedded'>('manual');

  // Manual WhatsApp Form
  const [accessToken, setAccessToken] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const [wa, ai] = await Promise.all([
        crmApi.getWhatsAppStatus(),
        crmApi.getAiBudget()
      ]);
      setWaStatus(wa);
      setAiBudget(ai);
      if (wa?.phoneNumberId) setPhoneNumberId(wa.phoneNumberId);
      if (wa?.wabaId) setWabaId(wa.wabaId);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken.trim() || !phoneNumberId.trim() || !wabaId.trim()) return;

    try {
      setIsSaving(true);
      setSaveError(null);
      setSaveSuccess(false);

      const updated = await crmApi.onboardWhatsApp({
        accessToken: accessToken.trim(),
        phoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim()
      });

      setWaStatus(updated);
      setSaveSuccess(true);
      setAccessToken('');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed connecting WhatsApp';
      setSaveError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const spendPercent = aiBudget
    ? Math.min(100, Math.round((aiBudget.currentSpendUsd / aiBudget.maxBudgetUsd) * 100))
    : 0;

  return (
    <div className="flex-1 bg-slate-950 p-6 overflow-y-auto max-w-4xl space-y-6">
      {/* Page Title */}
      <div>
        <h2 className="font-bold text-xl text-white">Settings & Integrations</h2>
        <p className="text-xs text-slate-400 mt-1">
          Configure WhatsApp Cloud API connection, webhooks, and AI budget governance
        </p>
      </div>

      {/* 1. WhatsApp Cloud API Connection Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-950 border border-emerald-800/80 flex items-center justify-center text-emerald-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">WhatsApp Cloud API Connection</h3>
              <p className="text-xs text-slate-400">Meta Business Platform integration</p>
            </div>
          </div>

          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${
              waStatus?.isConnected
                ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                : 'bg-amber-950 text-amber-400 border-amber-800'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                waStatus?.isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
            />
            {waStatus?.isConnected ? 'Connected & Active' : 'Not Connected'}
          </div>
        </div>

        {/* Connection Tabs */}
        <div className="mt-4">
          <div className="flex gap-2 border-b border-slate-800 pb-2">
            <button
              onClick={() => setTab('manual')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === 'manual' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Manual API Key Setup (Fastest)
            </button>
            <button
              onClick={() => setTab('embedded')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === 'embedded' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Embedded Signup (Facebook Login)
            </button>
          </div>

          {/* Manual Connection Form */}
          {tab === 'manual' && (
            <form onSubmit={handleManualConnect} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Meta System User Access Token
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    placeholder="EAA..."
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Tokens are encrypted with AES-256-GCM before being stored in the database.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Phone Number ID
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 104829102938475"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    WhatsApp Business Account (WABA) ID
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 293847192837465"
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {saveSuccess && (
                <div className="p-3 bg-emerald-950/60 border border-emerald-800 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" /> WhatsApp credentials encrypted and connected successfully!
                </div>
              )}

              {saveError && (
                <div className="p-3 bg-red-950/60 border border-red-800 rounded-lg text-xs text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> {saveError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSaving || !accessToken.trim() || !phoneNumberId.trim() || !wabaId.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold text-xs rounded-lg transition-colors shadow-sm"
              >
                {isSaving ? 'Encrypting & Connecting...' : 'Connect WhatsApp Store'}
              </button>
            </form>
          )}

          {/* Embedded Signup Guide */}
          {tab === 'embedded' && (
            <div className="mt-4 p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Meta Embedded Signup allows you to log in with Facebook, verify your SIM card via SMS OTP, and connect your business in a few clicks.
              </p>
              <div className="p-3 bg-slate-900 border border-slate-800 rounded text-xs text-slate-400 space-y-1">
                <div>1. Ensure you have configured <code className="text-emerald-400">META_CONFIG_ID</code> in your Meta App.</div>
                <div>2. Whitelist your CRM domain in the Facebook Login App settings.</div>
              </div>
              <button
                type="button"
                onClick={() => alert('Embedded Signup: Opening Facebook Login dialog... (Configure META_CONFIG_ID in .env)')}
                className="px-4 py-2 bg-[#1877F2] hover:bg-[#166fe5] text-white font-semibold text-xs rounded-lg transition-colors flex items-center gap-2"
              >
                <span>f</span> Continue with Facebook
              </button>
            </div>
          )}
        </div>

        {/* Webhook Instructions */}
        <div className="mt-6 pt-4 border-t border-slate-800">
          <h4 className="text-xs font-bold text-slate-200 mb-2">Meta Webhook Configuration</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 block text-[11px] mb-1">Callback URL:</span>
              <code className="text-emerald-400 font-mono text-[11px] select-all">
                https://your-domain.com/api/v1/webhooks/whatsapp
              </code>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 block text-[11px] mb-1">Verify Token:</span>
              <code className="text-emerald-400 font-mono text-[11px] select-all">
                jersey_automate_webhook_secret_2026
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* 2. AI Budget & Safety Governance Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-950 border border-purple-800/80 flex items-center justify-center text-purple-400">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">AI Sales Assistant & Monthly Budget</h3>
              <p className="text-xs text-slate-400">Concurrency-safe budget cap enforcer</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-slate-300">
              {aiBudget?.isLocked ? 'Budget Capped' : 'Budget Guard Active'}
            </span>
          </div>
        </div>

        {/* Budget Meter */}
        <div className="mt-5 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400 font-medium">Monthly Token Spend</span>
            <span className="font-mono text-slate-200 font-bold">
              ${aiBudget?.currentSpendUsd.toFixed(3) || '0.000'} / ${aiBudget?.maxBudgetUsd.toFixed(2) || '15.00'} USD
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
            <div
              className={`h-full transition-all duration-500 ${
                spendPercent > 90
                  ? 'bg-red-500'
                  : spendPercent > 70
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${spendPercent}%` }}
            />
          </div>

          <p className="text-[11px] text-slate-500 mt-2">
            If monthly spend reaches ${aiBudget?.maxBudgetUsd || 15}, the system automatically pauses AI auto-replies to prevent unexpected costs.
          </p>
        </div>
      </div>
    </div>
  );
};

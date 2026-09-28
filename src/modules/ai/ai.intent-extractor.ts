import OpenAI from 'openai';
import { z } from 'zod';
import { env } from '../../core/config/env.js';

export const IntentSchema = z.object({
  intent: z.enum([
    'SEARCH_KIT',
    'VIEW_TEAM',
    'CHECKOUT',
    'FAQ_SUPPORT',
    'REQUEST_HUMAN',
    'GREETING',
    'GENERAL_CHITCHAT'
  ]),
  team: z.string().nullable().optional(),
  kitType: z.enum(['home', 'away', 'third', 'goalkeeper']).nullable().optional(),
  season: z.string().nullable().optional(),
  faqTopic: z
    .enum(['delivery', 'returns', 'sizing', 'authenticity', 'store_hours', 'general'])
    .nullable()
    .optional(),
  replyText: z.string().nullable().optional()
});

export type ExtractedIntent = z.infer<typeof IntentSchema>;

export interface IntentExtractionResult {
  data: ExtractedIntent;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  };
}

const SYSTEM_PROMPT = `You are a high-speed intent & entity extractor for Jersey Hub, an authentic football jersey store on WhatsApp.
Your sole job is to extract the customer's intent, team name, and kit details from their message into structured JSON.

Valid Intents:
1. SEARCH_KIT: Customer wants a jersey (e.g. "I want Man City jersey", "Do you have Arsenal's new shirt?", "I need that blue shirt", "Hull kit").
2. VIEW_TEAM: Customer wants to see what you have for a club (e.g. "Show me Chelsea", "What Madrid jerseys do you have?").
3. CHECKOUT: Customer wants to proceed to payment or buy now (e.g. "I want to checkout", "Send me account number to pay").
4. FAQ_SUPPORT: Customer asks about delivery locations, shipping timeline, return/exchange policy, sizing guide, or authenticity.
5. REQUEST_HUMAN: Customer explicitly asks for a human agent or complains about bot assistance.
6. GREETING: Customer says hello, hi, good morning, etc.
7. GENERAL_CHITCHAT: Friendly banter or questions not related to jersey shopping.

Entity Extraction Rules:
- "team": Extract the team or club name mentioned (e.g. "Man City", "Hull", "United", "Chelsea", "Nigeria", "Real Madrid"). If no club is mentioned, set null.
- "kitType": "home" | "away" | "third" | "goalkeeper" | null. Only extract if explicitly stated.
- "season": Extract season string if mentioned (e.g. "2026/27", "retro", "classic"), otherwise null.
- "faqTopic": "delivery" | "returns" | "sizing" | "authenticity" | "store_hours" | "general" | null.
- "replyText": 
  - For GREETING: Provide a friendly 1-sentence welcome asking which club/jersey they are looking for today ⚽.
  - For GENERAL_CHITCHAT: Provide a brief friendly 1-sentence reply.
  - For other intents: set null.

Output JSON format strictly:
{
  "intent": "SEARCH_KIT" | "VIEW_TEAM" | "CHECKOUT" | "FAQ_SUPPORT" | "REQUEST_HUMAN" | "GREETING" | "GENERAL_CHITCHAT",
  "team": string | null,
  "kitType": "home" | "away" | "third" | "goalkeeper" | null,
  "season": string | null,
  "faqTopic": string | null,
  "replyText": string | null
}`;

export class IntentExtractor {
  private client: OpenAI;
  private model: string;

  constructor(client?: OpenAI, model?: string) {
    this.client =
      client ||
      new OpenAI({
        apiKey: env.OPENAI_API_KEY,
        timeout: 15_000,
        maxRetries: 2
      });
    this.model = model || env.OPENAI_MODEL_FAST || 'gpt-4o-mini';
  }

  async extract(userMessage: string): Promise<IntentExtractionResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage.trim() }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_completion_tokens: 300
      });

      const promptTokens = response.usage?.prompt_tokens ?? 0;
      const completionTokens = response.usage?.completion_tokens ?? 0;
      const totalTokens = response.usage?.total_tokens ?? promptTokens + completionTokens;

      // gpt-4o-mini pricing: ~$0.15 / 1M prompt, ~$0.60 / 1M completion
      const costUsd = (promptTokens / 1_000_000) * 0.15 + (completionTokens / 1_000_000) * 0.6;

      const rawJson = response.choices[0]?.message?.content || '{}';
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        parsed = {};
      }

      const validated = IntentSchema.safeParse(parsed);
      if (validated.success) {
        return {
          data: validated.data,
          usage: { promptTokens, completionTokens, totalTokens, costUsd }
        };
      }

      // Safe fallback if Zod parse failed
      return {
        data: {
          intent: 'SEARCH_KIT',
          team: null,
          kitType: null,
          season: null,
          faqTopic: null,
          replyText: null
        },
        usage: { promptTokens, completionTokens, totalTokens, costUsd }
      };
    } catch (err: unknown) {
      console.error('[IntentExtractor] Failed extracting intent:', err);
      return {
        data: {
          intent: 'SEARCH_KIT',
          team: null,
          kitType: null,
          season: null,
          faqTopic: null,
          replyText: null
        },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
      };
    }
  }
}

export const intentExtractor = new IntentExtractor();

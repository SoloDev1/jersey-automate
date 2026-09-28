import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '@prisma/client';
import { StoreSettingsDto, UpdateStoreSettingsDto } from './settings.types.js';

interface CacheEntry {
  settings: StoreSettingsDto;
  expiresAt: number;
}

const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class SettingsService {
  private cache = new Map<string, CacheEntry>();

  /**
   * Retrieves organization settings with high-performance in-memory caching.
   * Never blocks WhatsApp webhooks on redundant DB reads.
   */
  async getSettings(organizationId: string): Promise<StoreSettingsDto> {
    const cached = this.cache.get(organizationId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.settings;
    }

    let record = await prisma.setting.findUnique({
      where: { organizationId }
    });

    if (!record) {
      // Auto-initialize default settings for tenant
      record = await prisma.setting.create({
        data: {
          organizationId,
          storeName: 'Jersey Reseller Hub',
          storeCategory: 'football_jerseys',
          businessDescription: 'authentic club and national team football jerseys and related kits',
          storeEmoji: '⚽',
          currency: 'NGN',
          defaultShippingFee: new Prisma.Decimal(2000.0),
          customPrintingFee: new Prisma.Decimal(3000.0),
          customOptionTitle: 'Custom Printing',
          customOptionFee: new Prisma.Decimal(3000.0),
          aiPersonaTone: 'friendly',
          customStorePolicies: 'Delivery within 2-4 business days. Standard return policy applies.',
          brandKeywords: [],
          categoryKeywords: []
        }
      });
    }

    const dto = this.mapToDto(record);
    this.cache.set(organizationId, {
      settings: dto,
      expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS
    });

    return dto;
  }

  /**
   * Updates store settings and invalidates cache atomically.
   */
  async updateSettings(
    organizationId: string,
    input: UpdateStoreSettingsDto
  ): Promise<StoreSettingsDto> {
    const updateData: Prisma.SettingUpdateInput = {};

    if (input.storeName !== undefined) updateData.storeName = input.storeName;
    if (input.storeCategory !== undefined) updateData.storeCategory = input.storeCategory;
    if (input.businessDescription !== undefined)
      updateData.businessDescription = input.businessDescription;
    if (input.storeEmoji !== undefined) updateData.storeEmoji = input.storeEmoji;
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.defaultShippingFee !== undefined)
      updateData.defaultShippingFee = new Prisma.Decimal(input.defaultShippingFee);
    if (input.customPrintingFee !== undefined)
      updateData.customPrintingFee = new Prisma.Decimal(input.customPrintingFee);
    if (input.customOptionTitle !== undefined)
      updateData.customOptionTitle = input.customOptionTitle;
    if (input.customOptionFee !== undefined)
      updateData.customOptionFee = new Prisma.Decimal(input.customOptionFee);
    if (input.aiPersonaTone !== undefined) updateData.aiPersonaTone = input.aiPersonaTone;
    if (input.customStorePolicies !== undefined)
      updateData.customStorePolicies = input.customStorePolicies;
    if (input.outOfScopeMessage !== undefined)
      updateData.outOfScopeMessage = input.outOfScopeMessage;
    if (input.clarificationMessage !== undefined)
      updateData.clarificationMessage = input.clarificationMessage;
    if (input.brandKeywords !== undefined)
      updateData.brandKeywords = input.brandKeywords as unknown as Prisma.InputJsonValue;
    if (input.categoryKeywords !== undefined)
      updateData.categoryKeywords = input.categoryKeywords as unknown as Prisma.InputJsonValue;
    if (input.aiEnabledGlobally !== undefined)
      updateData.aiEnabledGlobally = input.aiEnabledGlobally;
    if (input.maxMonthlyAiBudgetUsd !== undefined)
      updateData.maxMonthlyAiBudgetUsd = new Prisma.Decimal(input.maxMonthlyAiBudgetUsd);

    const createData: Prisma.SettingUncheckedCreateInput = {
      organizationId,
      storeName: input.storeName || 'Jersey Reseller Hub',
      storeCategory: input.storeCategory || 'football_jerseys',
      businessDescription: input.businessDescription,
      storeEmoji: input.storeEmoji || '⚽',
      currency: input.currency || 'NGN',
      defaultShippingFee:
        input.defaultShippingFee !== undefined
          ? new Prisma.Decimal(input.defaultShippingFee)
          : undefined,
      customPrintingFee:
        input.customPrintingFee !== undefined
          ? new Prisma.Decimal(input.customPrintingFee)
          : undefined,
      customOptionTitle: input.customOptionTitle,
      customOptionFee:
        input.customOptionFee !== undefined
          ? new Prisma.Decimal(input.customOptionFee)
          : undefined,
      aiPersonaTone: input.aiPersonaTone || 'friendly',
      customStorePolicies: input.customStorePolicies,
      outOfScopeMessage: input.outOfScopeMessage,
      clarificationMessage: input.clarificationMessage,
      brandKeywords: (input.brandKeywords as unknown as Prisma.InputJsonValue) || [],
      categoryKeywords: (input.categoryKeywords as unknown as Prisma.InputJsonValue) || [],
      aiEnabledGlobally:
        input.aiEnabledGlobally !== undefined ? input.aiEnabledGlobally : true,
      maxMonthlyAiBudgetUsd:
        input.maxMonthlyAiBudgetUsd !== undefined
          ? new Prisma.Decimal(input.maxMonthlyAiBudgetUsd)
          : undefined
    };

    const updated = await prisma.setting.upsert({
      where: { organizationId },
      update: updateData,
      create: createData
    });

    const dto = this.mapToDto(updated);
    // Invalidate and refresh cache
    this.cache.set(organizationId, {
      settings: dto,
      expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS
    });

    return dto;
  }

  /**
   * Clears the cache for a tenant or globally.
   */
  invalidateCache(organizationId?: string): void {
    if (organizationId) {
      this.cache.delete(organizationId);
    } else {
      this.cache.clear();
    }
  }

  private mapToDto(record: any): StoreSettingsDto {
    const rawBrandKeywords = Array.isArray(record.brandKeywords) ? record.brandKeywords : [];
    const rawCategoryKeywords = Array.isArray(record.categoryKeywords)
      ? record.categoryKeywords
      : [];

    return {
      organizationId: record.organizationId,
      storeName: record.storeName,
      storeCategory: record.storeCategory || 'football_jerseys',
      businessDescription: record.businessDescription,
      storeEmoji: record.storeEmoji || '⚽',
      currency: record.currency,
      defaultShippingFee: Number(record.defaultShippingFee),
      customPrintingFee: Number(record.customPrintingFee),
      customOptionTitle: record.customOptionTitle,
      customOptionFee: record.customOptionFee !== null ? Number(record.customOptionFee) : null,
      aiPersonaTone: record.aiPersonaTone || 'friendly',
      customStorePolicies: record.customStorePolicies,
      outOfScopeMessage: record.outOfScopeMessage,
      clarificationMessage: record.clarificationMessage,
      brandKeywords: rawBrandKeywords.map((k: unknown) => String(k)),
      categoryKeywords: rawCategoryKeywords.map((k: unknown) => String(k)),
      isWhatsappConnected: Boolean(record.isWhatsappConnected),
      aiEnabledGlobally: Boolean(record.aiEnabledGlobally),
      maxMonthlyAiBudgetUsd: Number(record.maxMonthlyAiBudgetUsd),
      updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : new Date().toISOString()
    };
  }
}

export const settingsService = new SettingsService();

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { prisma } from '../../src/core/database/prisma.js';
import { storageService } from '../../src/core/storage/storage.service.js';
import { JerseySize } from '../../src/modules/catalog/catalog.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BASE_DOWNLOAD_DIR = path.resolve(__dirname, '../downloads');
const KITS_JSON_PATH = path.join(BASE_DOWNLOAD_DIR, 'footy_26_27_kits.json');
const CONCURRENCY_LIMIT = 4;
const DEFAULT_ORGANIZATION_ID = 'org_default';

function sanitizeName(str: string): string {
  return (str || 'unknown')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseKitType(kitName: string): string {
  const lower = (kitName || '').toLowerCase();
  if (lower.includes('home')) return 'Home';
  if (lower.includes('away')) return 'Away';
  if (lower.includes('third')) return 'Third';
  if (lower.includes('fourth')) return 'Fourth';
  if (lower.includes('goalkeeper') || lower.includes('gk')) return 'Goalkeeper';
  return 'Special';
}

async function asyncPool<T>(
  limit: number,
  items: T[],
  iteratorFn: (item: T) => Promise<void>
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p: Promise<void> = Promise.resolve().then(() => iteratorFn(item));
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

interface ScrapedKit {
  kitName?: string;
  season?: string;
  kitPageUrl?: string;
  sourceUrl?: string;
  imageUrl?: string;
  localFilePath?: string;
}

interface ScrapedClub {
  league?: string;
  club?: string;
  team?: string;
  kits?: ScrapedKit[];
}

interface NormalizedKit {
  league: string;
  team: string;
  kitName: string;
  kitType: string;
  season: string;
  kitPageUrl: string;
  imageUrl: string;
  localFilePath: string;
}

async function syncToNeon(): Promise<void> {
  console.log('='.repeat(70));
  console.log('🚀 JERSEY AUTOMATE - LOCAL TO NEON (POSTGRES + S3) SYNC');
  console.log(`   Metadata JSON: ${KITS_JSON_PATH}`);
  console.log('='.repeat(70));

  if (!existsSync(KITS_JSON_PATH)) {
    console.error(`❌ File not found: ${KITS_JSON_PATH}`);
    console.error('Please run "npm run scrape" first to scrape kit data.');
    process.exit(1);
  }

  // 1. Ensure Default Organization exists in Neon PostgreSQL
  await prisma.organization.upsert({
    where: { id: DEFAULT_ORGANIZATION_ID },
    create: {
      id: DEFAULT_ORGANIZATION_ID,
      name: 'Jersey Reseller Hub',
      slug: 'default'
    },
    update: {}
  });

  // Ensure Settings exist
  await prisma.setting.upsert({
    where: { organizationId: DEFAULT_ORGANIZATION_ID },
    create: {
      organizationId: DEFAULT_ORGANIZATION_ID,
      storeName: 'Jersey Reseller Hub',
      currency: 'NGN'
    },
    update: {}
  });

  // 2. Read scraped metadata
  const rawData = await fs.readFile(KITS_JSON_PATH, 'utf-8');
  const clubsData = JSON.parse(rawData) as ScrapedClub[];

  // Flatten all kits into a single array
  const allKits: NormalizedKit[] = [];
  for (const clubItem of clubsData) {
    const league = clubItem.league || 'Other';
    const club = clubItem.club || clubItem.team || 'Unknown Club';
    const kits = clubItem.kits || [];
    for (const kit of kits) {
      allKits.push({
        league,
        team: club,
        kitName: kit.kitName || 'Kit',
        kitType: parseKitType(kit.kitName || ''),
        season: kit.season || '2026/27',
        kitPageUrl: kit.kitPageUrl || kit.sourceUrl || '',
        imageUrl: kit.imageUrl || '',
        localFilePath: kit.localFilePath || ''
      });
    }
  }

  console.log(`\n📋 Found ${allKits.length} kits across ${clubsData.length} clubs in local database.`);
  console.log(`⚡ Starting image upload to Neon S3 Storage & database sync...\n`);

  let completedCount = 0;
  let uploadSuccessCount = 0;
  let dbSuccessCount = 0;
  let skippedCount = 0;

  await asyncPool(CONCURRENCY_LIMIT, allKits, async (item) => {
    completedCount++;
    const progress = `[${completedCount}/${allKits.length}]`;

    // Locate local image file
    let resolvedFilePath: string | null = null;
    if (item.localFilePath) {
      const p1 = path.resolve(BASE_DOWNLOAD_DIR, item.localFilePath);
      if (existsSync(p1)) resolvedFilePath = p1;
    }

    if (!resolvedFilePath) {
      // Fallback path search
      const fallbackPath = path.join(
        BASE_DOWNLOAD_DIR,
        'kits',
        sanitizeName(item.league),
        sanitizeName(item.team),
        `${sanitizeName(item.kitName)}.jpg`
      );
      if (existsSync(fallbackPath)) resolvedFilePath = fallbackPath;
    }

    let publicCdnUrl = item.imageUrl;

    // Upload image to Neon S3 Storage if local image exists
    if (resolvedFilePath) {
      try {
        const fileBuffer = await fs.readFile(resolvedFilePath);
        const leagueFolder = sanitizeName(item.league);
        const clubFolder = sanitizeName(item.team);
        const safeFilename = `${sanitizeName(item.kitName)}.jpg`;
        const storagePath = `kits/2026-27/${leagueFolder}/${clubFolder}/${safeFilename}`;

        const uploadResult = await storageService.uploadFile(storagePath, fileBuffer, 'image/jpeg');
        uploadSuccessCount++;
        publicCdnUrl = uploadResult.publicUrl;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`${progress} ⚠️ Could not upload image to Neon S3: ${msg}`);
      }
    } else {
      skippedCount++;
    }

    // 1. Upsert into discovered_kits table
    const kitTitle = `${item.team} ${item.season} ${item.kitType} Kit`;
    let discoveredKitId: string | null = null;

    try {
      const disc = await prisma.discoveredKit.upsert({
        where: {
          uq_discovered_kit: {
            league: item.league,
            team: item.team,
            season: item.season,
            kitType: item.kitType
          }
        },
        create: {
          league: item.league,
          team: item.team,
          season: item.season,
          kitType: item.kitType,
          title: kitTitle,
          rawImageUrl: item.imageUrl,
          storageImageUrl: publicCdnUrl,
          sourceUrl: item.kitPageUrl
        },
        update: {
          storageImageUrl: publicCdnUrl,
          rawImageUrl: item.imageUrl
        }
      });
      discoveredKitId = disc.id;

      // 2. Also insert or update jerseys table (Tenant Store Catalog)
      let currentJersey = await prisma.jersey.findFirst({
        where: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          team: item.team,
          season: item.season,
          kitType: item.kitType
        }
      });

      if (!currentJersey) {
        currentJersey = await prisma.jersey.create({
          data: {
            organizationId: DEFAULT_ORGANIZATION_ID,
            discoveredKitId,
            title: kitTitle,
            league: item.league,
            team: item.team,
            season: item.season,
            kitType: item.kitType,
            basePrice: 0.00, // Admin updates this price!
            imageUrl: publicCdnUrl,
            description: `Official ${item.season} ${item.team} ${item.kitType} football kit. Authentic quality.`,
            isActive: true
          }
        });
      } else {
        await prisma.jersey.update({
          where: { id: currentJersey.id },
          data: { imageUrl: publicCdnUrl }
        });
      }

      // 3. Seed default size inventory (S, M, L, XL, XXL) if not exists
      const standardSizes: JerseySize[] = ['S', 'M', 'L', 'XL', 'XXL'];
      for (const size of standardSizes) {
        await prisma.jerseyInventory.upsert({
          where: {
            uq_jersey_size: {
              jerseyId: currentJersey.id,
              size
            }
          },
          create: {
            organizationId: DEFAULT_ORGANIZATION_ID,
            jerseyId: currentJersey.id,
            size,
            quantityOnHand: 10,
            quantityReserved: 0
          },
          update: {} // do not overwrite existing stock
        });
      }

      dbSuccessCount++;
      console.log(`${progress} ✔️ Synced: ${item.league} > ${item.team} > ${item.kitName}`);
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error(`${progress} ❌ DB Sync failure (${item.team}):`, msg);
    }
  });

  console.log('\n' + '='.repeat(70));
  console.log('🎉 SYNC PROCESS FINISHED!');
  console.log(`   📦 Total kits processed: ${allKits.length}`);
  console.log(`   ☁️ Images uploaded to Neon S3: ${uploadSuccessCount}`);
  console.log(`   💾 Database rows synced: ${dbSuccessCount}`);
  if (skippedCount > 0) {
    console.log(`   ℹ️ Images using remote fallback URL: ${skippedCount}`);
  }
  console.log('='.repeat(70));
}

syncToNeon()
  .catch((err) => {
    console.error('Fatal sync error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

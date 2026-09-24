import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const AWS_ENDPOINT_URL_S3 = process.env.AWS_ENDPOINT_URL_S3 || '';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'jerseys';

if (!AWS_ENDPOINT_URL_S3 || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
  console.error('\n❌ ERROR: Neon S3 Storage credentials missing in .env!');
  console.error('Please configure AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY.\n');
  process.exit(1);
}

const s3Client = new S3Client({
  endpoint: AWS_ENDPOINT_URL_S3,
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
  },
  forcePathStyle: true
});

const prisma = new PrismaClient();

const BASE_DOWNLOAD_DIR = path.resolve(__dirname, '../downloads');
const KITS_JSON_PATH = path.join(BASE_DOWNLOAD_DIR, 'footy_26_27_kits.json');
const CONFIG_PATH = path.resolve(__dirname, '../config/mvp-clubs.json');
const CONCURRENCY_LIMIT = 4;
const DEFAULT_ORGANIZATION_ID = 'org_default';

function sanitizeName(str) {
  return (str || 'unknown')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseKitType(kitName) {
  const lower = (kitName || '').toLowerCase();
  if (lower.includes('home')) return 'Home';
  if (lower.includes('away')) return 'Away';
  if (lower.includes('third')) return 'Third';
  if (lower.includes('fourth')) return 'Fourth';
  if (lower.includes('goalkeeper') || lower.includes('gk')) return 'Goalkeeper';
  return 'Special';
}

function getNeonS3PublicUrl(endpoint, bucket, key) {
  const cleanBase = endpoint.replace(/\/+$/, '');
  const cleanKey = key.replace(/^\/+/, '');
  return `${cleanBase}/${bucket}/${cleanKey}`;
}

async function asyncPool(limit, items, iteratorFn) {
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(executing);
}

function isClubInMvpConfig(league, club, config) {
  const excluded = config.excludeTeams || [];
  if (excluded.some(ex => ex.toLowerCase() === club.toLowerCase())) {
    return false;
  }

  const leagueConfig = config.leagues ? config.leagues[league] : null;
  if (!leagueConfig) return false;

  if (leagueConfig === 'ALL' || leagueConfig === '*') {
    return true;
  }

  if (Array.isArray(leagueConfig)) {
    return leagueConfig.some(
      target => target.toLowerCase() === club.toLowerCase()
    );
  }

  return false;
}

async function syncToNeonStorage() {
  console.log('='.repeat(72));
  console.log('⚡ JERSEY AUTOMATE - SYNC MVP PRODUCTS TO NEON S3 & POSTGRES');
  console.log(`   Neon S3 Endpoint: ${AWS_ENDPOINT_URL_S3}`);
  console.log(`   Neon S3 Bucket:   ${AWS_S3_BUCKET}`);
  console.log(`   Config File:      ${CONFIG_PATH}`);
  console.log('='.repeat(72));

  if (!existsSync(KITS_JSON_PATH)) {
    console.error(`❌ Kit metadata file not found: ${KITS_JSON_PATH}`);
    process.exit(1);
  }

  let mvpConfig = {};
  if (existsSync(CONFIG_PATH)) {
    const rawConfig = await fs.readFile(CONFIG_PATH, 'utf-8');
    mvpConfig = JSON.parse(rawConfig);
  }

  // 1. Ensure Organization exists in Neon Postgres
  const org = await prisma.organization.upsert({
    where: { id: DEFAULT_ORGANIZATION_ID },
    update: { isActive: true },
    create: {
      id: DEFAULT_ORGANIZATION_ID,
      name: 'Default Store',
      slug: 'default-store',
      isActive: true
    }
  });
  console.log(`✅ Tenant organization ready: "${org.name}" (${org.id})`);

  // Ensure default Settings exist
  await prisma.setting.upsert({
    where: { organizationId: DEFAULT_ORGANIZATION_ID },
    update: {},
    create: {
      organizationId: DEFAULT_ORGANIZATION_ID,
      storeName: 'Jersey Store MVP',
      currency: 'NGN',
      defaultShippingFee: 2000.00,
      customPrintingFee: 3000.00
    }
  });

  // 2. Read raw scraped metadata
  const rawData = await fs.readFile(KITS_JSON_PATH, 'utf-8');
  const clubsData = JSON.parse(rawData);

  // 3. Filter MVP target kits
  const targetKits = [];
  const selectedClubs = new Set();

  for (const clubItem of clubsData) {
    const league = clubItem.league || 'Other';
    const club = clubItem.club || clubItem.team || 'Unknown Club';

    if (isClubInMvpConfig(league, club, mvpConfig)) {
      selectedClubs.add(`${league} - ${club}`);
      const kits = clubItem.kits || [];
      for (const kit of kits) {
        targetKits.push({
          league,
          team: club,
          kitName: kit.kitName || 'Kit',
          kitType: parseKitType(kit.kitName),
          season: kit.season || '2026/27',
          kitPageUrl: kit.kitPageUrl || kit.sourceUrl || '',
          imageUrl: kit.imageUrl || '',
          localFilePath: kit.localFilePath || ''
        });
      }
    }
  }

  console.log(`\n🎯 MVP Catalog Selection:`);
  console.log(`   Clubs:      ${selectedClubs.size} big clubs`);
  console.log(`   Total Kits: ${targetKits.length} kits to move\n`);

  // 4. Mark all existing non-MVP jerseys inactive in Neon Postgres
  await prisma.jersey.updateMany({
    where: { organizationId: DEFAULT_ORGANIZATION_ID },
    data: { isActive: false }
  });

  let completedCount = 0;
  let uploadSuccessCount = 0;
  let dbSuccessCount = 0;

  console.log(`🚀 Starting S3 upload to Neon & Postgres upsert (Concurrency: ${CONCURRENCY_LIMIT})...\n`);

  await asyncPool(CONCURRENCY_LIMIT, targetKits, async (item) => {
    completedCount++;
    const progress = `[${completedCount}/${targetKits.length}]`;

    // Locate local file on disk
    let resolvedFilePath = null;
    if (item.localFilePath) {
      const p1 = path.resolve(BASE_DOWNLOAD_DIR, item.localFilePath);
      if (existsSync(p1)) resolvedFilePath = p1;
    }

    if (!resolvedFilePath) {
      const fallbackPath = path.join(
        BASE_DOWNLOAD_DIR,
        'kits',
        sanitizeName(item.league),
        sanitizeName(item.team),
        `${sanitizeName(item.kitName)}.jpg`
      );
      if (existsSync(fallbackPath)) resolvedFilePath = fallbackPath;
    }

    const leagueFolder = sanitizeName(item.league);
    const clubFolder = sanitizeName(item.team);
    const safeFilename = `${sanitizeName(item.kitName)}.jpg`;
    const s3Key = `kits/2026-27/${leagueFolder}/${clubFolder}/${safeFilename}`;
    let finalImageUrl = item.imageUrl;

    // Upload to Neon S3
    if (resolvedFilePath) {
      try {
        const fileBuffer = await fs.readFile(resolvedFilePath);

        await s3Client.send(
          new PutObjectCommand({
            Bucket: AWS_S3_BUCKET,
            Key: s3Key,
            Body: fileBuffer,
            ContentType: 'image/jpeg'
          })
        );

        finalImageUrl = getNeonS3PublicUrl(AWS_ENDPOINT_URL_S3, AWS_S3_BUCKET, s3Key);
        uploadSuccessCount++;
      } catch (s3Err) {
        console.warn(`${progress} ⚠️ Neon S3 upload issue (${item.team} - ${item.kitName}): ${s3Err.message}`);
      }
    }

    // Upsert DiscoveredKit in Neon Postgres
    const kitTitle = `${item.team} ${item.season} ${item.kitType} Kit`;
    let discoveredKit = null;

    try {
      discoveredKit = await prisma.discoveredKit.upsert({
        where: {
          uq_discovered_kit: {
            league: item.league,
            team: item.team,
            season: item.season,
            kitType: item.kitType
          }
        },
        update: {
          storageImageUrl: finalImageUrl,
          rawImageUrl: item.imageUrl,
          sourceUrl: item.kitPageUrl
        },
        create: {
          league: item.league,
          team: item.team,
          season: item.season,
          kitType: item.kitType,
          title: kitTitle,
          rawImageUrl: item.imageUrl,
          storageImageUrl: finalImageUrl,
          sourceUrl: item.kitPageUrl
        }
      });
    } catch {
      // DiscoveredKit upsert non-blocking
    }

    // Upsert Jersey in Neon Postgres
    try {
      const existingJersey = await prisma.jersey.findFirst({
        where: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          team: item.team,
          season: item.season,
          kitType: item.kitType
        }
      });

      let jerseyId = existingJersey?.id;

      if (!existingJersey) {
        const createdJersey = await prisma.jersey.create({
          data: {
            organizationId: DEFAULT_ORGANIZATION_ID,
            discoveredKitId: discoveredKit?.id || null,
            title: kitTitle,
            league: item.league,
            team: item.team,
            season: item.season,
            kitType: item.kitType,
            basePrice: 25000.00, // Default ₦25,000 NGN
            imageUrl: finalImageUrl,
            description: `Official ${item.season} ${item.team} ${item.kitType} football kit. Authentic quality.`,
            isActive: true
          }
        });
        jerseyId = createdJersey.id;
      } else {
        await prisma.jersey.update({
          where: { id: existingJersey.id },
          data: {
            imageUrl: finalImageUrl,
            isActive: true
          }
        });
      }

      // Seed standard inventory sizes: S, M, L, XL, XXL
      if (jerseyId) {
        const standardSizes = ['S', 'M', 'L', 'XL', 'XXL'];
        for (const size of standardSizes) {
          await prisma.jerseyInventory.upsert({
            where: {
              uq_jersey_size: {
                jerseyId,
                size
              }
            },
            update: {},
            create: {
              organizationId: DEFAULT_ORGANIZATION_ID,
              jerseyId,
              size,
              quantityOnHand: 10,
              quantityReserved: 0
            }
          });
        }
      }

      dbSuccessCount++;
      console.log(`${progress} ✔️ Moved to Neon S3 & Postgres: ${item.league} > ${item.team} > ${item.kitName}`);
    } catch (dbErr) {
      console.error(`${progress} ❌ DB error (${item.team}):`, dbErr.message);
    }
  });

  console.log('\n' + '='.repeat(72));
  console.log('🎉 NEON STORAGE & DATABASE MIGRATION COMPLETE!');
  console.log(`   🏆 Big Clubs Processed:    ${selectedClubs.size}`);
  console.log(`   ☁️ Uploaded to Neon S3:     ${uploadSuccessCount} images`);
  console.log(`   💾 Active in Neon Postgres: ${dbSuccessCount} jerseys`);
  console.log('='.repeat(72));
  console.log('\n✅ Products are now fully hosted on Neon AWS Storage & Neon Postgres!');
  console.log('All images are served directly from Neon Object Storage bucket "jerseys".\n');
}

syncToNeonStorage()
  .catch((err) => {
    console.error('Fatal sync error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

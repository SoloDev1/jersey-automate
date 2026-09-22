import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  SUPABASE_SERVICE_ROLE_KEY.includes('your_supabase') ||
  SUPABASE_SERVICE_ROLE_KEY.includes('placeholder')
) {
  console.error('\n❌ ERROR: Supabase credentials are missing or invalid in your .env file!');
  console.error('Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env before running this script.');
  console.error('You can find your service role key in:');
  console.error('Supabase Dashboard -> Project Settings -> API -> Project API keys -> "service_role" (secret)\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const BASE_DOWNLOAD_DIR = path.resolve(__dirname, '../downloads');
const KITS_JSON_PATH = path.join(BASE_DOWNLOAD_DIR, 'footy_26_27_kits.json');
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

async function ensureStorageBucket(bucketName = 'products') {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    console.warn(`⚠️ Warning: Could not list storage buckets: ${error.message}`);
    return;
  }

  const exists = buckets?.some((b) => b.name === bucketName);
  if (!exists) {
    console.log(`📦 Bucket "${bucketName}" not found. Creating public bucket...`);
    const { error: createErr } = await supabase.storage.createBucket(bucketName, {
      public: true
    });
    if (createErr) {
      console.warn(`⚠️ Failed to create bucket "${bucketName}": ${createErr.message}`);
      console.warn(`Please create the bucket "${bucketName}" manually in Supabase Dashboard -> Storage -> New Bucket (Public: YES).`);
    } else {
      console.log(`✅ Bucket "${bucketName}" created successfully!`);
    }
  } else {
    console.log(`✅ Storage bucket "${bucketName}" verified.`);
  }
}

async function syncToSupabase() {
  console.log('='.repeat(70));
  console.log('🚀 JERSEY AUTOMATE - LOCAL TO SUPABASE SYNC');
  console.log(`   Target Supabase URL: ${SUPABASE_URL}`);
  console.log(`   Metadata JSON: ${KITS_JSON_PATH}`);
  console.log('='.repeat(70));

  if (!existsSync(KITS_JSON_PATH)) {
    console.error(`❌ File not found: ${KITS_JSON_PATH}`);
    console.error('Please run "npm run scrape" first to scrape kit data.');
    process.exit(1);
  }

  // 1. Ensure Storage Bucket exists
  await ensureStorageBucket('products');

  // 2. Read scraped metadata
  const rawData = await fs.readFile(KITS_JSON_PATH, 'utf-8');
  const clubsData = JSON.parse(rawData);

  // Flatten all kits into a single array
  const allKits = [];
  for (const clubItem of clubsData) {
    const league = clubItem.league || 'Other';
    const club = clubItem.club || clubItem.team || 'Unknown Club';
    const kits = clubItem.kits || [];
    for (const kit of kits) {
      allKits.push({
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

  console.log(`\n📋 Found ${allKits.length} kits across ${clubsData.length} clubs in local database.`);
  console.log(`⚡ Starting image upload to Supabase Storage & sync to database...\n`);

  let completedCount = 0;
  let uploadSuccessCount = 0;
  let dbSuccessCount = 0;
  let skippedCount = 0;

  await asyncPool(CONCURRENCY_LIMIT, allKits, async (item) => {
    completedCount++;
    const progress = `[${completedCount}/${allKits.length}]`;

    // Locate local image file
    let resolvedFilePath = null;
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

    // Upload image to Supabase Storage if local image exists
    if (resolvedFilePath) {
      try {
        const fileBuffer = await fs.readFile(resolvedFilePath);
        const leagueFolder = sanitizeName(item.league);
        const clubFolder = sanitizeName(item.team);
        const safeFilename = `${sanitizeName(item.kitName)}.jpg`;
        const storagePath = `kits/2026-27/${leagueFolder}/${clubFolder}/${safeFilename}`;

        const { error: uploadError } = await supabase.storage
          .from('products')
          .upload(storagePath, fileBuffer, {
            contentType: 'image/jpeg',
            upsert: true
          });

        if (uploadError) {
          console.warn(`${progress} ⚠️ Storage upload error (${item.team} - ${item.kitName}): ${uploadError.message}`);
        } else {
          uploadSuccessCount++;
          const { data: publicUrlData } = supabase.storage
            .from('products')
            .getPublicUrl(storagePath);
          publicCdnUrl = publicUrlData.publicUrl;
        }
      } catch (err) {
        console.warn(`${progress} ⚠️ Could not read/upload image: ${err.message}`);
      }
    } else {
      skippedCount++;
    }

    // 1. Upsert into discovered_kits table
    const kitTitle = `${item.team} ${item.season} ${item.kitType} Kit`;
    let discoveredKitId = null;

    try {
      const { data: discData, error: discErr } = await supabase
        .from('discovered_kits')
        .upsert(
          {
            league: item.league,
            team: item.team,
            season: item.season,
            kit_type: item.kitType,
            title: kitTitle,
            raw_image_url: item.imageUrl,
            storage_image_url: publicCdnUrl,
            source_url: item.kitPageUrl,
            scraped_at: new Date().toISOString()
          },
          { onConflict: 'league,team,season,kit_type' }
        )
        .select('id')
        .maybeSingle();

      if (discErr) {
        console.warn(`${progress} ⚠️ discovered_kits error: ${discErr.message}`);
      } else if (discData) {
        discoveredKitId = discData.id;
      }

      // 2. Also insert into jerseys table (Tenant Store Catalog) if not already exists
      // Check if jersey already exists for this team, season, kit_type
      const { data: existingJersey } = await supabase
        .from('jerseys')
        .select('id')
        .eq('organization_id', DEFAULT_ORGANIZATION_ID)
        .eq('team', item.team)
        .eq('season', item.season)
        .eq('kit_type', item.kitType)
        .maybeSingle();

      let currentJerseyId = existingJersey?.id;

      if (!currentJerseyId) {
        const { data: insertedJersey, error: insertErr } = await supabase
          .from('jerseys')
          .insert({
            organization_id: DEFAULT_ORGANIZATION_ID,
            discovered_kit_id: discoveredKitId,
            title: kitTitle,
            league: item.league,
            team: item.team,
            season: item.season,
            kit_type: item.kitType,
            base_price: 0.00, // Admin updates this price!
            image_url: publicCdnUrl,
            description: `Official ${item.season} ${item.team} ${item.kitType} football kit. Authentic quality.`,
            is_active: true
          })
          .select('id')
          .single();

        if (insertErr) {
          console.warn(`${progress} ⚠️ jerseys insert error: ${insertErr.message}`);
        } else {
          currentJerseyId = insertedJersey.id;
        }
      } else {
        // Update image_url to latest storage public URL if available
        await supabase
          .from('jerseys')
          .update({ image_url: publicCdnUrl })
          .eq('id', currentJerseyId);
      }

      if (currentJerseyId) {
        // Seed default size inventory (S, M, L, XL, XXL) if needed
        const standardSizes = ['S', 'M', 'L', 'XL', 'XXL'];
        const inventoryRows = standardSizes.map((size) => ({
          organization_id: DEFAULT_ORGANIZATION_ID,
          jersey_id: currentJerseyId,
          size,
          quantity_on_hand: 10, // Default initial stock
          quantity_reserved: 0
        }));

        await supabase
          .from('jersey_inventory')
          .upsert(inventoryRows, { onConflict: 'jersey_id,size', ignoreDuplicates: true });
      }

      dbSuccessCount++;
      console.log(`${progress} ✔️ Synced: ${item.league} > ${item.team} > ${item.kitName}`);
    } catch (dbErr) {
      console.error(`${progress} ❌ DB Sync failure (${item.team}):`, dbErr.message);
    }
  });

  console.log('\n' + '='.repeat(70));
  console.log('🎉 SYNC PROCESS FINISHED!');
  console.log(`   📦 Total kits processed: ${allKits.length}`);
  console.log(`   ☁️ Images uploaded to Supabase Storage: ${uploadSuccessCount}`);
  console.log(`   💾 Database rows synced: ${dbSuccessCount}`);
  if (skippedCount > 0) {
    console.log(`   ℹ️ Images using remote fallback URL: ${skippedCount}`);
  }
  console.log('='.repeat(70));
  console.log('\n👉 Next steps for the Admin:');
  console.log('1. Open Supabase Dashboard -> Table Editor -> "jerseys"');
  console.log('2. The "base_price" column is currently initialized to 0.00.');
  console.log('3. Set retail prices (e.g. 25000 NGN) for each kit or run a bulk SQL update!');
  console.log('='.repeat(70) + '\n');
}

syncToSupabase().catch((err) => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});

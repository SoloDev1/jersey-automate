import * as cheerio from 'cheerio';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const isSupabaseConfigured =
  Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) &&
  !SUPABASE_URL.includes('placeholder') &&
  !SUPABASE_SERVICE_ROLE_KEY.includes('placeholder');

let supabase = null;
if (isSupabaseConfigured) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}

// Target Overview URL
const TARGET_URL =
  process.argv[2] || 'https://www.footyheadlines.com/26-27-kit-overview/?section=Kits';

const BASE_DOWNLOAD_DIR = path.resolve(__dirname, '../downloads');
const KITS_DIR = path.join(BASE_DOWNLOAD_DIR, 'kits');
const CONCURRENCY_LIMIT = 5;

// Helper to sanitize folder and file names for filesystem and storage paths
function sanitizeName(str) {
  return (str || 'unknown')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Helper to deduce normalized Kit Type
function parseKitType(kitName) {
  const lower = kitName.toLowerCase();
  if (lower.includes('home')) return 'Home';
  if (lower.includes('away')) return 'Away';
  if (lower.includes('third')) return 'Third';
  if (lower.includes('fourth')) return 'Fourth';
  if (lower.includes('goalkeeper') || lower.includes('gk')) return 'Goalkeeper';
  return 'Special';
}

// Download image into memory buffer and optionally write to disk
async function fetchImageBuffer(primaryUrl, fallbackUrl, destFilePath) {
  const urlsToTry = [primaryUrl];
  if (fallbackUrl && fallbackUrl !== primaryUrl) {
    urlsToTry.push(fallbackUrl);
  }

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Referer: 'https://www.footyheadlines.com/'
        }
      });

      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        // Save locally if destFilePath is provided
        if (destFilePath) {
          await fs.writeFile(destFilePath, buffer);
        }

        return buffer;
      }
    } catch {
      // Try fallback URL if available
    }
  }

  return null;
}

// Concurrent task queue runner
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

async function scrapeFootyHeadlines() {
  console.log('='.repeat(65));
  console.log(`🌐 FOOTYHEADLINES KIT SCRAPER & STORAGE SYNC`);
  console.log(`   Target URL: ${TARGET_URL}`);
  console.log(
    `   Supabase Sync: ${isSupabaseConfigured ? '🟢 Active (Storage + discovered_kits)' : '🟡 Inactive (Local Filesystem only)'}`
  );
  console.log('='.repeat(65));

  const response = await fetch(TARGET_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch page: HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const clubsData = [];
  const allKits = [];
  let currentLeague = 'Other';

  const contentContainer = $('.post-item__content');
  const targetElements =
    contentContainer.length > 0 ? contentContainer.children() : $('body').children();

  targetElements.each((_, el) => {
    const elem = $(el);

    if (elem.hasClass('kit-overview__league-title')) {
      currentLeague = elem.text().trim() || 'Other';
    } else if (elem.is('h3')) {
      const clubName = elem.text().trim();
      const nextSibling = elem.next();

      if (nextSibling.hasClass('kit-container')) {
        const kits = [];

        nextSibling.find('.kit').each((_, kitEl) => {
          const kit = $(kitEl);
          const kitLinkElem = kit.closest('a');
          const kitPageUrl = kitLinkElem.attr('href')
            ? new URL(kitLinkElem.attr('href'), TARGET_URL).href
            : '';

          const kitName =
            kit.find('.kit-teamname span').text().trim() ||
            kit.find('.kit-teamname').text().trim() ||
            'Kit';

          const img = kit.find('img');
          const rawSrc = img.attr('data-src') || img.attr('src');

          if (rawSrc && !rawSrc.includes('blank.svg')) {
            const smallImgUrl = new URL(rawSrc, TARGET_URL).href;
            const highResImgUrl = smallImgUrl.replace('-small.', '.');
            const kitType = parseKitType(kitName);
            const season = '2026/27';

            const item = {
              league: currentLeague,
              team: clubName,
              season,
              kitType,
              kitName,
              title: `${clubName} ${season} ${kitType} Kit`,
              sourceUrl: kitPageUrl,
              imageUrl: highResImgUrl,
              fallbackImageUrl: smallImgUrl
            };

            kits.push(item);
            allKits.push(item);
          }
        });

        if (kits.length > 0) {
          clubsData.push({
            league: currentLeague,
            club: clubName,
            kitsCount: kits.length,
            kits
          });
        }
      }
    }
  });

  console.log(`\n✅ Scraped metadata successfully:`);
  console.log(`   🏆 Total Clubs: ${clubsData.length}`);
  console.log(`   👕 Total Kits Discovered: ${allKits.length}`);

  if (allKits.length === 0) {
    console.log('⚠️ No kits found.');
    return;
  }

  // Ensure base local directory exists
  await fs.mkdir(KITS_DIR, { recursive: true });

  console.log(`\n⚡ Starting download & sync (Concurrency: ${CONCURRENCY_LIMIT})...\n`);

  let completedCount = 0;
  let successCount = 0;

  await asyncPool(CONCURRENCY_LIMIT, allKits, async (item) => {
    const leagueFolder = sanitizeName(item.league);
    const clubFolder = sanitizeName(item.team);
    const clubDirPath = path.join(KITS_DIR, leagueFolder, clubFolder);

    await fs.mkdir(clubDirPath, { recursive: true });

    const safeKitName = sanitizeName(item.kitName);
    const filename = `${safeKitName}.jpg`;
    const destFilePath = path.join(clubDirPath, filename);

    const buffer = await fetchImageBuffer(item.imageUrl, item.fallbackImageUrl, destFilePath);
    completedCount++;

    if (buffer) {
      successCount++;
      item.localFilePath = path.relative(BASE_DOWNLOAD_DIR, destFilePath);

      // Upload to Supabase Storage & sync to discovered_kits if configured
      if (supabase) {
        try {
          const storagePath = `kits/${sanitizeName(item.season)}/${leagueFolder}/${clubFolder}/${filename}`;
          const { error: uploadError } = await supabase.storage
            .from('products')
            .upload(storagePath, buffer, {
              contentType: 'image/jpeg',
              upsert: true
            });

          let cdnUrl = item.imageUrl;
          if (!uploadError) {
            const { data: publicUrlData } = supabase.storage
              .from('products')
              .getPublicUrl(storagePath);
            cdnUrl = publicUrlData.publicUrl;
          }

          // Insert or update in discovered_kits
          await supabase.from('discovered_kits').upsert(
            {
              league: item.league,
              team: item.team,
              season: item.season,
              kit_type: item.kitType,
              title: item.title,
              raw_image_url: item.imageUrl,
              storage_image_url: cdnUrl,
              source_url: item.sourceUrl,
              scraped_at: new Date().toISOString()
            },
            { onConflict: 'league,team,season,kit_type' }
          );
        } catch (dbErr) {
          // Non-blocking database sync failure
        }
      }

      console.log(
        `[${completedCount}/${allKits.length}] ✔️ ${item.league} > ${item.team} > ${item.kitName}`
      );
    } else {
      console.log(
        `[${completedCount}/${allKits.length}] ❌ Failed: ${item.team} - ${item.kitName}`
      );
    }
  });

  // Save metadata JSON locally
  const jsonPath = path.join(BASE_DOWNLOAD_DIR, 'footy_26_27_kits.json');
  await fs.writeFile(jsonPath, JSON.stringify(clubsData, null, 2), 'utf-8');

  console.log('\n' + '='.repeat(65));
  console.log(`🎉 Scraping & Sync Complete!`);
  console.log(`   ✔️ Processed: ${successCount} / ${allKits.length} kits`);
  console.log(`   📁 Local Directory: ${KITS_DIR}`);
  console.log(`   📄 Metadata JSON: ${jsonPath}`);
  if (isSupabaseConfigured) {
    console.log(`   ☁️ Cloud Sync: Populated 'products' bucket & 'discovered_kits' table`);
  }
  console.log('='.repeat(65));
}

scrapeFootyHeadlines().catch((err) => {
  console.error('Fatal error running scraper:', err);
});
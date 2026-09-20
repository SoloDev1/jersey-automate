import * as cheerio from 'cheerio';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

// Target URL
const TARGET_URL =
  process.argv[2] || 'https://www.footyheadlines.com/26-27-kit-overview/?section=Kits';

const BASE_DOWNLOAD_DIR = path.resolve('downloads');
const KITS_DIR = path.join(BASE_DOWNLOAD_DIR, 'kits');
const CONCURRENCY_LIMIT = 5;

// Helper to sanitize folder and file names for Windows filesystem
function sanitizeName(str) {
  return (str || 'unknown')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Download image with fallback and retry
async function downloadImage(primaryUrl, fallbackUrl, destFilePath) {
  if (existsSync(destFilePath)) {
    return true; // Skip if already downloaded
  }

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
          'Referer': 'https://www.footyheadlines.com/',
        },
      });

      if (res.ok) {
        const fileStream = createWriteStream(destFilePath);
        await pipeline(Readable.fromWeb(res.body), fileStream);
        return true;
      }
    } catch {
      // Try fallback URL if available
    }
  }

  return false;
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
  console.log('='.repeat(60));
  console.log(`🌐 Fetching Kit Overview from:`);
  console.log(`   ${TARGET_URL}`);
  console.log('='.repeat(60));

  const response = await fetch(TARGET_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch page: HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const clubsData = [];
  const allImagesToDownload = [];
  let currentLeague = 'Other';

  // FootyHeadlines Kit Overview structure
  const contentContainer = $('.post-item__content');
  const targetElements = contentContainer.length > 0 ? contentContainer.children() : $('body').children();

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

            const item = {
              league: currentLeague,
              club: clubName,
              kitName,
              kitPageUrl,
              imageUrl: highResImgUrl,
              fallbackImageUrl: smallImgUrl,
            };

            kits.push(item);
            allImagesToDownload.push(item);
          }
        });

        if (kits.length > 0) {
          clubsData.push({
            league: currentLeague,
            club: clubName,
            kitsCount: kits.length,
            kits,
          });
        }
      }
    }
  });

  console.log(`\n✅ Scraped metadata successfully:`);
  console.log(`   🏆 Total Clubs: ${clubsData.length}`);
  console.log(`   👕 Total Kits/Images: ${allImagesToDownload.length}`);

  if (allImagesToDownload.length === 0) {
    console.log('⚠️ No kit images found to download.');
    return;
  }

  // Ensure base directories exist
  await fs.mkdir(KITS_DIR, { recursive: true });

  console.log(`\n📁 Images will be saved to: downloads/kits/<League>/<Club>/`);
  console.log(`⚡ Starting download (Concurrency: ${CONCURRENCY_LIMIT})...\n`);

  let completedCount = 0;
  let successCount = 0;

  await asyncPool(CONCURRENCY_LIMIT, allImagesToDownload, async (item) => {
    const leagueFolder = sanitizeName(item.league);
    const clubFolder = sanitizeName(item.club);
    const clubDirPath = path.join(KITS_DIR, leagueFolder, clubFolder);

    await fs.mkdir(clubDirPath, { recursive: true });

    const safeKitName = sanitizeName(item.kitName);
    const filename = `${safeKitName}.jpg`;
    const destFilePath = path.join(clubDirPath, filename);

    const ok = await downloadImage(item.imageUrl, item.fallbackImageUrl, destFilePath);
    completedCount++;

    if (ok) {
      successCount++;
      item.localFilePath = path.relative(BASE_DOWNLOAD_DIR, destFilePath);
      console.log(
        `[${completedCount}/${allImagesToDownload.length}] ✔️ ${item.league} > ${item.club} > ${item.kitName}`
      );
    } else {
      console.log(
        `[${completedCount}/${allImagesToDownload.length}] ❌ Failed: ${item.club} - ${item.kitName}`
      );
    }
  });

  // Save metadata JSON
  const jsonPath = path.join(BASE_DOWNLOAD_DIR, 'footy_26_27_kits.json');
  await fs.writeFile(jsonPath, JSON.stringify(clubsData, null, 2), 'utf-8');

  console.log('\n' + '='.repeat(60));
  console.log(`🎉 Download Complete!`);
  console.log(`   ✔️ Downloaded: ${successCount} / ${allImagesToDownload.length} images`);
  console.log(`   📁 Directory: ${KITS_DIR}`);
  console.log(`   📄 Metadata: ${jsonPath}`);
  console.log('='.repeat(60));
}

scrapeFootyHeadlines().catch((err) => {
  console.error('Fatal error running scraper:', err);
});
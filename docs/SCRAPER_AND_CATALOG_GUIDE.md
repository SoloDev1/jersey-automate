# Kit Scraper & Catalog Pipeline Guide

This document explains the FootyHeadlines kit scraping engine, image handling, concurrency management, and synchronization with **Supabase Storage** and PostgreSQL.

---

## 🎯 Purpose of the Scraper

FootyHeadlines is the premier global source for football kit releases, leaks, and season overviews. The scraper extracts:
- **League**: e.g., Premier League, La Liga, Serie A, Bundesliga, Ligue 1, MLS, Champions League.
- **Team**: e.g., Arsenal, Chelsea, Barcelona, PSG, Juventus.
- **Kit Type**: Home, Away, Third, Fourth, Goalkeeper.
- **Season**: e.g., `26-27`.
- **High-Resolution Images**: Official product photography and preview renders.

---

## ⚙️ Architecture & Data Flow

```mermaid
flowchart LR
    Source["FootyHeadlines Overview Page"] -->|Cheerio HTML Parse| Extractor["Kit Attribute Extractor"]
    Extractor -->|Concurrency Queue (5 concurrent)| WorkerPool["Image Fetch Pool"]
    WorkerPool -->|Memory Stream Buffer| StorageUploader["Supabase Storage (/products)"]
    StorageUploader -->|Get Public CDN URL| DBWriter["PostgreSQL (jerseys table)"]
```

### 1. HTML Extraction (`Cheerio`)
- Scrapes kit sections targeting headings (`h2`, `h3`) and league anchor blocks.
- Identifies image tags (`<img>`), inspecting both `src` and `data-src` attributes to capture un-lazyloaded full resolution URLs.
- Cleans team names and kit titles, stripping unwanted characters for uniform categorization.

### 2. Concurrency Control & Rate Limiting
To prevent FootyHeadlines from blocking requests or exhausting local memory, image processing uses an asynchronous task pool:
```javascript
const CONCURRENCY_LIMIT = 5;
```
Only 5 simultaneous image downloads/uploads are executed at any one time.

### 3. Uploading Directly to Supabase Storage
Instead of saving files to temporary local disks that wipe out on server redeployments, image streams are uploaded directly to the Supabase **`products`** bucket:

```javascript
import { supabase } from '../config/supabase.js';

async function uploadKitImage(imageBuffer, league, team, kitName) {
  const filePath = `${league}/${team}/${kitName}.jpg`.toLowerCase().replace(/\s+/g, '_');
  
  const { data, error } = await supabase.storage
    .from('products')
    .upload(filePath, imageBuffer, {
      contentType: 'image/jpeg',
      upsert: true
    });

  if (error) throw error;

  const { data: publicData } = supabase.storage
    .from('products')
    .getPublicUrl(filePath);

  return publicData.publicUrl;
}
```

### 4. Database Catalog Upsert
Once the public CDN URL is generated, the kit is saved or updated in the `jerseys` table:
```javascript
await supabase.from('jerseys').upsert({
  league,
  team,
  season: '26-27',
  kit_type: kitType,
  title: `${team} 26-27 ${kitType} Kit`,
  image_url: publicUrl,
  price: 45.00,
  sizes_available: ['S', 'M', 'L', 'XL', 'XXL'],
  is_in_stock: true,
  source_url: kitArticleUrl
}, { onConflict: 'league, team, season, kit_type' });
```

---

## 🚀 Running the Scraper

### Via REST API / CRM:
In the CRM under **Inventory**, click **"Sync Latest Kits"**, or execute:
```bash
curl -X POST http://localhost:3000/api/scraper/sync \
  -H "Content-Type: application/json" \
  -d '{"season": "26-27"}'
```

### Via CLI Script (Direct Scrape):
```bash
node src/services/scraperService.js
```

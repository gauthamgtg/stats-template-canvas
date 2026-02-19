import { readdir, readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer";

const ROOT = resolve(import.meta.dirname, "..");
const TEMPLATES_DIR = join(ROOT, "templates");
const OUT_DIR = join(ROOT, "public", "thumbnails");

const VIEWPORT = { width: 1200, height: 900 };

async function generateThumbnails() {
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(TEMPLATES_DIR))
    .filter((f) => f.endsWith(".html") && f !== "stats_collection.html")
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  console.log(`Found ${files.length} templates. Generating thumbnails…`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  let done = 0;

  for (const file of files) {
    const id = file.replace(/\.html$/i, "");
    const html = await readFile(join(TEMPLATES_DIR, file), "utf8");

    let page;
    try {
      page = await browser.newPage();
      await page.setViewport(VIEWPORT);
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 3000)));

      const outPath = join(OUT_DIR, `${id}.webp`);
      await page.screenshot({ path: outPath, type: "webp", quality: 80 });
      done++;
      console.log(`  [${done}/${files.length}] ${id}.webp`);
    } catch (err) {
      console.error(`  FAILED: ${id} — ${err.message}`);
    } finally {
      try { await page?.close(); } catch { /* ignore */ }
    }
  }

  await browser.close();
  console.log(`Done. ${done}/${files.length} thumbnails written to public/thumbnails/`);
}

generateThumbnails().catch((err) => {
  console.error(err);
  process.exit(1);
});

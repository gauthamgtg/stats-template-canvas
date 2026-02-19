import fs from "node:fs/promises";
import path from "node:path";

export type TemplateMeta = {
  id: string;
  name: string;
  description: string;
  file: string;
  category: string;
};

export type LoadedTemplate = TemplateMeta & {
  html: string;
};

const TEMPLATES_DIR = path.join(process.cwd(), "templates");

let templatesCache: TemplateMeta[] | null = null;
const templateHtmlCache = new Map<string, LoadedTemplate>();

function toTitleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractTitle(html: string, fallback: string) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || fallback;
}

function makeDescription(name: string) {
  return `${name} template ready for inline editing and export.`;
}

const DARK_KEYWORDS = ["night", "dark", "nocturne", "terminal", "crt", "deep", "midnight", "neon", "cyber", "vaporwave", "arcade"];
const PASTEL_KEYWORDS = ["pastel", "soft", "gentle", "blush", "lavender", "mint", "sunrise"];
const RETRO_KEYWORDS = ["retro", "vintage", "terminal", "crt", "arcade", "vaporwave", "pixel"];
const BOLD_KEYWORDS = ["brutalist", "bold", "vibrant", "tropical", "burst", "neon"];

function detectCategory(name: string): string {
  const lower = name.toLowerCase();
  if (DARK_KEYWORDS.some((k) => lower.includes(k))) return "Dark";
  if (RETRO_KEYWORDS.some((k) => lower.includes(k))) return "Retro";
  if (PASTEL_KEYWORDS.some((k) => lower.includes(k))) return "Pastel";
  if (BOLD_KEYWORDS.some((k) => lower.includes(k))) return "Bold";
  return "Professional";
}

export async function getTemplates(): Promise<TemplateMeta[]> {
  if (templatesCache) return templatesCache;

  const files = await fs.readdir(TEMPLATES_DIR);
  const htmlFiles = files
    .filter((file) => file.endsWith(".html"))
    .filter((file) => file !== "stats_collection.html")
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const templates = await Promise.all(
    htmlFiles.map(async (file) => {
      const id = file.replace(/\.html$/i, "");
      const fullPath = path.join(TEMPLATES_DIR, file);
      const html = await fs.readFile(fullPath, "utf8");
      const fallbackName = toTitleCase(id);
      const name = extractTitle(html, fallbackName);

      return {
        id,
        name,
        description: makeDescription(name),
        file,
        category: detectCategory(name),
      };
    })
  );

  templatesCache = templates;
  return templates;
}

export async function getTemplateById(templateId: string): Promise<LoadedTemplate | null> {
  const cached = templateHtmlCache.get(templateId);
  if (cached) return cached;

  const templates = await getTemplates();
  const meta = templates.find((template) => template.id === templateId);
  if (!meta) return null;

  const fullPath = path.join(TEMPLATES_DIR, meta.file);
  const html = await fs.readFile(fullPath, "utf8");
  const loaded: LoadedTemplate = { ...meta, html };
  templateHtmlCache.set(templateId, loaded);
  return loaded;
}

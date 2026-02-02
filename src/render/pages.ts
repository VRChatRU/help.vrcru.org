import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Templates, PageMeta } from '../types';
import { escapeHtml, formatDateTime, toIsoString } from '../utils/text';
import { ensureDir } from '../utils/assets';
import { TEMPLATES_DIR } from '../config';

/**
 * Загружает HTML шаблоны из директории templates/
 */
export async function loadTemplates(): Promise<Templates> {
  const index = await readFile(path.join(TEMPLATES_DIR, "index.html"), "utf8");
  const thread = await readFile(path.join(TEMPLATES_DIR, "thread.html"), "utf8");
  return { index, thread };
}

/**
 * Рендерит шаблон, заменяя {{variables}}
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key];
    }
    return match;
  });
}

/**
 * Строит meta description тег
 */
export function buildMetaTags(description?: string): {
  descriptionTag: string;
} {
  const descriptionTag = description
    ? `<meta name="description" content="${escapeHtml(description)}">`
    : "";
  return { descriptionTag };
}

/**
 * Строит OpenGraph meta теги для главной страницы
 */
export function buildIndexMeta(params: {
  title: string;
  description: string;
}): { metaExtra: string } {
  const { title, description } = params;
  const tags = [
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
  ]
    .filter(Boolean)
    .join("\n  ");
  return { metaExtra: tags ? `  ${tags}` : "" };
}

/**
 * Строит OpenGraph meta теги для страницы треда
 */
export function buildThreadMeta(params: {
  title: string;
  description: string;
  ogImage?: string;
}): { metaExtra: string } {
  const { title, description, ogImage } = params;
  const tags = [
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : "",
  ]
    .filter(Boolean)
    .join("\n  ");
  return { metaExtra: tags ? `  ${tags}` : "" };
}

/**
 * Строит главную страницу (index.html) со списком тредов
 */
export async function buildIndexPage(params: {
  outputDir: string;
  items: PageMeta[];
  templates: Templates;
  siteTitle: string;
  siteDescription: string;
  baseUrl?: string;
}): Promise<void> {
  // Копируем style.css
  await ensureStyleAsset(params.outputDir);

  const items = [...params.items]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((item) => {
      const link = item.pageRelPath
        .replace(/\\/g, "/")
        .replace(/\/index\.html$/, "");
      return `    <li>
      <a href="${escapeHtml(link)}">${escapeHtml(item.title)}</a>
      <time datetime="${toIsoString(item.createdAt)}">${escapeHtml(
        item.createdAt.toLocaleString("ru-RU"),
      )}</time>
      <p>${escapeHtml(item.excerpt)}</p>
    </li>`;
    })
    .join("\n");

  const { descriptionTag } = buildMetaTags(params.siteDescription);
  const { metaExtra } = buildIndexMeta({
    title: params.siteTitle,
    description: params.siteDescription,
  });

  const indexHtml = renderTemplate(params.templates.index, {
    title: escapeHtml(params.siteTitle),
    site_title: escapeHtml(params.siteTitle),
    description_tag: descriptionTag,
    meta_extra: metaExtra,
    items,
    updated_at: escapeHtml(formatDateTime(new Date())),
    style_href: "assets/style.css",
  });

  await writeFile(path.join(params.outputDir, "index.html"), indexHtml, "utf8");

  // Генерируем sitemap если есть baseUrl
  if (params.baseUrl) {
    await generateSitemap({
      outputDir: params.outputDir,
      baseUrl: params.baseUrl,
      items: params.items,
    });
  }
}

// Копирует style.css в output директорию
export async function ensureStyleAsset(outputDir: string): Promise<void> {
  const sourcePath = path.join(TEMPLATES_DIR, "style.css");
  const style = await readFile(sourcePath, "utf8");
  const targetDir = path.join(outputDir, "assets");
  await ensureDir(targetDir);
  await writeFile(path.join(targetDir, "style.css"), style, "utf8");
}

/**
 * Генерирует sitemap.xml
 */
export async function generateSitemap(params: {
  outputDir: string;
  baseUrl: string;
  items: PageMeta[];
}): Promise<void> {
  const { outputDir, baseUrl, items } = params;

  const urls = [
    `  <url>
    <loc>${escapeHtml(baseUrl)}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`,
    ...items.map(item => {
      const url = `${baseUrl}/${item.pageRelPath.replace(/\\/g, '/').replace(/\/index\.html$/, '')}`;
      return `  <url>
    <loc>${escapeHtml(url)}</loc>
    <lastmod>${toIsoString(item.createdAt).split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
    })
  ].join('\n');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  await writeFile(path.join(outputDir, 'sitemap.xml'), sitemap, 'utf8');
}

// Читает локальные метаданные из threads/*/meta.json
export async function readLocalMeta(outputDir: string): Promise<PageMeta[]> {
  const threadsDir = path.join(outputDir, "threads");
  try {
    const dirents = await readdir(threadsDir, { withFileTypes: true });
    const results: PageMeta[] = [];

    for (const entry of dirents) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(threadsDir, entry.name, "meta.json");

      try {
        const raw = await readFile(metaPath, "utf8");
        const parsed = JSON.parse(raw) as {
          threadId: string;
          title: string;
          createdAt: string;
          excerpt: string;
          pageRelPath: string;
        };

        results.push({
          threadId: parsed.threadId,
          title: parsed.title,
          createdAt: new Date(parsed.createdAt),
          excerpt: parsed.excerpt,
          pageRelPath: parsed.pageRelPath,
        });
      } catch (error) {
        console.warn("[meta] Failed to read", metaPath, error);
      }
    }

    return results;
  } catch {
    return [];
  }
}

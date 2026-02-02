import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Создаёт директорию рекурсивно
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Удаляет директорию рекурсивно
 */
export async function deleteDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
}

/**
 * Скачивает файл по URL и сохраняет на диск
 */
export async function downloadToFile(url: string, destPath: string): Promise<void> {
  // Валидация URL - только Discord CDN (защита от SSRF)
  const allowedHosts = ['cdn.discordapp.com', 'media.discordapp.net'];
  try {
    const urlObj = new URL(url);
    if (!allowedHosts.includes(urlObj.hostname)) {
      throw new Error(`URL host not allowed: ${urlObj.hostname}`);
    }
  } catch (error) {
    throw new Error(`Invalid URL: ${url}`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  await ensureDir(path.dirname(destPath));
  await writeFile(destPath, new Uint8Array(buffer));
}

/**
 * Возвращает путь к директории вывода для треда
 */
export function getThreadOutputDir(outputDir: string, threadId: string): string {
  return path.join(outputDir, "threads", threadId);
}

/**
 * Возвращает относительный путь к странице треда
 */
export function getThreadPageRelPath(threadId: string): string {
  return path.join("threads", threadId, "index.html").replace(/\\/g, "/");
}

/**
 * Формирует относительный путь к ресурсу
 */
export function getAssetRel(assetRoot: string, fileName: string): string {
  return path.join(assetRoot, fileName).replace(/\\/g, "/");
}

/**
 * Скачивает ресурс с кэшированием
 * Возвращает относительный путь к скачанному файлу или null при ошибке
 */
export async function downloadAsset(params: {
  url: string;
  assetsRoot: string;
  assetRelDir: string;
  fileName: string;
  downloaded: Map<string, string>;
}): Promise<string | null> {
  const { url, assetsRoot, assetRelDir, fileName, downloaded } = params;

  // Проверяем кэш
  const existing = downloaded.get(url);
  if (existing) return existing;

  const rel = getAssetRel(assetRelDir, fileName);
  const dest = path.join(assetsRoot, fileName);

  try {
    await downloadToFile(url, dest);
    downloaded.set(url, rel);
    return rel;
  } catch (error) {
    console.warn("[asset] download failed", url, error);
    return null;
  }
}

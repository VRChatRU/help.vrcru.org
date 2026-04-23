import type { Message } from 'discord.js';

/**
 * Экранирует HTML специальные символы
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Конвертирует Date в ISO string
 */
export function toIsoString(date: Date): string {
  return date.toISOString();
}

/**
 * Форматирует дату для отображения (русская локаль)
 */
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

/**
 * Обрезает текст до maxLen символов, добавляя "..."
 */
export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "...";
}

/**
 * Удаляет markdown форматирование из текста
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/`{1,3}[^`]+`{1,3}/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/[*_~>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Преобразует GIF ссылки в markdown image syntax
 */
export function normalizeGifLinks(text: string): string {
  const tokens = text.split(/(\s+)/);
  const replaced = tokens.map((token) => {
    if (!/^https?:\/\//i.test(token)) return token;
    if (!/\.gif(\?|#|$)/i.test(token)) return token;
    return `![](${token})`;
  });
  return replaced.join("");
}

function countChar(text: string, char: string): number {
  let total = 0;
  for (const current of text) {
    if (current === char) total += 1;
  }
  return total;
}

function splitTrailingUrlPunctuation(token: string): { url: string; suffix: string } {
  let url = token;
  let suffix = "";

  while (url.length > 0) {
    const last = url[url.length - 1];
    if (!last) break;

    if (/[.,!?;:'">]/.test(last)) {
      suffix = last + suffix;
      url = url.slice(0, -1);
      continue;
    }

    if (last === ")" && countChar(url, "(") < countChar(url, ")")) {
      suffix = last + suffix;
      url = url.slice(0, -1);
      continue;
    }

    if (last === "]" && countChar(url, "[") < countChar(url, "]")) {
      suffix = last + suffix;
      url = url.slice(0, -1);
      continue;
    }

    if (last === "}" && countChar(url, "{") < countChar(url, "}")) {
      suffix = last + suffix;
      url = url.slice(0, -1);
      continue;
    }

    break;
  }

  return { url, suffix };
}

function normalizeStandaloneUrlToken(token: string): string {
  const match = token.match(/https?:\/\/\S+/i);
  if (!match || match.index === undefined) return token;

  const prefix = token.slice(0, match.index);
  if (prefix && !/^[('"[{<]*$/.test(prefix)) return token;

  const remainder = token.slice(match.index + match[0].length);
  const { url, suffix } = splitTrailingUrlPunctuation(match[0]);
  const trailing = suffix + remainder;

  if (!url) return token;
  if (prefix === "<" && trailing === ">") return token;
  if (trailing && !/^[)\]}>.,!?;:'"]*$/.test(trailing)) return token;

  return `${prefix}[${url}](${url})${trailing}`;
}

/**
 * Делает "голые" URL кликабельными, не трогая код и уже размеченные markdown-ссылки
 */
export function normalizePlainLinks(text: string): string {
  const protectedSegmentRegex = /(```[\s\S]*?```|`[^`\n]+`)/g;
  let result = "";
  let lastIndex = 0;

  for (const match of text.matchAll(protectedSegmentRegex)) {
    const index = match.index ?? 0;
    const segment = text.slice(lastIndex, index);
    result += segment
      .split(/(\s+)/)
      .map((token) => (/\s+/.test(token) ? token : normalizeStandaloneUrlToken(token)))
      .join("");
    result += match[0];
    lastIndex = index + match[0].length;
  }

  const tail = text.slice(lastIndex);
  result += tail
    .split(/(\s+)/)
    .map((token) => (/\s+/.test(token) ? token : normalizeStandaloneUrlToken(token)))
    .join("");

  return result;
}

/**
 * Очищает имя файла от недопустимых символов
 */
export function sanitizeFilename(name: string): string {
  let trimmed = name.trim().replace(/[/\\?%*:|"<>]/g, "-");
  // Защита от path traversal
  trimmed = trimmed.replace(/\.\./g, "");
  trimmed = trimmed.replace(/^\.+/, "");
  return trimmed || "file";
}

/**
 * Проверяет, является ли файл изображением по расширению
 */
export function looksLikeImageFile(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

/**
 * Проверяет, является ли файл видео по расширению
 */
export function looksLikeVideoFile(name: string): boolean {
  return /\.(mp4|webm|mov|m4v)$/i.test(name);
}

/**
 * Проверяет, является ли файл аудио по расширению
 */
export function looksLikeAudioFile(name: string): boolean {
  return /\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(name);
}

/**
 * Добавляет sizing атрибуты к inline emoji в HTML
 */
export function applyInlineEmojiSizing(html: string): string {
  return html.replace(
    /<img([^>]*?)src="([^"]*\/emojis\/[^"]+)"([^>]*)>/g,
    (_match, before, src, after) => {
      let attrs = `${before}src="${src}"${after}`;
      if (/class="/.test(attrs)) {
        attrs = attrs.replace(/class="([^"]*)"/, (m, cls) => {
          if (cls.includes("inline-emoji")) return m;
          return `class="${cls} inline-emoji"`;
        });
      } else {
        attrs += ` class="inline-emoji"`;
      }
      if (!/width=/.test(attrs)) {
        attrs += ` width="30"`;
      }
      if (!/height=/.test(attrs)) {
        attrs += ` height="30"`;
      }
      return `<img${attrs}>`;
    },
  );
}

/**
 * Проверяет, является ли цвет дефолтным (пустой или #000000)
 */
export function isDefaultColor(color: string | null | undefined): boolean {
  return !color || color.toLowerCase() === "#000000";
}

/**
 * Проверяет, что два сообщения от одного автора
 */
export function isSameAuthor(a: Message, b: Message): boolean {
  return Boolean(a.author?.id && b.author?.id && a.author.id === b.author.id);
}

import { mkdir, rm, writeFile, readFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials,
  type GuildMember,
  type Message,
  type ThreadChannel,
  type User,
} from "discord.js";
import MarkdownIt from "markdown-it";

type EnvConfig = {
  BOT_TOKEN: string;
  GUILD_ID: string;
  FORUM_CHANNEL_ID: string;
  PUBLISHER_ROLE_IDS: string[];
  OUTPUT_DIR: string;
  BASE_URL?: string;
  PUBLISH_EMOJI: string;
  ANSWER_EMOJI: string;
  SITE_TITLE: string;
  SITE_DESCRIPTION: string;
  LOG_CHANNEL_ID?: string;
};

type PageMeta = {
  threadId: string;
  title: string;
  createdAt: Date;
  excerpt: string;
  pageRelPath: string;
};

type Templates = {
  index: string;
  thread: string;
};

type AuthorProfile = {
  name: string;
  color: string;
  avatarRel: string | null;
  roleIconRel: string | null;
};

type MentionInfo = {
  name: string;
  color: string;
};

type AssetResult = {
  markdown: string;
  extraHtml: string[];
  imageRels: string[];
  mentionTokens: Map<string, string>;
};

type RenderedMessage = {
  messageId: string;
  createdAt: Date;
  htmlContent: string;
  extraHtml: string[];
  reactionsHtml: string;
  isAnswer: boolean;
  replyHtml: string;
};

type MessageGroup = {
  author: AuthorProfile;
  messages: RenderedMessage[];
};

const unknownStarterLogged = new Set<string>();

const TEMPLATES_DIR = "templates";
const DEFAULT_AUTHOR_COLOR = "#8b949e";
const GROUP_WINDOW_MS = 10 * 60 * 1000;

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function parseIdList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getConfig(): EnvConfig {
  const publisherRoleIds = parseIdList(requireEnv("PUBLISHER_ROLE_ID"));
  if (publisherRoleIds.length === 0) {
    throw new Error("Missing required env var: PUBLISHER_ROLE_ID");
  }
  return {
    BOT_TOKEN: requireEnv("BOT_TOKEN"),
    GUILD_ID: requireEnv("GUILD_ID"),
    FORUM_CHANNEL_ID: requireEnv("FORUM_CHANNEL_ID"),
    PUBLISHER_ROLE_IDS: publisherRoleIds,
    OUTPUT_DIR: requireEnv("OUTPUT_DIR"),
    BASE_URL: process.env.BASE_URL,
    PUBLISH_EMOJI: requireEnv("PUBLISH_EMOJI"),
    ANSWER_EMOJI: requireEnv("ANSWER_EMOJI"),
    SITE_TITLE: requireEnv("SITE_TITLE"),
    SITE_DESCRIPTION: requireEnv("SITE_DESCRIPTION"),
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toIsoString(date: Date): string {
  return date.toISOString();
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "...";
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/`{1,3}[^`]+`{1,3}/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/[*_~>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGifLinks(text: string): string {
  const tokens = text.split(/(\s+)/);
  const replaced = tokens.map((token) => {
    if (!/^https?:\/\//i.test(token)) return token;
    if (!/\.gif(\?|#|$)/i.test(token)) return token;
    return `![](${token})`;
  });
  return replaced.join("");
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[/\\?%*:|"<>]/g, "-");
  return trimmed || "file";
}

function looksLikeImageFile(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

function looksLikeVideoFile(name: string): boolean {
  return /\.(mp4|webm|mov|m4v)$/i.test(name);
}

function looksLikeAudioFile(name: string): boolean {
  return /\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(name);
}

function applyInlineEmojiSizing(html: string): string {
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

function isDefaultColor(color: string | null | undefined): boolean {
  return !color || color.toLowerCase() === "#000000";
}

function isSameAuthor(a: Message, b: Message): boolean {
  return Boolean(a.author?.id && b.author?.id && a.author.id === b.author.id);
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function deleteDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  await ensureDir(path.dirname(destPath));
  await writeFile(destPath, new Uint8Array(buffer));
}

async function loadTemplates(): Promise<Templates> {
  const index = await readFile(path.join(TEMPLATES_DIR, "index.html"), "utf8");
  const thread = await readFile(path.join(TEMPLATES_DIR, "thread.html"), "utf8");
  return { index, thread };
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key];
    }
    return match;
  });
}

function buildMetaTags(description?: string): {
  descriptionTag: string;
} {
  const descriptionTag = description
    ? `<meta name="description" content="${escapeHtml(description)}">`
    : "";
  return { descriptionTag };
}

function buildIndexMeta(params: {
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

function buildThreadMeta(params: {
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

async function buildThreadTagsHtml(params: {
  thread: ThreadChannel;
  assetsRoot: string;
  assetRelPrefix: string;
  downloaded: Map<string, string>;
}): Promise<string> {
  const { thread, assetsRoot, assetRelPrefix, downloaded } = params;
  if (!thread.parentId || thread.appliedTags.length === 0) return "";
  const parent = await thread.guild.channels
    .fetch(thread.parentId)
    .catch(() => null);
  if (!parent || parent.type !== ChannelType.GuildForum) return "";

  const tagsMap = new Map(parent.availableTags.map((tag) => [tag.id, tag]));
  const parts: string[] = [];
  for (const tagId of thread.appliedTags) {
    const tag = tagsMap.get(tagId);
    if (!tag) continue;
    let iconHtml = "";
    if (tag.emoji?.id) {
      const animated = (tag.emoji as { animated?: boolean }).animated ?? false;
      const ext = animated ? "gif" : "png";
      const url = `https://cdn.discordapp.com/emojis/${tag.emoji.id}.${ext}`;
      const fileName = `tag-${tag.emoji.id}.${ext}`;
      const localRel = await downloadAsset({
        url,
        assetsRoot: path.join(assetsRoot, "tags"),
        assetRelDir: path.join("assets", "tags"),
        fileName,
        downloaded,
      });
      if (localRel) {
        iconHtml = `<img src="${escapeHtml(
          `${assetRelPrefix}${localRel}`,
        )}" alt="" width="16" height="16" loading="lazy" decoding="async">`;
      }
    } else if (tag.emoji?.name) {
      iconHtml = `<span class="tag-emoji">${escapeHtml(tag.emoji.name)}</span>`;
    }
    parts.push(
      `<span class="tag">${iconHtml}${escapeHtml(tag.name)}</span>`,
    );
  }
  if (parts.length === 0) return "";
  return `<div class="tags">${parts.join("")}</div>`;
}

function normalizeReactionEmoji(emojiInput: string): string {
  return emojiInput.trim();
}

function reactionMatches(
  reactionEmoji: { id: string | null; name: string | null },
  target: string,
): boolean {
  if (!target) return false;
  if (reactionEmoji.id && reactionEmoji.id === target) return true;
  if (reactionEmoji.name && reactionEmoji.name === target) return true;
  return false;
}

function isUnknownMessageError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyErr = error as { code?: number; rawError?: { code?: number } };
  return anyErr.code === 10008 || anyErr.rawError?.code === 10008;
}

function logMissingStarterOnce(threadId: string, stage: string): void {
  if (unknownStarterLogged.has(threadId)) return;
  unknownStarterLogged.add(threadId);
  console.warn(
    `[publish-check] starter message missing (${stage}) thread=${threadId}`,
  );
}

function memberHasAnyRole(
  member: GuildMember | null | undefined,
  roleIds: string[],
): boolean {
  if (!member) return false;
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function isPublishableThread(params: {
  thread: ThreadChannel;
  publisherRoleIds: string[];
  publishEmoji: string;
}): Promise<boolean> {
  const { thread, publisherRoleIds, publishEmoji } = params;
  let starterMessage: Message | null = null;
  try {
    starterMessage = await thread.fetchStarterMessage();
  } catch (error) {
    if (isUnknownMessageError(error)) {
      logMissingStarterOnce(thread.id, "fetch");
    } else {
      console.warn(
        `[publish-check] Failed to fetch starter message for thread ${thread.id}`,
        error,
      );
    }
    return false;
  }
  if (!starterMessage) return false;
  try {
    await starterMessage.fetch();
  } catch (error) {
    if (isUnknownMessageError(error)) {
      logMissingStarterOnce(thread.id, "refresh");
    } else {
      console.warn(
        `[publish-check] Failed to refresh starter message for thread ${thread.id}`,
        error,
      );
    }
    return false;
  }
  const targetEmoji = normalizeReactionEmoji(publishEmoji);
  const reaction =
    starterMessage.reactions.cache.find((entry) =>
      reactionMatches(entry.emoji, targetEmoji),
    ) ?? null;
  if (!reaction) return false;

  const users = await reaction.users.fetch();
  for (const user of users.values()) {
    if (user.bot) continue;
    const member = await thread.guild.members
      .fetch(user.id)
      .catch(() => null);
    if (memberHasAnyRole(member, publisherRoleIds)) {
      return true;
    }
  }
  return false;
}

async function fetchAllMessages(thread: ThreadChannel): Promise<Message[]> {
  const messages: Message[] = [];
  let before: string | undefined;
  while (true) {
    const batch = await thread.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.last()?.id;
    if (!before) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return messages;
}

async function readLocalThreadIds(outputDir: string): Promise<string[]> {
  const threadsDir = path.join(outputDir, "threads");
  try {
    const entries = await readdir(threadsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function getThreadOutputDir(outputDir: string, threadId: string): string {
  return path.join(outputDir, "threads", threadId);
}

function getThreadPageRelPath(threadId: string): string {
  return path.join("threads", threadId, "index.html").replace(/\\/g, "/");
}

function getAssetRel(assetRoot: string, fileName: string): string {
  return path.join(assetRoot, fileName).replace(/\\/g, "/");
}

async function downloadAsset(params: {
  url: string;
  assetsRoot: string;
  assetRelDir: string;
  fileName: string;
  downloaded: Map<string, string>;
}): Promise<string | null> {
  const { url, assetsRoot, assetRelDir, fileName, downloaded } = params;
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

async function rewriteInlineImages(params: {
  content: string;
  threadId: string;
  messageId: string;
  assetsRoot: string;
  assetRelPrefix: string;
  downloaded: Map<string, string>;
  images: string[];
}): Promise<string> {
  const { content, threadId, messageId, assetsRoot, assetRelPrefix, downloaded } =
    params;
  const regex = /!\[[^\]]*]\((https?:\/\/[^)]+)\)/g;
  let result = content;
  const matches = [...content.matchAll(regex)];
  for (const match of matches) {
    const url = match[1];
    if (!url) continue;
    const fileName = `${messageId}-inline-${sanitizeFilename(
      path.basename(new URL(url).pathname),
    )}`;
    const localRel = await downloadAsset({
      url,
      assetsRoot: path.join(assetsRoot, threadId),
      assetRelDir: path.join("assets", threadId),
      fileName,
      downloaded,
    });
    const replacement = localRel
      ? match[0].replace(url, `${assetRelPrefix}${localRel}`)
      : match[0];
    if (localRel) {
      params.images.push(localRel);
    }
    result = result.replace(match[0], replacement);
  }
  return result;
}

async function rewriteCustomEmojis(params: {
  content: string;
  assetsRoot: string;
  assetRelPrefix: string;
  downloaded: Map<string, string>;
}): Promise<string> {
  const { content, assetsRoot, assetRelPrefix, downloaded } = params;
  const regex = /<(?<animated>a)?:(?<name>[a-zA-Z0-9_]+):(?<id>\d+)>/g;
  let result = content;
  for (const match of content.matchAll(regex)) {
    const groups = match.groups;
    if (!groups) continue;
    const isAnimated = Boolean(groups.animated);
    const ext = isAnimated ? "gif" : "png";
    const url = `https://cdn.discordapp.com/emojis/${groups.id}.${ext}`;
    const fileName = `emoji-${groups.id}.${ext}`;
    const localRel = await downloadAsset({
      url,
      assetsRoot: path.join(assetsRoot, "emojis"),
      assetRelDir: path.join("assets", "emojis"),
      fileName,
      downloaded,
    });
    if (localRel) {
      const replacement = `![:${groups.name}](${assetRelPrefix}${localRel})`;
      result = result.replace(match[0], replacement);
    }
  }
  return result;
}

async function buildReactionsHtml(params: {
  message: Message;
  assetsRoot: string;
  assetRelPrefix: string;
  downloaded: Map<string, string>;
  excludeEmojis: string[];
}): Promise<string> {
  const { message, assetsRoot, assetRelPrefix, downloaded, excludeEmojis } = params;
  if (message.reactions.cache.size === 0) return "";
  const parts: string[] = [];
  for (const reaction of message.reactions.cache.values()) {
    const count = reaction.count ?? 0;
    if (count <= 0) continue;
    if (
      excludeEmojis.some((emoji) => reactionMatches(reaction.emoji, emoji))
    ) {
      continue;
    }
    const emoji = reaction.emoji;
    if (emoji.id) {
      const ext = emoji.animated ? "gif" : "png";
      const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}`;
      const fileName = `emoji-${emoji.id}.${ext}`;
      const localRel = await downloadAsset({
        url,
        assetsRoot: path.join(assetsRoot, "emojis"),
        assetRelDir: path.join("assets", "emojis"),
        fileName,
        downloaded,
      });
      if (localRel) {
        parts.push(
          `<span class="reaction"><img src="${escapeHtml(
            `${assetRelPrefix}${localRel}`,
          )}" alt="${escapeHtml(
            emoji.name ?? "emoji",
          )}" width="18" height="18" loading="lazy" decoding="async"><em>${count}</em></span>`,
        );
      } else if (emoji.name) {
        parts.push(
          `<span class="reaction"><span class="emoji">${escapeHtml(
            emoji.name,
          )}</span><em>${count}</em></span>`,
        );
      }
    } else if (emoji.name) {
      parts.push(
        `<span class="reaction"><span class="emoji">${escapeHtml(
          emoji.name,
        )}</span><em>${count}</em></span>`,
      );
    }
  }
  if (parts.length === 0) return "";
  return `<div class="reactions">${parts.join("")}</div>`;
}

async function buildMentionMap(
  message: Message,
  memberCache: Map<string, GuildMember | null>,
): Promise<Map<string, MentionInfo>> {
  const map = new Map<string, MentionInfo>();
  for (const user of message.mentions.users.values()) {
    let member = message.mentions.members?.get(user.id) ?? null;
    if (!memberCache.has(user.id)) {
      member = await message.guild?.members.fetch(user.id).catch(() => null);
      memberCache.set(user.id, member ?? null);
    } else {
      member = memberCache.get(user.id) ?? null;
    }
    const name = member?.displayName ?? user.username ?? user.tag ?? "Unknown";
    const color = isDefaultColor(member?.displayHexColor)
      ? DEFAULT_AUTHOR_COLOR
      : member?.displayHexColor ?? DEFAULT_AUTHOR_COLOR;
    map.set(user.id, { name, color });
  }
  return map;
}

function replaceMentionsWithTokens(params: {
  text: string;
  mentionMap: Map<string, MentionInfo>;
}): { text: string; tokens: Map<string, string> } {
  const { text, mentionMap } = params;
  let result = text;
  const tokens = new Map<string, string>();
  for (const [id, info] of mentionMap.entries()) {
    const token = `@@MENTION:${id}@@`;
    const html = `<span class="mention" style="color: ${escapeHtml(
      info.color,
    )}">@${escapeHtml(info.name)}</span>`;
    tokens.set(token, html);
    result = result.replace(new RegExp(`<@!?${id}>`, "g"), token);
  }
  return { text: result, tokens };
}

function applyMentionTokens(html: string, tokens: Map<string, string>): string {
  let result = html;
  for (const [token, value] of tokens.entries()) {
    result = result.split(token).join(value);
  }
  return result;
}

function replaceMentionsPlain(params: {
  text: string;
  mentionMap: Map<string, MentionInfo>;
}): string {
  let result = params.text;
  for (const [id, info] of params.mentionMap.entries()) {
    result = result.replace(new RegExp(`<@!?${id}>`, "g"), `@${info.name}`);
  }
  return result;
}

async function collectMessageAssets(params: {
  message: Message;
  threadId: string;
  assetsRoot: string;
  assetRelPrefix: string;
  downloaded: Map<string, string>;
  mentionMap: Map<string, MentionInfo>;
}): Promise<AssetResult> {
  const {
    message,
    threadId,
    assetsRoot,
    assetRelPrefix,
    downloaded,
    mentionMap,
  } =
    params;
  const images: string[] = [];
  let markdown = message.content ?? "";
  markdown = markdown.replace(/(^|\n)\s*(\d+)\)\s+/g, "$1$2\\) ");
  markdown = normalizeGifLinks(markdown);
  const replaced = replaceMentionsWithTokens({ text: markdown, mentionMap });
  markdown = replaced.text;
  markdown = await rewriteCustomEmojis({
    content: markdown,
    assetsRoot,
    assetRelPrefix,
    downloaded,
  });
  markdown = await rewriteInlineImages({
    content: markdown,
    threadId,
    messageId: message.id,
    assetsRoot,
    assetRelPrefix,
    downloaded,
    images,
  });

  const extraHtml: string[] = [];

  for (const attachment of message.attachments.values()) {
    const url = attachment.url;
    const safeName = sanitizeFilename(attachment.name ?? path.basename(url));
    const fileName = `${message.id}-${safeName}`;
    const localRel = await downloadAsset({
      url,
      assetsRoot: path.join(assetsRoot, threadId),
      assetRelDir: path.join("assets", threadId),
      fileName,
      downloaded,
    });
    const link = localRel ? `${assetRelPrefix}${localRel}` : url;
    const isImage =
      attachment.contentType?.startsWith("image/") || looksLikeImageFile(url);
    const isGif =
      attachment.contentType === "image/gif" ||
      /\.gif$/i.test(url) ||
      /\.gif$/i.test(attachment.name ?? "");
    const isVideo =
      attachment.contentType?.startsWith("video/") || looksLikeVideoFile(url);
    const isAudio =
      attachment.contentType?.startsWith("audio/") || looksLikeAudioFile(url);

    if (isVideo) {
      extraHtml.push(
        `<video controls preload="none"><source src="${escapeHtml(
          link,
        )}"></video>`,
      );
      continue;
    }
    if (isAudio) {
      extraHtml.push(
        `<audio controls preload="none" src="${escapeHtml(link)}"></audio>`,
      );
      continue;
    }

    if (isImage || isGif) {
      images.push(localRel ?? url);
      markdown += `\n\n![${attachment.name ?? "image"}](${link})`;
      continue;
    }

    markdown += `\n\n[${attachment.name ?? "file"}](${link})`;
  }

  for (const embed of message.embeds.values()) {
    const embedUrl = embed.image?.url ?? embed.thumbnail?.url;
    if (!embedUrl) continue;
    const fileName = `${message.id}-embed-${sanitizeFilename(
      path.basename(new URL(embedUrl).pathname),
    )}`;
    const localRel = await downloadAsset({
      url: embedUrl,
      assetsRoot: path.join(assetsRoot, threadId),
      assetRelDir: path.join("assets", threadId),
      fileName,
      downloaded,
    });
    images.push(localRel ?? embedUrl);
    const link = localRel ? `${assetRelPrefix}${localRel}` : embedUrl;
    markdown += `\n\n![embed](${link})`;
  }

  return { markdown, extraHtml, imageRels: images, mentionTokens: replaced.tokens };
}

async function getAuthorProfile(params: {
  message: Message;
  assetsRoot: string;
  assetRelPrefix: string;
  avatarCache: Map<string, string>;
  roleIconCache: Map<string, string>;
  memberCache: Map<string, GuildMember | null>;
  downloaded: Map<string, string>;
}): Promise<AuthorProfile> {
  const {
    message,
    assetsRoot,
    assetRelPrefix,
    avatarCache,
    roleIconCache,
    memberCache,
    downloaded,
  } = params;
  const user = message.author;
  if (!user) {
    return {
      name: "Unknown",
      color: DEFAULT_AUTHOR_COLOR,
      avatarRel: null,
      roleIconRel: null,
    };
  }

  let member = message.member ?? null;
  if (!memberCache.has(user.id)) {
    member = await message.guild?.members.fetch(user.id).catch(() => null);
    memberCache.set(user.id, member ?? null);
  } else {
    member = memberCache.get(user.id) ?? null;
  }

  const name = member?.displayName ?? user.username ?? user.tag ?? "Unknown";
  const color = isDefaultColor(member?.displayHexColor)
    ? DEFAULT_AUTHOR_COLOR
    : member?.displayHexColor ?? DEFAULT_AUTHOR_COLOR;

  let avatarRel: string | null = null;
  const avatarUrl =
    member?.displayAvatarURL({ extension: "png", size: 128 }) ??
    user.displayAvatarURL({ extension: "png", size: 128 });
  if (avatarUrl) {
    const cached = avatarCache.get(user.id);
    if (cached) {
      avatarRel = cached;
    } else {
      const fileName = `avatar-${user.id}.png`;
      const rel = await downloadAsset({
        url: avatarUrl,
        assetsRoot: path.join(assetsRoot, "avatars"),
        assetRelDir: path.join("assets", "avatars"),
        fileName,
        downloaded,
      });
      if (rel) {
        avatarCache.set(user.id, rel);
        avatarRel = rel;
      }
    }
  }

  let roleIconRel: string | null = null;
  const roles = member?.roles?.cache ?? null;
  if (roles) {
    const sorted = Array.from(roles.values()).sort(
      (a, b) => b.position - a.position,
    );
    const roleWithIcon = sorted.find((role) => Boolean(role.icon));
    if (roleWithIcon) {
      const cached = roleIconCache.get(roleWithIcon.id);
      if (cached) {
        roleIconRel = cached;
      } else {
        const iconUrl = roleWithIcon.iconURL({ extension: "png", size: 64 });
        if (iconUrl) {
          const fileName = `role-${roleWithIcon.id}.png`;
          const rel = await downloadAsset({
            url: iconUrl,
            assetsRoot: path.join(assetsRoot, "roles"),
            assetRelDir: path.join("assets", "roles"),
            fileName,
            downloaded,
          });
          if (rel) {
            roleIconCache.set(roleWithIcon.id, rel);
            roleIconRel = rel;
          }
        }
      }
    }
  }

  return { name, color, avatarRel, roleIconRel };
}

async function isAnswerMessage(params: {
  message: Message;
  publisherRoleIds: string[];
  answerEmoji: string;
  memberCache: Map<string, GuildMember | null>;
}): Promise<boolean> {
  const { message, publisherRoleIds, answerEmoji, memberCache } = params;
  const reaction =
    message.reactions.cache.find((entry) =>
      reactionMatches(entry.emoji, answerEmoji),
    ) ?? null;
  if (!reaction) return false;
  const users = await reaction.users.fetch();
  for (const user of users.values()) {
    if (user.bot) continue;
    let member = memberCache.get(user.id) ?? null;
    if (!memberCache.has(user.id)) {
      member = await message.guild?.members.fetch(user.id).catch(() => null);
      memberCache.set(user.id, member ?? null);
    }
      if (memberHasAnyRole(member, publisherRoleIds)) {
        return true;
      }
  }
  return false;
}

function renderGroupHtml(params: {
  author: AuthorProfile;
  assetRelPrefix: string;
  messages: RenderedMessage[];
}): string {
  const { author, assetRelPrefix, messages } = params;
  const firstMessage = messages[0];
  const groupTime = firstMessage?.createdAt ?? new Date();
  const avatarHtml = author.avatarRel
    ? `<img src="${escapeHtml(
        `${assetRelPrefix}${author.avatarRel}`,
      )}" alt="${escapeHtml(
        author.name,
      )}" width="48" height="48" loading="lazy" decoding="async">`
    : "";
  const items = messages
    .map((entry) => {
      const answerBadge = entry.isAnswer ? `<span class="badge">Ответ</span>` : "";
      const body = [entry.replyHtml, entry.htmlContent, ...entry.extraHtml]
        .filter(Boolean)
        .join("\n");
      return `<div id="m-${escapeHtml(entry.messageId)}" class="message" data-answer="${
        entry.isAnswer ? "true" : "false"
      }">
  <div class="meta">${answerBadge}</div>
  <div class="body">
${body}
  </div>
  ${entry.reactionsHtml}
</div>`;
    })
    .join("\n");
  const roleIconHtml = author.roleIconRel
    ? `<img class="role-icon" src="${escapeHtml(
        `${assetRelPrefix}${author.roleIconRel}`,
      )}" alt="" width="18" height="18" loading="lazy" decoding="async">`
    : "";
  return `<article class="group">
  <header>
    ${avatarHtml}
    <div>
      <h3 style="color: ${escapeHtml(author.color)}">${escapeHtml(
        author.name,
      )}${roleIconHtml}</h3>
      <time datetime="${toIsoString(groupTime)}">${escapeHtml(
        groupTime.toLocaleString("ru-RU"),
      )}</time>
    </div>
  </header>
  <section>
${items}
  </section>
</article>`;
}

async function buildThreadPage(params: {
  thread: ThreadChannel;
  messages: Message[];
  outputDir: string;
  baseUrl?: string;
  templates: Templates;
  publisherRoleIds: string[];
  answerEmoji: string;
  publishEmoji: string;
  siteTitle: string;
}): Promise<PageMeta> {
  const {
    thread,
    messages,
    outputDir,
    baseUrl,
    templates,
    publisherRoleIds,
    answerEmoji,
    publishEmoji,
    siteTitle,
  } = params;
  const pageRelPath = getThreadPageRelPath(thread.id);
  const pagePath = path.join(outputDir, pageRelPath);
  await ensureDir(path.dirname(pagePath));
  await ensureStyleAsset(outputDir);

  const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
  const defaultImage =
    markdown.renderer.rules.image ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  const defaultLinkOpen =
    markdown.renderer.rules.link_open ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  markdown.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const alt = token.content ?? "";
    if (alt.startsWith(":")) {
      token.attrSet("class", "inline-emoji");
      token.attrSet("width", "30");
      token.attrSet("height", "30");
      token.attrSet("loading", "lazy");
      token.attrSet("decoding", "async");
    }
    return defaultImage(tokens, idx, options, env, self);
  };
  markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener");
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };
  markdown.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src") ?? "";
    const alt = token.content ?? token.attrGet("alt") ?? "";
    const title = token.attrGet("title");
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(
      alt,
    )}"${titleAttr} loading="lazy" decoding="async">`;
    return `<a href="${escapeHtml(
      src,
    )}" target="_blank" rel="noopener">${img}</a>`;
  };
  const assetsRoot = path.join(outputDir, "assets");
  const assetRelPrefix = "../../";
  const downloaded = new Map<string, string>();
  const avatarCache = new Map<string, string>();
  const roleIconCache = new Map<string, string>();
  const memberCache = new Map<string, GuildMember | null>();

  const renderedGroups: string[] = [];
  const imageCandidates: string[] = [];
  const groups: MessageGroup[] = [];

  const messageById = new Map<string, Message>();
  for (const message of messages) {
    messageById.set(message.id, message);
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const mentionMap = await buildMentionMap(message, memberCache);
    const { markdown: messageMarkdown, extraHtml, imageRels, mentionTokens } =
      await collectMessageAssets({
        message,
        threadId: thread.id,
        assetsRoot,
        assetRelPrefix,
        downloaded,
        mentionMap,
      });
    if (imageRels.length > 0) {
      imageCandidates.push(...imageRels);
    }
    let htmlContent = markdown.render(messageMarkdown);
    htmlContent = applyMentionTokens(htmlContent, mentionTokens);
    htmlContent = applyInlineEmojiSizing(htmlContent);
    const author = await getAuthorProfile({
      message,
      assetsRoot,
      assetRelPrefix,
      avatarCache,
      roleIconCache,
      memberCache,
      downloaded,
    });
      const isAnswer = await isAnswerMessage({
        message,
        publisherRoleIds,
        answerEmoji,
        memberCache,
      });
      const reactionsHtml = await buildReactionsHtml({
        message,
        assetsRoot,
        assetRelPrefix,
        downloaded,
        excludeEmojis: [publishEmoji, answerEmoji],
      });

    const replyHtml = await buildReplyHtml({
      message,
      messageById,
      memberCache,
    });

    const rendered: RenderedMessage = {
      messageId: message.id,
      createdAt: message.createdAt ?? new Date(),
      htmlContent,
      extraHtml,
      reactionsHtml,
      isAnswer,
      replyHtml,
    };

    const lastGroup = groups[groups.length - 1];
    const lastMessage = lastGroup?.messages[lastGroup.messages.length - 1];
    const prevMessage = index > 0 ? messages[index - 1] : null;
    const canGroup =
      lastGroup &&
      lastMessage &&
      prevMessage &&
      isSameAuthor(message, prevMessage) &&
      Math.abs(rendered.createdAt.getTime() - lastMessage.createdAt.getTime()) <=
        GROUP_WINDOW_MS;
    if (canGroup) {
      lastGroup.messages.push(rendered);
    } else {
      groups.push({
        author,
        messages: [rendered],
      });
    }
  }

  for (const group of groups) {
    renderedGroups.push(
      renderGroupHtml({
        author: group.author,
        assetRelPrefix,
        messages: group.messages,
      }),
    );
  }

  const starter = messages[0];
  const starterText = starter?.content ?? "";
  const excerpt = truncateText(stripMarkdown(starterText), 180);
  const createdAt = thread.createdAt ?? new Date();
  const ogImage =
    baseUrl && imageCandidates.length > 0
      ? new URL(imageCandidates[0], baseUrl).toString()
      : undefined;
  const tagsHtml = await buildThreadTagsHtml({
    thread,
    assetsRoot,
    assetRelPrefix,
    downloaded,
  });

  const threadDescription = `${excerpt} (VRChat, врчат, вр чат, vr, вр)`;
  const { descriptionTag } = buildMetaTags(threadDescription);
  const { metaExtra } = buildThreadMeta({
    title: thread.name,
    description: threadDescription,
    ogImage,
  });

  const html = renderTemplate(templates.thread, {
    title: escapeHtml(thread.name),
    thread_title: escapeHtml(thread.name),
    site_title: escapeHtml(siteTitle),
    thread_tags: tagsHtml,
    description_tag: descriptionTag,
    meta_extra: metaExtra,
    messages: renderedGroups.join("\n"),
    discord_url: thread.url,
    discord_button_text: "Открыть в Discord",
    updated_at: escapeHtml(formatDateTime(new Date())),
    style_href: "../../assets/style.css",
  });

  await writeFile(pagePath, html, "utf8");
  await writeFile(
    path.join(getThreadOutputDir(outputDir, thread.id), "meta.json"),
    JSON.stringify(
      {
        threadId: thread.id,
        title: thread.name,
        createdAt: createdAt.toISOString(),
        excerpt,
        pageRelPath,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    threadId: thread.id,
    title: thread.name,
    createdAt,
    excerpt,
    pageRelPath,
  };
}

async function deleteThreadOutput(outputDir: string, threadId: string): Promise<void> {
  await deleteDir(getThreadOutputDir(outputDir, threadId));
  await deleteDir(path.join(outputDir, "assets", threadId));
}

async function buildIndexPage(params: {
  outputDir: string;
  items: PageMeta[];
  templates: Templates;
  siteTitle: string;
  siteDescription: string;
}): Promise<void> {
  await ensureStyleAsset(params.outputDir);
  const items = params.items
    .slice()
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
}

function isStarterMessage(message: Message): boolean {
  const channel = message.channel;
  return channel?.isThread?.() && message.id === channel.id;
}

function createSerialQueue() {
  let chain = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    chain = chain.then(task, task);
    return chain as Promise<T>;
  };
}

async function getLogChannel(client: Client, logChannelId?: string) {
  if (!logChannelId) return null;
  const channel = await client.channels.fetch(logChannelId).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

async function sendLogMessage(
  client: Client,
  logChannelId: string | undefined,
  content: string,
) {
  const channel = await getLogChannel(client, logChannelId);
  if (!channel) return;
  await channel.send({ content, allowedMentions: { users: [] } });
}

async function sendActorMessage(user: User | undefined, content: string) {
  if (!user) return;
  await user.send({ content, allowedMentions: { users: [] } }).catch(() => null);
}

async function buildReplyHtml(params: {
  message: Message;
  messageById: Map<string, Message>;
  memberCache: Map<string, GuildMember | null>;
}): Promise<string> {
  const { message, messageById, memberCache } = params;
  const refId = message.reference?.messageId ?? null;
  if (!refId) return "";
  const referenced = messageById.get(refId);
  if (!referenced) return "";
  const mentionMap = await buildMentionMap(referenced, memberCache);
  let member = referenced.member ?? null;
  const authorId = referenced.author?.id ?? null;
  if (authorId) {
    if (!memberCache.has(authorId)) {
      member = await referenced.guild?.members.fetch(authorId).catch(() => null);
      memberCache.set(authorId, member ?? null);
    } else {
      member = memberCache.get(authorId) ?? null;
    }
  }
  const author =
    member?.displayName ??
    referenced.author?.username ??
    referenced.author?.tag ??
    "Unknown";
  const color = isDefaultColor(member?.displayHexColor)
    ? DEFAULT_AUTHOR_COLOR
    : member?.displayHexColor ?? DEFAULT_AUTHOR_COLOR;
  const plainText = stripMarkdown(referenced.content ?? "");
  const cleanText = truncateText(
    replaceMentionsPlain({ text: plainText, mentionMap }),
    80,
  );
  if (!cleanText) return "";
  return `<div class="reply">
  <span>Ответ на <a href="#m-${escapeHtml(refId)}" style="color: ${escapeHtml(
    color,
  )}">${escapeHtml(author)}</a></span>
  <p>${escapeHtml(cleanText)}</p>
</div>`;
}

async function ensureStyleAsset(outputDir: string): Promise<void> {
  const sourcePath = path.join(TEMPLATES_DIR, "style.css");
  const style = await readFile(sourcePath, "utf8");
  const targetDir = path.join(outputDir, "assets");
  await ensureDir(targetDir);
  await writeFile(path.join(targetDir, "style.css"), style, "utf8");
}

async function ensureRobotsAsset(outputDir: string): Promise<void> {
  const sourcePath = path.join(TEMPLATES_DIR, "robots.txt");
  let robots: string;
  try {
    robots = await readFile(sourcePath, "utf8");
  } catch {
    return;
  }
  const targetPath = path.join(outputDir, "robots.txt");
  try {
    await access(targetPath, constants.F_OK);
    return;
  } catch {
    // Not present, write it.
  }
  await writeFile(targetPath, robots, "utf8");
}

async function readLocalMeta(outputDir: string): Promise<PageMeta[]> {
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

async function run(): Promise<void> {
  const config = getConfig();
  await ensureDir(config.OUTPUT_DIR);
  const templates = await loadTemplates();
  await ensureStyleAsset(config.OUTPUT_DIR);
  await ensureRobotsAsset(config.OUTPUT_DIR);
  console.log("Output:", config.OUTPUT_DIR);
  const runRebuild = hasArg("--rebuild");

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  });

  const queue = createSerialQueue();
  const pageIndex = new Map<string, PageMeta>();
  const localMeta = await readLocalMeta(config.OUTPUT_DIR);
  for (const item of localMeta) {
    pageIndex.set(item.threadId, item);
  }
  if (localMeta.length > 0) {
    await buildIndexPage({
      outputDir: config.OUTPUT_DIR,
      items: Array.from(pageIndex.values()),
      templates,
      siteTitle: config.SITE_TITLE,
      siteDescription: config.SITE_DESCRIPTION,
    });
    console.log("Index rebuilt from local meta:", localMeta.length);
  }
  let rebuildTimer: NodeJS.Timeout | null = null;

  const scheduleIndexRebuild = () => {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      queue(async () => {
        await buildIndexPage({
          outputDir: config.OUTPUT_DIR,
          items: Array.from(pageIndex.values()),
          templates,
          siteTitle: config.SITE_TITLE,
          siteDescription: config.SITE_DESCRIPTION,
        });
        console.log("Index updated.");
      });
    }, 200);
  };

  const generateThread = async (
    thread: ThreadChannel,
    actor?: { id: string; tag: string; user?: User },
    log = true,
  ) => {
    console.log("Generate thread:", thread.id);
    try {
      const messages = await fetchAllMessages(thread);
      if (messages.length === 0) {
        console.warn("Thread has no messages:", thread.id);
        return;
      }
      const pageInfo = await buildThreadPage({
        thread,
        messages,
        outputDir: config.OUTPUT_DIR,
        baseUrl: config.BASE_URL,
        templates,
        publisherRoleIds: config.PUBLISHER_ROLE_IDS,
        answerEmoji: config.ANSWER_EMOJI,
        publishEmoji: config.PUBLISH_EMOJI,
        siteTitle: config.SITE_TITLE,
      });
      pageIndex.set(thread.id, pageInfo);
      console.log("Thread generated:", thread.id);
      if (log) {
        const pageUrl = config.BASE_URL
          ? new URL(pageInfo.pageRelPath, config.BASE_URL).toString()
          : null;
        const pageLine = pageUrl ? `- [Открыть на сайте](${pageUrl})` : null;
        const messageLine = `- [Открыть в Discord](${thread.url})`;
        const actorLine = actor ? `- Добавил <@${actor.id}>` : null;
        const lines = [
          "**Страница сгенерирована ✅**",
          `- "${thread.name}"`,
          pageLine,
          messageLine,
          actorLine,
        ].filter(Boolean);
        const content = lines.join("\n");
        await sendLogMessage(client, config.LOG_CHANNEL_ID, content);
        await sendActorMessage(actor?.user, content);
      }
      scheduleIndexRebuild();
    } catch (error) {
      console.error("[thread] generate failed", thread.id, error);
    }
  };

  const removeThread = async (
    thread: ThreadChannel | { id: string; url?: string },
    actor?: { id: string; tag: string; user?: User },
    log = true,
  ) => {
    console.log("Thread removed:", thread.id);
    await deleteThreadOutput(config.OUTPUT_DIR, thread.id);
    pageIndex.delete(thread.id);
    if (log) {
      const threadTitle = "name" in thread ? thread.name : thread.id;
      const actorLine = actor ? `- Удалил <@${actor.id}>` : null;
      const threadLine = thread.url
        ? `- [Открыть в Discord](${thread.url})`
        : null;
      const lines = [
        "**Страница удалена 🗑️**",
        `- "${threadTitle}"`,
        threadLine,
        actorLine,
      ].filter(Boolean);
      const content = lines.join("\n");
      await sendLogMessage(client, config.LOG_CHANNEL_ID, content);
      await sendActorMessage(actor?.user, content);
    }
    scheduleIndexRebuild();
  };

  const syncAll = async (forumChannel: ThreadChannel["parent"]) => {
    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return;
    console.log("Rebuild all threads.");
    await sendLogMessage(
      client,
      config.LOG_CHANNEL_ID,
      "Запущена перегенерация всех страниц.",
    );
    const threadIds = await readLocalThreadIds(config.OUTPUT_DIR);
    for (const threadId of threadIds) {
      const thread = await forumChannel.threads
        .fetch(threadId)
        .catch(() => null);
      if (!thread) {
        console.warn("Thread not found:", threadId);
        continue;
      }
      await generateThread(thread, undefined, false);
    }
    console.log(`Rebuild done. threads=${threadIds.length}`);
  };

  const handleReady = async () => {
    try {
      console.log("Connected to Discord.");
      const guild = await client.guilds.fetch(config.GUILD_ID);
      const channel = await guild.channels.fetch(config.FORUM_CHANNEL_ID);
      if (!channel || channel.type !== ChannelType.GuildForum) {
        throw new Error("Forum channel not found or not a forum channel.");
      }
      console.log("Forum loaded:", channel.id);
      if (runRebuild) {
        await syncAll(channel);
      }
      console.log("Waiting for publish reactions.");
      await sendLogMessage(
        client,
        config.LOG_CHANNEL_ID,
        "Создатель страниц для help.vrcru.org запущен.",
      );
    } catch (error) {
      console.error(error);
    }
  };
  client.once("clientReady", handleReady);

  const handleReactionChange = async (
    thread: ThreadChannel,
    actor?: { id: string; tag: string; user?: User },
  ) => {
    try {
      const shouldPublish = await isPublishableThread({
        thread,
        publisherRoleIds: config.PUBLISHER_ROLE_IDS,
        publishEmoji: config.PUBLISH_EMOJI,
      });
      if (shouldPublish) {
        await generateThread(thread, actor);
        return;
      }
      await removeThread(thread, actor);
    } catch (error) {
      console.error("[reaction] publish check failed", thread.id, error);
    }
  };

  client.on("messageReactionAdd", async (reaction, user) => {
    let message: Message | null = null;
    try {
      message = reaction.message.partial
        ? await reaction.message.fetch()
        : reaction.message;
    } catch (error) {
      console.warn("Reaction add: failed to fetch message.", error);
      return;
    }
    if (!message) return;
    if (!isStarterMessage(message)) return;
    const thread = message.channel as ThreadChannel;
    if (thread.parentId !== config.FORUM_CHANNEL_ID) return;
    if (!reactionMatches(reaction.emoji, config.PUBLISH_EMOJI)) return;
    if (user.bot) return;
    const member = await thread.guild.members.fetch(user.id).catch(() => null);
    if (!memberHasAnyRole(member, config.PUBLISHER_ROLE_IDS)) {
      return;
    }
    const actor = { id: user.id, tag: user.tag, user };
    await queue(async () => {
      await handleReactionChange(thread, actor);
    });
  });

  client.on("messageReactionRemove", async (reaction, user) => {
    let message: Message | null = null;
    try {
      message = reaction.message.partial
        ? await reaction.message.fetch()
        : reaction.message;
    } catch (error) {
      console.warn("Reaction remove: failed to fetch message.", error);
      return;
    }
    if (!message) return;
    if (!isStarterMessage(message)) return;
    const thread = message.channel as ThreadChannel;
    if (thread.parentId !== config.FORUM_CHANNEL_ID) return;
    if (!reactionMatches(reaction.emoji, config.PUBLISH_EMOJI)) return;
    if (user.bot) return;
    const member = await thread.guild.members.fetch(user.id).catch(() => null);
    if (!memberHasAnyRole(member, config.PUBLISHER_ROLE_IDS)) {
      return;
    }
    const actor = { id: user.id, tag: user.tag, user };
    await queue(async () => {
      await handleReactionChange(thread, actor);
    });
  });

  await client.login(config.BOT_TOKEN);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});


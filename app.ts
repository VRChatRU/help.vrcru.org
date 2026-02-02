import { writeFile, readFile, access } from "node:fs/promises";
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
// Bun.markdown встроен в Bun runtime, импорт не нужен

// Импорты новых модулей
import type { EnvConfig, PageMeta, Templates, AuthorProfile, MentionInfo, AssetResult, RenderedMessage, MessageGroup } from './src/types';
import { RateLimitedAPI } from './src/discord/api';
import { getConfig, hasArg, TEMPLATES_DIR, DEFAULT_AUTHOR_COLOR, GROUP_WINDOW_MS } from './src/config';
import {
  escapeHtml,
  toIsoString,
  formatDateTime,
  truncateText,
  stripMarkdown,
  normalizeGifLinks,
  sanitizeFilename,
  looksLikeImageFile,
  looksLikeVideoFile,
  looksLikeAudioFile,
  applyInlineEmojiSizing,
  isDefaultColor,
  isSameAuthor
} from './src/utils/text';
import { ensureDir, deleteDir, downloadToFile, getThreadOutputDir, getThreadPageRelPath, getAssetRel, downloadAsset } from './src/utils/assets';
import {
  unknownStarterLogged,
  normalizeReactionEmoji,
  reactionMatches,
  isUnknownMessageError,
  logMissingStarterOnce,
  memberHasAnyRole,
  isPublishableThread,
  isAnswerMessage
} from './src/discord/permissions';
import { loadTemplates, renderTemplate, buildMetaTags, buildIndexMeta, buildThreadMeta, buildIndexPage, readLocalMeta } from './src/render/pages';

// Удалённые функции теперь импортируются из модулей

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

  const reactionPromises = Array.from(message.reactions.cache.values())
    .filter(reaction => {
      const count = reaction.count ?? 0;
      if (count <= 0) return false;
      return !excludeEmojis.some(emoji => reactionMatches(reaction.emoji, emoji));
    })
    .map(async (reaction) => {
      const count = reaction.count ?? 0;
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
          return `<span class="reaction"><img src="${escapeHtml(
            `${assetRelPrefix}${localRel}`,
          )}" alt="${escapeHtml(
            emoji.name ?? "emoji",
          )}" width="18" height="18" loading="lazy" decoding="async"><em>${count}</em></span>`;
        } else if (emoji.name) {
          return `<span class="reaction"><span class="emoji">${escapeHtml(
            emoji.name,
          )}</span><em>${count}</em></span>`;
        }
      } else if (emoji.name) {
        return `<span class="reaction"><span class="emoji">${escapeHtml(
          emoji.name,
        )}</span><em>${count}</em></span>`;
      }
      return "";
    });

  const parts = (await Promise.all(reactionPromises)).filter(Boolean);
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

// Обрабатывает и группирует сообщения треда
async function processAndGroupMessages(params: {
  messages: Message[];
  thread: ThreadChannel;
  assetsRoot: string;
  assetRelPrefix: string;
  publisherRoleIds: string[];
  answerEmoji: string;
  publishEmoji: string;
  rateLimiter: RateLimitedAPI;
}): Promise<{
  renderedGroups: string[];
  imageCandidates: string[];
  downloaded: Map<string, string>;
}> {
  const {
    messages,
    thread,
    assetsRoot,
    assetRelPrefix,
    publisherRoleIds,
    answerEmoji,
    publishEmoji,
    rateLimiter,
  } = params;

  const downloaded = new Map<string, string>();
  const avatarCache = new Map<string, string>();
  const roleIconCache = new Map<string, string>();
  const memberCache = new Map<string, GuildMember | null>();

  const imageCandidates: string[] = [];
  const groups: MessageGroup[] = [];

  const messageById = new Map<string, Message>();
  for (const message of messages) {
    messageById.set(message.id, message);
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const mentionMap = await buildMentionMap(message, memberCache);
    const { markdown: rawMarkdown, extraHtml, imageRels, mentionTokens } =
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

    // Pre-process markdown для корректной работы с code blocks
    const messageMarkdown = preprocessMarkdown(rawMarkdown);

    let htmlContent = Bun.markdown.html(messageMarkdown, {
      tables: true,
      strikethrough: true,
      tasklists: true,
      permissiveAutolinks: true,
    });
    htmlContent = postProcessMarkdownHtml(htmlContent);
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
      rateLimiter,
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

  const renderedGroups: string[] = [];
  for (const group of groups) {
    renderedGroups.push(
      renderGroupHtml({
        author: group.author,
        assetRelPrefix,
        messages: group.messages,
      }),
    );
  }

  return { renderedGroups, imageCandidates, downloaded };
}

// Настраивает markdown renderer с custom правилами для изображений и ссылок
// Pre-process markdown для корректной работы с code blocks
function preprocessMarkdown(markdown: string): string {
  // Исправляем проблемы с code blocks для корректного парсинга

  // 1. Исправить ```{ -> ```\n{ (когда код начинается с не-буквы)
  // Language identifiers это только буквы, поэтому если после ``` идёт не-буква - это код
  markdown = markdown.replace(/```([^a-z\n\s])/gi, '```\n$1');

  // 2. Добавить \n перед закрывающим ``` (если это не начало строки)
  markdown = markdown.replace(/([^\n])(```)(\n|$)/g, '$1\n$2$3');

  // 3. Убедиться что вокруг code blocks есть пустые строки
  // Перед открывающим ```
  markdown = markdown.replace(/([^\n])\n(```[a-z]*\n)/gi, '$1\n\n$2');

  // После закрывающего ```
  markdown = markdown.replace(/(```)\n([^\n])/g, '$1\n\n$2');

  // 4. Очистить избыточные пустые строки (3+ подряд)
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  return markdown.trim();
}

// Post-process HTML для применения кастомных правил
function postProcessMarkdownHtml(html: string): string {
  // Добавить target="_blank" к внешним ссылкам
  html = html.replace(
    /<a href="(https?:\/\/[^"]+)"([^>]*)>/gi,
    (match, href, rest) => {
      // Проверяем, нет ли уже target="_blank"
      if (rest.includes('target=')) return match;
      return `<a href="${href}"${rest} target="_blank" rel="noopener">`;
    }
  );

  // Обернуть изображения в ссылки (если ещё не обёрнуты)
  html = html.replace(
    /<img src="([^"]+)" alt="([^"]*)"([^>]*)>/g,
    (match, src, alt, rest) => {
      // Inline emoji определяются по alt text (начинается с ":")
      if (alt.startsWith(':')) {
        // Добавить класс и размеры для inline emoji
        if (!rest.includes('class=')) {
          return `<img src="${src}" alt="${alt}"${rest} class="inline-emoji" width="30" height="30" loading="lazy" decoding="async">`;
        }
        return match;
      }

      // Обычные изображения - обернуть в ссылку
      const img = `<img src="${src}" alt="${alt}"${rest} loading="lazy" decoding="async">`;
      return `<a href="${src}" target="_blank" rel="noopener">${img}</a>`;
    }
  );

  return html;
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
  rateLimiter: RateLimitedAPI;
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
    rateLimiter,
    siteTitle,
  } = params;
  const pageRelPath = getThreadPageRelPath(thread.id);
  const pagePath = path.join(outputDir, pageRelPath);
  await ensureDir(path.dirname(pagePath));

  // Настроить assets пути
  const assetsRoot = path.join(outputDir, "assets");
  const assetRelPrefix = "../../";

  // Обработать и сгруппировать все сообщения треда
  const { renderedGroups, imageCandidates, downloaded } = await processAndGroupMessages({
    messages,
    thread,
    assetsRoot,
    assetRelPrefix,
    publisherRoleIds,
    answerEmoji,
    publishEmoji,
    rateLimiter,
  });

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

async function run(): Promise<void> {
  const config = getConfig();
  await ensureDir(config.OUTPUT_DIR);
  const templates = await loadTemplates();
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

  // Создаём rate limiter для предотвращения Discord API 429 ошибок
  const rateLimiter = new RateLimitedAPI({ minDelay: 100, maxRetries: 3 });

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
      baseUrl: config.BASE_URL,
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
          baseUrl: config.BASE_URL,
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
        rateLimiter,
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
    const metas = await readLocalMeta(config.OUTPUT_DIR);
    for (const meta of metas) {
      const threadId = meta.threadId;
      const thread = await forumChannel.threads
        .fetch(threadId)
        .catch(() => null);
      if (!thread) {
        console.warn("Thread not found:", threadId);
        continue;
      }
      await generateThread(thread, undefined, false);
    }
    console.log(`Rebuild done. threads=${metas.length}`);
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
        rateLimiter,
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


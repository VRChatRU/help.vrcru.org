import type { ThreadChannel, Message, GuildMember } from 'discord.js';
import { LRUCache } from '../utils/cache';
import { RateLimitedAPI } from './api';

// LRU cache для предотвращения spam логирования missing стартовых сообщений
export const unknownStarterLogged = new LRUCache<string>(500);

/**
 * Нормализует emoji строку (убирает пробелы)
 */
export function normalizeReactionEmoji(emojiInput: string): string {
  return emojiInput.trim();
}

/**
 * Проверяет, совпадает ли реакция emoji с целевым
 */
export function reactionMatches(
  reactionEmoji: { id: string | null; name: string | null },
  target: string,
): boolean {
  if (!target) return false;
  if (reactionEmoji.id && reactionEmoji.id === target) return true;
  if (reactionEmoji.name && reactionEmoji.name === target) return true;
  return false;
}

/**
 * Проверяет, является ли ошибка "Unknown Message" (код 10008)
 */
export function isUnknownMessageError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyErr = error as { code?: number; rawError?: { code?: number } };
  return anyErr.code === 10008 || anyErr.rawError?.code === 10008;
}

/**
 * Логирует missing стартовое сообщение один раз (через LRU cache)
 */
export function logMissingStarterOnce(threadId: string, stage: string): void {
  if (unknownStarterLogged.has(threadId)) return;
  unknownStarterLogged.add(threadId);
  console.warn(
    `[publish-check] starter message missing (${stage}) thread=${threadId}`,
  );
}

/**
 * Проверяет, есть ли у member хотя бы одна из ролей
 */
export function memberHasAnyRole(
  member: GuildMember | null | undefined,
  roleIds: string[],
): boolean {
  if (!member) return false;
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * Проверяет, может ли тред быть опубликован
 * (есть ли publish реакция от пользователя с publisher ролью)
 *
 * КРИТИЧЕСКИЙ HOTSPOT - использует rate limiting для предотвращения 429 ошибок
 */
export async function isPublishableThread(params: {
  thread: ThreadChannel;
  publisherRoleIds: string[];
  publishEmoji: string;
  rateLimiter: RateLimitedAPI;
}): Promise<boolean> {
  const { thread, publisherRoleIds, publishEmoji, rateLimiter } = params;

  // Fetch starter message с rate limiting
  let starterMessage: Message | null = null;
  try {
    starterMessage = await rateLimiter.fetchStarterMessage(thread);
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

  // Refresh message с rate limiting
  try {
    await rateLimiter.refreshMessage(starterMessage);
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

  // Fetch reaction users с rate limiting
  const users = await rateLimiter.fetchReactionUsers(reaction);

  for (const user of users.values()) {
    if (user.bot) continue;

    // Fetch member с rate limiting
    const member = await rateLimiter.fetchGuildMember(thread.guild, user.id);

    if (memberHasAnyRole(member, publisherRoleIds)) {
      return true;
    }
  }

  return false;
}

/**
 * Проверяет, отмечено ли сообщение как ответ
 * (есть ли answer реакция от пользователя с publisher ролью)
 *
 * КРИТИЧЕСКИЙ HOTSPOT - использует rate limiting и member cache
 */
export async function isAnswerMessage(params: {
  message: Message;
  publisherRoleIds: string[];
  answerEmoji: string;
  memberCache: Map<string, GuildMember | null>;
  rateLimiter: RateLimitedAPI;
}): Promise<boolean> {
  const { message, publisherRoleIds, answerEmoji, memberCache, rateLimiter } = params;

  const reaction =
    message.reactions.cache.find((entry) =>
      reactionMatches(entry.emoji, answerEmoji),
    ) ?? null;

  if (!reaction) return false;

  // Fetch reaction users с rate limiting
  const users = await rateLimiter.fetchReactionUsers(reaction);

  for (const user of users.values()) {
    if (user.bot) continue;

    let member = memberCache.get(user.id) ?? null;

    if (!memberCache.has(user.id)) {
      // Fetch member с rate limiting
      member = await rateLimiter.fetchGuildMember(
        message.guild!,
        user.id
      );
      memberCache.set(user.id, member ?? null);
    }

    if (memberHasAnyRole(member, publisherRoleIds)) {
      return true;
    }
  }

  return false;
}

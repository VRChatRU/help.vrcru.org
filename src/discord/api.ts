import type { Collection, GuildMember, Message, Reaction, User, ThreadChannel, Guild } from 'discord.js';

/**
 * Custom error для Discord API операций
 */
export class DiscordAPIError extends Error {
  constructor(
    message: string,
    public code?: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'DiscordAPIError';
  }
}

/**
 * Rate-Limited обёртка над Discord API
 *
 * Автоматически управляет rate limits:
 * - Enforces minimum delay между запросами
 * - Автоматический retry с exponential backoff
 * - Логирование rate limit событий
 *
 * Критично для предотвращения Discord API 429 ошибок при:
 * - Массовой проверке реакций (reaction.users.fetch)
 * - Загрузке member данных (guild.members.fetch)
 * - Пагинации сообщений (thread.messages.fetch)
 */
export class RateLimitedAPI {
  private lastRequest = 0;
  private minDelay: number;
  private maxRetries: number;

  constructor(config: { minDelay?: number; maxRetries?: number } = {}) {
    this.minDelay = config.minDelay ?? 100; // 100ms по умолчанию
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * Задержка в миллисекундах
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Обеспечивает минимальную задержку между запросами
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;

    if (timeSinceLastRequest < this.minDelay) {
      await this.delay(this.minDelay - timeSinceLastRequest);
    }

    this.lastRequest = Date.now();
  }

  /**
   * Выполняет функцию с автоматическим retry и rate limiting
   *
   * @param fn - Функция для выполнения
   * @param options - Опции выполнения (retries, operation name)
   * @returns Результат выполнения функции
   * @throws DiscordAPIError если все попытки исчерпаны
   */
  async execute<T>(
    fn: () => Promise<T>,
    options: { retries?: number; operation?: string } = {}
  ): Promise<T> {
    const maxRetries = options.retries ?? this.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Enforce rate limit перед каждым запросом
        await this.enforceRateLimit();

        // Выполнить операцию
        return await fn();
      } catch (error: any) {
        lastError = error;

        // Проверить, является ли ошибка rate limit (429)
        const isRateLimit = error?.code === 429 || error?.status === 429;
        const retryAfter = error?.retryAfter ?? (isRateLimit ? 1000 : null);

        // Если rate limit и есть попытки, retry с backoff
        if (isRateLimit && attempt < maxRetries) {
          const backoff = retryAfter ?? Math.min(1000 * Math.pow(2, attempt), 10000);
          console.warn(
            `[rate-limit] ${options.operation ?? 'operation'} hit rate limit, ` +
            `retry ${attempt + 1}/${maxRetries} after ${backoff}ms`
          );
          await this.delay(backoff);
          continue;
        }

        // Для других ошибок, retry с exponential backoff
        if (attempt < maxRetries) {
          const backoff = Math.min(500 * Math.pow(2, attempt), 5000);
          console.warn(
            `[api-error] ${options.operation ?? 'operation'} failed, ` +
            `retry ${attempt + 1}/${maxRetries} after ${backoff}ms:`,
            error.message
          );
          await this.delay(backoff);
          continue;
        }

        break; // Исчерпали попытки
      }
    }

    // Если дошли сюда, все попытки провалились
    throw new DiscordAPIError(
      `Failed after ${maxRetries} retries: ${options.operation ?? 'operation'}`,
      lastError?.code,
      lastError?.retryAfter
    );
  }

  /**
   * Обёртки для критических Discord API операций
   */

  async fetchReactionUsers(reaction: Reaction): Promise<Collection<string, User>> {
    return this.execute(
      () => reaction.users.fetch(),
      { operation: `fetch reaction users` }
    );
  }

  async fetchGuildMember(
    guild: Guild,
    userId: string
  ): Promise<GuildMember | null> {
    return this.execute(
      () => guild.members.fetch(userId).catch(() => null),
      { operation: `fetch member ${userId}` }
    );
  }

  async fetchMessages(
    thread: ThreadChannel,
    options: { limit?: number; before?: string }
  ): Promise<Collection<string, Message>> {
    return this.execute(
      () => thread.messages.fetch(options),
      { operation: `fetch messages limit=${options.limit}` }
    );
  }

  async fetchStarterMessage(thread: ThreadChannel): Promise<Message | null> {
    return this.execute(
      () => thread.fetchStarterMessage(),
      { operation: `fetch starter message thread=${thread.id}` }
    );
  }

  async refreshMessage(message: Message): Promise<Message> {
    return this.execute(
      () => message.fetch(),
      { operation: `refresh message ${message.id}` }
    );
  }
}

/**
 * LRU (Least Recently Used) Cache
 *
 * Ограничивает размер кэша, автоматически удаляя самые старые записи
 * при достижении максимального размера.
 *
 * Заменяет unbounded Set для unknownStarterLogged, предотвращая утечку памяти.
 */
export class LRUCache<K> {
  private cache: Map<K, number>;
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Проверяет наличие ключа в кэше
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Добавляет ключ в кэш
   * Если ключ уже существует, обновляет timestamp (делает самым свежим)
   * Если кэш переполнен, удаляет самый старый элемент
   */
  add(key: K): void {
    // Если ключ уже есть, удаляем его чтобы переместить в конец
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Добавляем с текущим timestamp
    this.cache.set(key, Date.now());

    // Если превысили лимит, удаляем самый старый элемент
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * Очищает весь кэш
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Возвращает текущий размер кэша
   */
  get size(): number {
    return this.cache.size;
  }
}

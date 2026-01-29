import { describe, it, expect } from 'vitest';
import { LRUCache } from '../../../src/utils/cache';

describe('LRUCache', () => {
  it('should store and retrieve items', () => {
    const cache = new LRUCache<string>(10);

    cache.add('a');
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('should limit size to maxSize', () => {
    const cache = new LRUCache<string>(3);

    cache.add('a');
    cache.add('b');
    cache.add('c');
    cache.add('d'); // Should evict 'a'

    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.size).toBe(3);
  });

  it('should refresh item on duplicate add (LRU behavior)', () => {
    const cache = new LRUCache<string>(2);

    cache.add('a');
    cache.add('b');
    cache.add('a'); // Refreshes 'a', making it most recent
    cache.add('c'); // Should evict 'b', not 'a'

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false); // Evicted
    expect(cache.has('c')).toBe(true);
  });

  it('should clear all items', () => {
    const cache = new LRUCache<string>(10);

    cache.add('a');
    cache.add('b');
    cache.add('c');

    expect(cache.size).toBe(3);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
  });

  it('should handle maxSize of 1', () => {
    const cache = new LRUCache<string>(1);

    cache.add('a');
    expect(cache.has('a')).toBe(true);

    cache.add('b'); // Should evict 'a'
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('should handle large number of additions', () => {
    const cache = new LRUCache<number>(100);

    // Add 200 items
    for (let i = 0; i < 200; i++) {
      cache.add(i);
    }

    // Should only have last 100 items
    expect(cache.size).toBe(100);
    expect(cache.has(0)).toBe(false); // First 100 evicted
    expect(cache.has(99)).toBe(false);
    expect(cache.has(100)).toBe(true); // Last 100 remain
    expect(cache.has(199)).toBe(true);
  });

  it('should work with different key types', () => {
    const stringCache = new LRUCache<string>(2);
    stringCache.add('test');
    expect(stringCache.has('test')).toBe(true);

    const numberCache = new LRUCache<number>(2);
    numberCache.add(42);
    expect(numberCache.has(42)).toBe(true);

    const objectCache = new LRUCache<{ id: string }>(2);
    const obj = { id: 'test' };
    objectCache.add(obj);
    expect(objectCache.has(obj)).toBe(true);
  });
});

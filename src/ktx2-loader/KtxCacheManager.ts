/**
 * KtxCacheManager - IndexedDB cache for transcoded mip levels
 *
 * Features:
 * - LRU eviction when size limit exceeded
 * - Cache statistics (hits, misses, size)
 * - TTL-based expiration
 * - Partial cache support
 */

import type { CachedMip } from './types';

export interface CacheStats {
  totalSize: number;      // Total cache size in bytes
  itemCount: number;      // Number of cached items
  hits: number;           // Cache hits since init
  misses: number;         // Cache misses since init
  hitRate: number;        // Hit rate percentage
  oldestTimestamp: number; // Timestamp of oldest entry
  newestTimestamp: number; // Timestamp of newest entry
}

export class KtxCacheManager {
  private dbName: string;
  private version: number;
  private db: IDBDatabase | null = null;

  // Statistics
  private stats = {
    hits: 0,
    misses: 0,
  };

  // Cache limits
  private maxSizeBytes = 100 * 1024 * 1024; // 100MB default
  private readonly STORE_NAME = 'mips';

  constructor(dbName: string, version: number) {
    this.dbName = dbName;
    this.version = version;
  }

  /**
   * Initialize IndexedDB
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('url', 'url', { unique: false });
        }
      };
    });
  }

  /**
   * Set maximum cache size in megabytes
   */
  setMaxSize(megabytes: number): void {
    this.maxSizeBytes = megabytes * 1024 * 1024;
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<CacheStats> {
    if (!this.db) throw new Error('Cache not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const items: CachedMip[] = request.result;

        let totalSize = 0;
        let oldest = Date.now();
        let newest = 0;

        items.forEach(item => {
          totalSize += item.data.byteLength;
          if (item.timestamp < oldest) oldest = item.timestamp;
          if (item.timestamp > newest) newest = item.timestamp;
        });

        const totalRequests = this.stats.hits + this.stats.misses;
        const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;

        resolve({
          totalSize,
          itemCount: items.length,
          hits: this.stats.hits,
          misses: this.stats.misses,
          hitRate,
          oldestTimestamp: items.length > 0 ? oldest : 0,
          newestTimestamp: items.length > 0 ? newest : 0,
        });
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear old entries based on TTL
   */
  async clearOld(maxAgeDays: number): Promise<void> {
    if (!this.db) return;

    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAge;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);

      request.onsuccess = (event: Event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Enforce cache size limit using LRU eviction
   */
  private async enforceSizeLimit(): Promise<void> {
    if (!this.db) return;

    const stats = await this.getCacheStats();
    if (stats.totalSize <= this.maxSizeBytes) return;

    // Get all items sorted by timestamp (oldest first)
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('timestamp');
      const request = index.openCursor();

      let currentSize = stats.totalSize;

      request.onsuccess = (event: Event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && currentSize > this.maxSizeBytes) {
          const item: CachedMip = cursor.value;
          currentSize -= item.data.byteLength;
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get list of cached mip levels for a URL
   */
  async getMipList(url: string): Promise<number[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('url');
      const request = index.getAll(url);

      request.onsuccess = () => {
        const items: CachedMip[] = request.result;
        const levels = items.map(item => item.level).sort((a, b) => a - b);
        resolve(levels);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Load cached mip level
   */
  async loadMip(url: string, level: number): Promise<CachedMip | null> {
    if (!this.db) {
      this.stats.misses++;
      return null;
    }

    const id = `${url}#L${level}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        const result: CachedMip | undefined = request.result;
        if (result) {
          this.stats.hits++;
          resolve(result);
        } else {
          this.stats.misses++;
          resolve(null);
        }
      };

      request.onerror = () => {
        this.stats.misses++;
        reject(request.error);
      };
    });
  }

  /**
   * Save mip level to cache
   */
  async saveMip(
    url: string,
    level: number,
    data: Uint8Array,
    metadata: { width: number; height: number; timestamp: number }
  ): Promise<void> {
    if (!this.db) return;

    const id = `${url}#L${level}`;
    const item: CachedMip = {
      id,
      url,
      level,
      width: metadata.width,
      height: metadata.height,
      data,
      timestamp: metadata.timestamp,
      version: '1.0',
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.put(item);

      request.onsuccess = async () => {
        // Enforce size limit after adding new item
        await this.enforceSizeLimit();
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        this.stats.hits = 0;
        this.stats.misses = 0;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

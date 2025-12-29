/**
 * CacheManager - Dual-layer caching (Memory + IndexedDB)
 *
 * - Memory cache for fast access to loaded assets
 * - IndexedDB for persistent storage across sessions
 * - LRU eviction when memory limit reached
 */

import { AssetType, CachedAsset, CacheStats } from './types';

const DB_NAME = 'asset-streaming-db';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

export class CacheManager {
  private static instance: CacheManager | null = null;

  // Memory cache
  private memoryCache = new Map<string, CachedAsset>();
  private memorySizeBytes = 0;
  private maxMemorySizeBytes: number;

  // IndexedDB
  private db: IDBDatabase | null = null;
  private dbReady = false;
  private dbInitPromise: Promise<void> | null = null;
  private useIndexedDB: boolean;

  // LRU tracking
  private accessOrder: string[] = [];

  private constructor(maxMemoryMB: number, useIndexedDB: boolean) {
    this.maxMemorySizeBytes = maxMemoryMB * 1024 * 1024;
    this.useIndexedDB = useIndexedDB;
  }

  static getInstance(maxMemoryMB = 512, useIndexedDB = true): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager(maxMemoryMB, useIndexedDB);
    }
    return CacheManager.instance;
  }

  /**
   * Initialize IndexedDB
   */
  async init(): Promise<void> {
    if (!this.useIndexedDB) {
      this.dbReady = true;
      return;
    }

    if (this.dbReady) return;
    if (this.dbInitPromise) return this.dbInitPromise;

    this.dbInitPromise = this.initDB();
    await this.dbInitPromise;
  }

  private async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('[CacheManager] IndexedDB not available');
        this.dbReady = true;
        resolve();
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[CacheManager] IndexedDB error:', request.error);
        this.dbReady = true;
        resolve(); // Continue without IndexedDB
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.dbReady = true;
        console.log('[CacheManager] IndexedDB ready');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  // ============================================================================
  // Memory Cache Operations
  // ============================================================================

  /**
   * Get asset from memory cache
   */
  getFromMemory(id: string): CachedAsset | null {
    const asset = this.memoryCache.get(id);
    if (asset) {
      this.updateAccessOrder(id);
    }
    return asset || null;
  }

  /**
   * Store asset in memory cache
   */
  setInMemory(asset: CachedAsset): void {
    // Evict if needed
    while (this.memorySizeBytes + asset.size > this.maxMemorySizeBytes && this.accessOrder.length > 0) {
      this.evictLRU();
    }

    // Remove old entry if exists
    const existing = this.memoryCache.get(asset.id);
    if (existing) {
      this.memorySizeBytes -= existing.size;
    }

    // Add new entry
    this.memoryCache.set(asset.id, asset);
    this.memorySizeBytes += asset.size;
    this.updateAccessOrder(asset.id);
  }

  /**
   * Remove asset from memory cache
   */
  removeFromMemory(id: string): void {
    const asset = this.memoryCache.get(id);
    if (asset) {
      this.memorySizeBytes -= asset.size;
      this.memoryCache.delete(id);
      this.accessOrder = this.accessOrder.filter((i) => i !== id);
    }
  }

  /**
   * Check if asset is in memory
   */
  hasInMemory(id: string): boolean {
    return this.memoryCache.has(id);
  }

  private updateAccessOrder(id: string): void {
    this.accessOrder = this.accessOrder.filter((i) => i !== id);
    this.accessOrder.push(id);
  }

  private evictLRU(): void {
    const id = this.accessOrder.shift();
    if (id) {
      const asset = this.memoryCache.get(id);
      if (asset) {
        this.memorySizeBytes -= asset.size;
        this.memoryCache.delete(id);
        console.log(`[CacheManager] Evicted from memory: ${id}`);
      }
    }
  }

  // ============================================================================
  // IndexedDB Operations
  // ============================================================================

  /**
   * Get asset from IndexedDB
   */
  async getFromDB(id: string): Promise<CachedAsset | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        console.error('[CacheManager] DB get error:', request.error);
        resolve(null);
      };
    });
  }

  /**
   * Store asset in IndexedDB
   */
  async setInDB(asset: CachedAsset): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(asset);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.error('[CacheManager] DB put error:', request.error);
        resolve(); // Don't fail on cache errors
      };
    });
  }

  /**
   * Remove asset from IndexedDB
   */
  async removeFromDB(id: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }

  /**
   * Check if asset exists in IndexedDB
   */
  async hasInDB(id: string): Promise<boolean> {
    if (!this.db) return false;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count(IDBKeyRange.only(id));

      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => resolve(false);
    });
  }

  // ============================================================================
  // Combined Operations
  // ============================================================================

  /**
   * Get asset (memory first, then IndexedDB)
   */
  async get(id: string): Promise<CachedAsset | null> {
    // Try memory first
    const memoryAsset = this.getFromMemory(id);
    if (memoryAsset) {
      return memoryAsset;
    }

    // Try IndexedDB
    const dbAsset = await this.getFromDB(id);
    if (dbAsset) {
      // Promote to memory cache
      this.setInMemory(dbAsset);
      return dbAsset;
    }

    return null;
  }

  /**
   * Store asset (both memory and IndexedDB)
   */
  async set(asset: CachedAsset): Promise<void> {
    this.setInMemory(asset);

    if (this.useIndexedDB) {
      await this.setInDB(asset);
    }
  }

  /**
   * Remove asset (from both caches)
   */
  async remove(id: string): Promise<void> {
    this.removeFromMemory(id);

    if (this.useIndexedDB) {
      await this.removeFromDB(id);
    }
  }

  /**
   * Check if asset exists (in either cache)
   */
  async has(id: string): Promise<boolean> {
    if (this.hasInMemory(id)) {
      return true;
    }
    return this.hasInDB(id);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { memoryUsedMB: number; memoryMaxMB: number } {
    let modelCount = 0;
    let materialCount = 0;
    let textureCount = 0;

    for (const asset of this.memoryCache.values()) {
      switch (asset.type) {
        case 'model':
          modelCount++;
          break;
        case 'material':
          materialCount++;
          break;
        case 'texture':
          textureCount++;
          break;
      }
    }

    return {
      totalSize: this.memorySizeBytes,
      modelCount,
      materialCount,
      textureCount,
      memoryUsedMB: this.memorySizeBytes / (1024 * 1024),
      memoryMaxMB: this.maxMemorySizeBytes / (1024 * 1024),
    };
  }

  /**
   * Clear memory cache
   */
  clearMemory(): void {
    this.memoryCache.clear();
    this.accessOrder = [];
    this.memorySizeBytes = 0;
    console.log('[CacheManager] Memory cache cleared');
  }

  /**
   * Clear IndexedDB cache
   */
  async clearDB(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('[CacheManager] IndexedDB cleared');
        resolve();
      };
      request.onerror = () => resolve();
    });
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    this.clearMemory();
    await this.clearDB();
  }

  /**
   * Get all cached asset IDs by type
   */
  getCachedIds(type?: AssetType): string[] {
    const ids: string[] = [];
    for (const [id, asset] of this.memoryCache) {
      if (!type || asset.type === type) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Set max memory size
   */
  setMaxMemory(maxMB: number): void {
    this.maxMemorySizeBytes = maxMB * 1024 * 1024;

    // Evict if over new limit
    while (this.memorySizeBytes > this.maxMemorySizeBytes && this.accessOrder.length > 0) {
      this.evictLRU();
    }
  }

  /**
   * Reset instance (for testing)
   */
  static reset(): void {
    if (CacheManager.instance) {
      CacheManager.instance.clearMemory();
    }
    CacheManager.instance = null;
  }
}

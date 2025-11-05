/**
 * MemoryTracker - Tracks memory usage and handles eviction
 *
 * Features:
 * - Manual VRAM tracking
 * - Budget enforcement
 * - LRU + Priority eviction
 * - Per-category budgets
 */

import type { TextureHandle } from './TextureHandle';
import type { TextureRegistry } from './TextureRegistry';
import type { CategoryManager } from './CategoryManager';

export interface MemoryStats {
  used: number;           // bytes
  limit: number;          // bytes
  usagePercent: number;
  availabe: number;       // bytes
  pressure: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

export class MemoryTracker {
  private registry: TextureRegistry;
  private categoryManager: CategoryManager;
  private maxMemoryBytes: number;

  constructor(
    registry: TextureRegistry,
    categoryManager: CategoryManager,
    maxMemoryMB: number
  ) {
    this.registry = registry;
    this.categoryManager = categoryManager;
    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  setMaxMemory(maxMemoryMB: number): void {
    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
  }

  getMaxMemory(): number {
    return this.maxMemoryBytes;
  }

  // =========================================================================
  // Memory Stats
  // =========================================================================

  /**
   * Get current memory usage
   */
  getUsedMemory(): number {
    return this.registry.getTotalMemoryUsage();
  }

  /**
   * Get available memory
   */
  getAvailableMemory(): number {
    return Math.max(0, this.maxMemoryBytes - this.getUsedMemory());
  }

  /**
   * Get memory usage percentage
   */
  getUsagePercent(): number {
    return (this.getUsedMemory() / this.maxMemoryBytes) * 100;
  }

  /**
   * Get memory pressure level
   */
  getMemoryPressure(): 'none' | 'low' | 'medium' | 'high' | 'critical' {
    const percent = this.getUsagePercent();

    if (percent < 60) return 'none';
    if (percent < 75) return 'low';
    if (percent < 85) return 'medium';
    if (percent < 95) return 'high';
    return 'critical';
  }

  /**
   * Get memory stats
   */
  getStats(): MemoryStats {
    const used = this.getUsedMemory();
    const limit = this.maxMemoryBytes;

    return {
      used,
      limit,
      usagePercent: this.getUsagePercent(),
      availabe: this.getAvailableMemory(),
      pressure: this.getMemoryPressure(),
    };
  }

  // =========================================================================
  // Budget Checks
  // =========================================================================

  /**
   * Check if we have enough memory for a texture
   */
  canAllocate(bytes: number): boolean {
    return this.getAvailableMemory() >= bytes;
  }

  /**
   * Check if memory pressure requires eviction
   */
  needsEviction(): boolean {
    const pressure = this.getMemoryPressure();
    return pressure === 'high' || pressure === 'critical';
  }

  /**
   * Get target memory to free
   */
  getTargetEvictionBytes(): number {
    const pressure = this.getMemoryPressure();
    const used = this.getUsedMemory();

    // Target: return to 70% usage
    const targetUsage = this.maxMemoryBytes * 0.7;

    if (pressure === 'critical') {
      // Free aggressively - down to 60%
      return used - this.maxMemoryBytes * 0.6;
    }

    if (pressure === 'high') {
      // Free moderately
      return used - targetUsage;
    }

    return 0;
  }

  // =========================================================================
  // Eviction
  // =========================================================================

  /**
   * Evict textures to free memory
   * Returns number of textures evicted
   */
  evict(targetBytes?: number): number {
    const target = targetBytes ?? this.getTargetEvictionBytes();
    if (target <= 0) return 0;

    let freed = 0;
    let evicted = 0;

    // Get evictable textures (not persistent, not currently loading)
    const candidates = this.registry
      .getAll()
      .filter(h => h.canEvict && h.isLoaded);

    if (candidates.length === 0) {
      console.warn('[MemoryTracker] No textures available for eviction');
      return 0;
    }

    // Sort by eviction priority (hybrid LRU + priority)
    const sorted = this.sortByEvictionPriority(candidates);

    // Evict until target reached
    for (const handle of sorted) {
      if (freed >= target) break;

      const memory = handle.getMemoryUsage();
      handle.unload();
      freed += memory;
      evicted++;

      console.log(
        `[MemoryTracker] Evicted "${handle.id}" ` +
        `(${(memory / 1024 / 1024).toFixed(2)} MB, priority=${handle.priority.toFixed(0)})`
      );
    }

    console.log(
      `[MemoryTracker] Eviction complete: ${evicted} textures, ` +
      `${(freed / 1024 / 1024).toFixed(2)} MB freed`
    );

    return evicted;
  }

  /**
   * Sort textures by eviction priority
   * Lower score = evict first
   *
   * Score = priority * 0.7 + recency * 0.3
   * - Low priority textures evicted first
   * - Least recently used textures evicted first
   */
  private sortByEvictionPriority(handles: TextureHandle[]): TextureHandle[] {
    const now = Date.now();

    return handles.sort((a, b) => {
      // Normalize priority (0-1000 typical range)
      const priorityA = a.priority / 1000;
      const priorityB = b.priority / 1000;

      // Normalize recency (0-1, newer = higher)
      const maxAge = 60 * 1000; // 1 minute
      const ageA = Math.min(now - a.getLastUsed(), maxAge);
      const ageB = Math.min(now - b.getLastUsed(), maxAge);
      const recencyA = 1 - ageA / maxAge;
      const recencyB = 1 - ageB / maxAge;

      // Combined score (higher = keep, lower = evict)
      const scoreA = priorityA * 0.7 + recencyA * 0.3;
      const scoreB = priorityB * 0.7 + recencyB * 0.3;

      return scoreA - scoreB; // Ascending (lowest score first)
    });
  }

  /**
   * Evict all textures in category
   */
  evictCategory(category: 'level' | 'dynamic'): number {
    const handles = this.registry.getByCategory(category);
    let evicted = 0;

    for (const handle of handles) {
      if (handle.isLoaded) {
        handle.unload();
        evicted++;
      }
    }

    console.log(`[MemoryTracker] Evicted ${evicted} textures from category "${category}"`);
    return evicted;
  }

  /**
   * Enforce memory budget before loading
   */
  async enforceBeforeLoad(requiredBytes: number): Promise<boolean> {
    // If we have enough space, allow immediately
    if (this.canAllocate(requiredBytes)) {
      return true;
    }

    // Try to free enough memory
    const needed = requiredBytes - this.getAvailableMemory();
    console.log(
      `[MemoryTracker] Need to free ${(needed / 1024 / 1024).toFixed(2)} MB before loading`
    );

    this.evict(needed);

    // Check if we freed enough
    return this.canAllocate(requiredBytes);
  }

  // =========================================================================
  // Debug
  // =========================================================================

  /**
   * Print memory stats
   */
  debug(): void {
    const stats = this.getStats();
    console.log('[MemoryTracker] Stats:', {
      used: `${(stats.used / 1024 / 1024).toFixed(2)} MB`,
      limit: `${(stats.limit / 1024 / 1024).toFixed(2)} MB`,
      available: `${(stats.availabe / 1024 / 1024).toFixed(2)} MB`,
      usage: `${stats.usagePercent.toFixed(1)}%`,
      pressure: stats.pressure,
    });
  }
}

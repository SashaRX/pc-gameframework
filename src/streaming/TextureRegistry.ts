/**
 * TextureRegistry - Central registry for all streaming textures
 *
 * Features:
 * - Fast lookup by ID or entity
 * - Category grouping
 * - State filtering
 * - Memory tracking per category
 */

import type { TextureHandle } from './TextureHandle';
import type { TextureCategory, TextureState } from './types';

export class TextureRegistry {
  // Main registry
  private textures: Map<string, TextureHandle> = new Map();

  // Fast lookups
  private byCategory: Map<TextureCategory, Set<string>> = new Map();
  private byEntity: Map<string, Set<string>> = new Map(); // entity.getGuid() -> texture IDs
  private byState: Map<TextureState, Set<string>> = new Map();

  constructor() {
    // Initialize category maps
    this.byCategory.set('persistent', new Set());
    this.byCategory.set('level', new Set());
    this.byCategory.set('dynamic', new Set());

    // Initialize state maps
    const states: TextureState[] = [
      'unloaded',
      'queued',
      'loading',
      'partial',
      'loaded',
      'error',
      'evicting',
    ];
    states.forEach(state => this.byState.set(state, new Set()));
  }

  // =========================================================================
  // Registration
  // =========================================================================

  /**
   * Register a texture handle
   */
  register(handle: TextureHandle): void {
    const id = handle.id;

    if (this.textures.has(id)) {
      console.warn(`[TextureRegistry] Texture "${id}" already registered`);
      return;
    }

    this.textures.set(id, handle);

    // Add to category index
    this.byCategory.get(handle.category)?.add(id);

    // Add to entity index
    const entityGuid = handle.entity.getGuid();
    if (!this.byEntity.has(entityGuid)) {
      this.byEntity.set(entityGuid, new Set());
    }
    this.byEntity.get(entityGuid)!.add(id);

    // Add to state index
    this.updateState(id, handle.state);
  }

  /**
   * Unregister a texture handle
   */
  unregister(id: string): boolean {
    const handle = this.textures.get(id);
    if (!handle) return false;

    // Remove from main registry
    this.textures.delete(id);

    // Remove from category index
    this.byCategory.get(handle.category)?.delete(id);

    // Remove from entity index
    const entityGuid = handle.entity.getGuid();
    this.byEntity.get(entityGuid)?.delete(id);
    if (this.byEntity.get(entityGuid)?.size === 0) {
      this.byEntity.delete(entityGuid);
    }

    // Remove from state index
    this.byState.get(handle.state)?.delete(id);

    return true;
  }

  /**
   * Update texture state in index
   */
  updateState(id: string, newState: TextureState): void {
    const handle = this.textures.get(id);
    if (!handle) return;

    // Remove from old state
    this.byState.forEach(set => set.delete(id));

    // Add to new state
    this.byState.get(newState)?.add(id);
  }

  // =========================================================================
  // Lookup
  // =========================================================================

  /**
   * Get handle by ID
   */
  get(id: string): TextureHandle | undefined {
    return this.textures.get(id);
  }

  /**
   * Check if texture exists
   */
  has(id: string): boolean {
    return this.textures.has(id);
  }

  /**
   * Get all texture handles
   */
  getAll(): TextureHandle[] {
    return Array.from(this.textures.values());
  }

  /**
   * Get textures by category
   */
  getByCategory(category: TextureCategory): TextureHandle[] {
    const ids = this.byCategory.get(category) ?? new Set();
    return Array.from(ids)
      .map(id => this.textures.get(id))
      .filter((h): h is TextureHandle => h !== undefined);
  }

  /**
   * Get textures by entity
   */
  getByEntity(entityGuid: string): TextureHandle[] {
    const ids = this.byEntity.get(entityGuid) ?? new Set();
    return Array.from(ids)
      .map(id => this.textures.get(id))
      .filter((h): h is TextureHandle => h !== undefined);
  }

  /**
   * Get textures by state
   */
  getByState(state: TextureState): TextureHandle[] {
    const ids = this.byState.get(state) ?? new Set();
    return Array.from(ids)
      .map(id => this.textures.get(id))
      .filter((h): h is TextureHandle => h !== undefined);
  }

  /**
   * Get textures matching filter
   */
  filter(predicate: (handle: TextureHandle) => boolean): TextureHandle[] {
    return Array.from(this.textures.values()).filter(predicate);
  }

  // =========================================================================
  // Statistics
  // =========================================================================

  /**
   * Get total count
   */
  get count(): number {
    return this.textures.size;
  }

  /**
   * Get count by category
   */
  getCountByCategory(category: TextureCategory): number {
    return this.byCategory.get(category)?.size ?? 0;
  }

  /**
   * Get count by state
   */
  getCountByState(state: TextureState): number {
    return this.byState.get(state)?.size ?? 0;
  }

  /**
   * Get total memory usage
   */
  getTotalMemoryUsage(): number {
    let total = 0;
    for (const handle of this.textures.values()) {
      total += handle.getMemoryUsage();
    }
    return total;
  }

  /**
   * Get memory usage by category
   */
  getMemoryUsageByCategory(category: TextureCategory): number {
    const handles = this.getByCategory(category);
    return handles.reduce((sum, h) => sum + h.getMemoryUsage(), 0);
  }

  /**
   * Get loaded count by category
   */
  getLoadedCountByCategory(category: TextureCategory): number {
    const handles = this.getByCategory(category);
    return handles.filter(h => h.isLoaded).length;
  }

  // =========================================================================
  // Bulk Operations
  // =========================================================================

  /**
   * Clear all textures
   */
  clear(): void {
    // Destroy all handles
    for (const handle of this.textures.values()) {
      handle.destroy();
    }

    this.textures.clear();
    this.byCategory.forEach(set => set.clear());
    this.byEntity.clear();
    this.byState.forEach(set => set.clear());
  }

  /**
   * Unregister all textures in category
   */
  clearCategory(category: TextureCategory): void {
    const handles = this.getByCategory(category);
    for (const handle of handles) {
      handle.destroy();
      this.unregister(handle.id);
    }
  }

  /**
   * Unregister all textures for entity
   */
  clearEntity(entityGuid: string): void {
    const handles = this.getByEntity(entityGuid);
    for (const handle of handles) {
      handle.destroy();
      this.unregister(handle.id);
    }
  }

  // =========================================================================
  // Debug
  // =========================================================================

  /**
   * Get registry statistics
   */
  getStats() {
    return {
      total: this.count,
      categories: {
        persistent: this.getCountByCategory('persistent'),
        level: this.getCountByCategory('level'),
        dynamic: this.getCountByCategory('dynamic'),
      },
      states: {
        unloaded: this.getCountByState('unloaded'),
        queued: this.getCountByState('queued'),
        loading: this.getCountByState('loading'),
        partial: this.getCountByState('partial'),
        loaded: this.getCountByState('loaded'),
        error: this.getCountByState('error'),
        evicting: this.getCountByState('evicting'),
      },
      memory: {
        total: this.getTotalMemoryUsage(),
        persistent: this.getMemoryUsageByCategory('persistent'),
        level: this.getMemoryUsageByCategory('level'),
        dynamic: this.getMemoryUsageByCategory('dynamic'),
      },
    };
  }

  /**
   * Print debug info
   */
  debug(): void {
    const stats = this.getStats();
    console.log('[TextureRegistry] Stats:', {
      ...stats,
      memory: {
        total: `${(stats.memory.total / 1024 / 1024).toFixed(2)} MB`,
        persistent: `${(stats.memory.persistent / 1024 / 1024).toFixed(2)} MB`,
        level: `${(stats.memory.level / 1024 / 1024).toFixed(2)} MB`,
        dynamic: `${(stats.memory.dynamic / 1024 / 1024).toFixed(2)} MB`,
      },
    });
  }
}

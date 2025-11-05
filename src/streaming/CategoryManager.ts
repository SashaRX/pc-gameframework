/**
 * CategoryManager - Manages configuration for texture categories
 *
 * Provides default configs and allows per-category customization
 */

import type { TextureCategory, CategoryConfig } from './types';

/**
 * Default category configurations
 */
const DEFAULT_CATEGORY_CONFIGS: Record<TextureCategory, CategoryConfig> = {
  persistent: {
    loadImmediately: true,
    keepInMemory: true,
    targetLod: 1,          // High quality
    priorityWeight: 1000,  // Highest priority
    maxMemoryMB: 200,      // Reserve 200MB for persistent
  },

  level: {
    loadImmediately: true,
    keepInMemory: true,
    targetLod: 3,          // Medium quality
    priorityWeight: 500,   // Medium priority
    maxMemoryMB: 300,      // Reserve 300MB for level
  },

  dynamic: {
    loadImmediately: false,
    keepInMemory: false,
    targetLod: 5,          // Low quality (base LOD)
    priorityWeight: 100,   // Variable priority (distance-based)
    maxMemoryMB: undefined, // Use remaining budget
  },
};

export class CategoryManager {
  private configs: Map<TextureCategory, CategoryConfig> = new Map();

  constructor() {
    // Initialize with defaults
    this.configs.set('persistent', { ...DEFAULT_CATEGORY_CONFIGS.persistent });
    this.configs.set('level', { ...DEFAULT_CATEGORY_CONFIGS.level });
    this.configs.set('dynamic', { ...DEFAULT_CATEGORY_CONFIGS.dynamic });
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Get configuration for category
   */
  getConfig(category: TextureCategory): CategoryConfig {
    return this.configs.get(category)!;
  }

  /**
   * Set configuration for category
   */
  setConfig(category: TextureCategory, config: Partial<CategoryConfig>): void {
    const current = this.configs.get(category)!;
    this.configs.set(category, { ...current, ...config });
  }

  /**
   * Reset category to default configuration
   */
  resetConfig(category: TextureCategory): void {
    this.configs.set(category, { ...DEFAULT_CATEGORY_CONFIGS[category] });
  }

  /**
   * Reset all categories to defaults
   */
  resetAll(): void {
    this.configs.set('persistent', { ...DEFAULT_CATEGORY_CONFIGS.persistent });
    this.configs.set('level', { ...DEFAULT_CATEGORY_CONFIGS.level });
    this.configs.set('dynamic', { ...DEFAULT_CATEGORY_CONFIGS.dynamic });
  }

  // =========================================================================
  // Query
  // =========================================================================

  /**
   * Should texture load immediately based on category?
   */
  shouldLoadImmediately(category: TextureCategory): boolean {
    return this.configs.get(category)!.loadImmediately;
  }

  /**
   * Should texture be kept in memory (not evicted)?
   */
  shouldKeepInMemory(category: TextureCategory): boolean {
    return this.configs.get(category)!.keepInMemory;
  }

  /**
   * Get target LOD for category
   */
  getTargetLod(category: TextureCategory): number {
    return this.configs.get(category)!.targetLod;
  }

  /**
   * Get priority weight for category
   */
  getPriorityWeight(category: TextureCategory): number {
    return this.configs.get(category)!.priorityWeight;
  }

  /**
   * Get memory budget for category (bytes)
   */
  getMemoryBudget(category: TextureCategory): number | undefined {
    const mb = this.configs.get(category)!.maxMemoryMB;
    return mb !== undefined ? mb * 1024 * 1024 : undefined;
  }

  /**
   * Get all priority weights as map
   */
  getAllPriorityWeights(): Record<TextureCategory, number> {
    return {
      persistent: this.getPriorityWeight('persistent'),
      level: this.getPriorityWeight('level'),
      dynamic: this.getPriorityWeight('dynamic'),
    };
  }

  // =========================================================================
  // Presets
  // =========================================================================

  /**
   * Apply "High Performance" preset
   * - Lower quality everywhere
   * - Fast loading
   */
  applyHighPerformancePreset(): void {
    this.setConfig('persistent', { targetLod: 2 });
    this.setConfig('level', { targetLod: 5 });
    this.setConfig('dynamic', { targetLod: 7 });
  }

  /**
   * Apply "High Quality" preset
   * - Maximum quality
   * - More memory usage
   */
  applyHighQualityPreset(): void {
    this.setConfig('persistent', { targetLod: 0 });
    this.setConfig('level', { targetLod: 1 });
    this.setConfig('dynamic', { targetLod: 3 });
  }

  /**
   * Apply "Balanced" preset (default)
   */
  applyBalancedPreset(): void {
    this.resetAll();
  }

  /**
   * Apply "Mobile" preset
   * - Aggressive memory management
   * - Lower quality
   */
  applyMobilePreset(): void {
    this.setConfig('persistent', {
      targetLod: 3,
      maxMemoryMB: 100,
    });
    this.setConfig('level', {
      targetLod: 5,
      maxMemoryMB: 150,
      keepInMemory: false, // Allow eviction
    });
    this.setConfig('dynamic', {
      targetLod: 7,
      loadImmediately: false,
    });
  }

  // =========================================================================
  // Debug
  // =========================================================================

  /**
   * Get all configurations
   */
  getAllConfigs(): Record<TextureCategory, CategoryConfig> {
    return {
      persistent: this.getConfig('persistent'),
      level: this.getConfig('level'),
      dynamic: this.getConfig('dynamic'),
    };
  }

  /**
   * Print debug info
   */
  debug(): void {
    console.log('[CategoryManager] Configurations:', this.getAllConfigs());
  }
}

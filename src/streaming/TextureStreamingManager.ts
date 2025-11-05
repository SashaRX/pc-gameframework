/**
 * TextureStreamingManager - Main orchestrator for texture streaming system
 *
 * Integrates all subsystems:
 * - TextureHandle: Individual texture wrapper
 * - TextureRegistry: Central texture storage
 * - CategoryManager: Category-based configuration
 * - MemoryTracker: Memory budget & eviction
 * - SimpleScheduler: Priority queue & loading
 *
 * Features:
 * - Distance-based priority calculation
 * - Automatic memory management
 * - Category-based streaming policies
 * - Debounced priority updates
 * - Debug statistics & logging
 */

import type * as pc from 'playcanvas';
import { TextureHandle } from './TextureHandle';
import { TextureRegistry } from './TextureRegistry';
import { CategoryManager } from './CategoryManager';
import { MemoryTracker } from './MemoryTracker';
import { SimpleScheduler } from './SimpleScheduler';
import type {
  TextureCategory,
  TextureRegistration,
  StreamingManagerConfig,
  StreamingStats,
  CategoryConfig,
  PriorityContext,
} from './types';

/**
 * Default streaming manager configuration
 */
const DEFAULT_CONFIG: StreamingManagerConfig = {
  maxMemoryMB: 512,               // 512MB VRAM budget
  maxConcurrent: 4,                // 4 parallel loads
  priorityUpdateInterval: 0.5,     // 500ms debounce
  distanceWeight: 1000,            // Distance scaling factor
  debugLogging: false,             // Disable debug logs by default
  logPriorityChanges: false,       // Disable priority change logs by default
};

export class TextureStreamingManager {
  // PlayCanvas application
  private app: pc.Application;

  // Subsystems
  private registry: TextureRegistry;
  private categoryManager: CategoryManager;
  private memoryTracker: MemoryTracker;
  private scheduler: SimpleScheduler;

  // Configuration & state
  private config: StreamingManagerConfig;
  private priorityUpdateTimer: number = 0;
  private isDestroyed: boolean = false;

  // Performance tracking
  private lastPriorityUpdate: number = 0;
  private totalRegistered: number = 0;
  private totalUnregistered: number = 0;

  constructor(app: pc.Application, config?: Partial<StreamingManagerConfig>) {
    this.app = app;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize subsystems in order
    this.registry = new TextureRegistry();
    this.categoryManager = new CategoryManager();
    this.memoryTracker = new MemoryTracker(
      this.registry,
      this.categoryManager,
      this.config.maxMemoryMB
    );
    this.scheduler = new SimpleScheduler(
      this.config.maxConcurrent,
      this.memoryTracker
    );

    if (this.config.debugLogging) {
      this.log('TextureStreamingManager initialized');
      console.log('[TextureStreamingManager] Config:', this.config);
    }
  }

  // ===========================================================================
  // Texture Registration
  // ===========================================================================

  /**
   * Register a new texture for streaming
   *
   * @param options Texture registration options
   * @returns TextureHandle for the registered texture
   */
  register(options: TextureRegistration): TextureHandle {
    if (this.isDestroyed) {
      throw new Error('[TextureStreamingManager] Cannot register texture after destroy');
    }

    const { id, category } = options;

    // Check if already registered
    if (this.registry.has(id)) {
      this.log(`Texture "${id}" already registered, returning existing handle`);
      return this.registry.get(id)!;
    }

    // Merge global libktx URLs with per-texture options
    const mergedOptions = {
      ...options,
      loaderConfig: {
        ...options.loaderConfig,
        libktxModuleUrl: options.loaderConfig?.libktxModuleUrl || this.config.libktxModuleUrl,
        libktxWasmUrl: options.loaderConfig?.libktxWasmUrl || this.config.libktxWasmUrl,
      },
    };

    // Create handle
    const handle = new TextureHandle(this.app, mergedOptions);

    // Add to registry
    this.registry.register(handle);
    this.totalRegistered++;

    this.log(`Registered texture "${id}" (category: ${category})`);

    // Check if should load immediately
    const categoryConfig = this.categoryManager.getConfig(category);
    if (categoryConfig.loadImmediately) {
      this.log(`Auto-loading ${category} texture "${id}"`);

      // Calculate initial priority
      const priority = this.calculateTexturePriority(handle);
      handle.setPriority(priority);

      // Enqueue for loading
      this.scheduler.enqueue(handle, priority);
      this.registry.updateState(id, 'queued');
    }

    return handle;
  }

  /**
   * Unregister a texture
   *
   * @param id Texture ID to unregister
   * @returns true if unregistered, false if not found
   */
  unregister(id: string): boolean {
    const handle = this.registry.get(id);
    if (!handle) {
      this.log(`Texture "${id}" not found for unregistration`);
      return false;
    }

    // Cancel if loading
    if (this.scheduler.isLoading(id) || this.scheduler.isQueued(id)) {
      this.scheduler.dequeue(id);
    }

    // Destroy handle (unloads texture)
    handle.destroy();

    // Remove from registry
    const removed = this.registry.unregister(id);
    if (removed) {
      this.totalUnregistered++;
      this.log(`Unregistered texture "${id}"`);
    }

    return removed;
  }

  /**
   * Unregister all textures in a category
   *
   * @param category Category to clear
   */
  unregisterCategory(category: TextureCategory): void {
    const handles = this.registry.getByCategory(category);
    this.log(`Unregistering ${handles.length} textures from category "${category}"`);

    for (const handle of handles) {
      this.unregister(handle.id);
    }
  }

  /**
   * Unregister all textures for an entity
   *
   * @param entity Entity to clear textures for
   */
  unregisterEntity(entity: pc.Entity): void {
    const entityGuid = entity.getGuid();
    const handles = this.registry.getByEntity(entityGuid);
    this.log(`Unregistering ${handles.length} textures for entity ${entityGuid}`);

    for (const handle of handles) {
      this.unregister(handle.id);
    }
  }

  // ===========================================================================
  // Update Loop (call every frame)
  // ===========================================================================

  /**
   * Update streaming manager (call every frame)
   *
   * @param dt Delta time in seconds
   */
  update(dt: number): void {
    if (this.isDestroyed) return;

    // Update priority calculation timer
    this.priorityUpdateTimer += dt;

    // Recalculate priorities (debounced)
    if (this.priorityUpdateTimer >= this.config.priorityUpdateInterval) {
      this.updatePriorities();
      this.priorityUpdateTimer = 0;
    }

    // Handle memory pressure
    if (this.memoryTracker.needsEviction()) {
      const pressure = this.memoryTracker.getMemoryPressure();
      this.log(`Memory pressure detected: ${pressure}`, 'warn');
      this.memoryTracker.evict();
    }
  }

  /**
   * Recalculate priorities for all textures
   */
  private updatePriorities(): void {
    const now = Date.now();
    const camera = this.app.root.findByName('Camera') || this.app.root.findComponent('camera');

    if (!camera) {
      this.log('No camera found, skipping priority update', 'warn');
      return;
    }

    const cameraEntity = (camera as any).entity || camera;
    const cameraPosition = cameraEntity.getPosition();

    // Build priority context
    const context: PriorityContext = {
      cameraPosition,
      now,
      categoryWeights: this.categoryManager.getAllPriorityWeights(),
      distanceWeight: this.config.distanceWeight,
    };

    // Update all dynamic textures
    const dynamicTextures = this.registry.getByCategory('dynamic');
    let updatedCount = 0;

    for (const handle of dynamicTextures) {
      const oldPriority = handle.priority;
      const result = handle.calculatePriority(context);

      // Update scheduler queue if priority changed significantly
      const priorityChange = Math.abs(result.priority - oldPriority);
      if (priorityChange > 10) {
        // Update queue priority if queued
        if (this.scheduler.isQueued(handle.id)) {
          this.scheduler.updatePriority(handle.id, result.priority);
          updatedCount++;
        }

        // Log if enabled
        if (this.config.logPriorityChanges) {
          this.log(
            `Priority updated for "${handle.id}": ${oldPriority.toFixed(0)} -> ${result.priority.toFixed(0)} ` +
            `(distance: ${result.distance.toFixed(1)}m)`
          );
        }
      }

      // Enqueue if not loaded and not already queued/loading
      if (!handle.isLoaded && !handle.isLoading) {
        this.scheduler.enqueue(handle, result.priority);
        this.registry.updateState(handle.id, 'queued');
      }
    }

    this.lastPriorityUpdate = now;

    if (updatedCount > 0) {
      this.log(`Updated ${updatedCount} texture priorities`);
    }
  }

  // ===========================================================================
  // Priority Calculation
  // ===========================================================================

  /**
   * Calculate priority for a single texture
   *
   * Priority formula: (1 / (1 + distance * 0.1)) * categoryWeight * userWeight * distanceWeight
   *
   * @param handle Texture handle
   * @returns Calculated priority value
   */
  private calculateTexturePriority(handle: TextureHandle): number {
    const camera = this.app.root.findByName('Camera') || this.app.root.findComponent('camera');

    if (!camera) {
      // Fallback to category weight if no camera
      return this.categoryManager.getPriorityWeight(handle.category);
    }

    const cameraEntity = (camera as any).entity || camera;
    const cameraPosition = cameraEntity.getPosition();

    const context: PriorityContext = {
      cameraPosition,
      now: Date.now(),
      categoryWeights: this.categoryManager.getAllPriorityWeights(),
      distanceWeight: this.config.distanceWeight,
    };

    const result = handle.calculatePriority(context);
    return result.priority;
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Update global streaming configuration
   *
   * @param config Partial configuration to update
   */
  setConfig(config: Partial<StreamingManagerConfig>): void {
    this.config = { ...this.config, ...config };

    // Apply changes to subsystems
    if (config.maxMemoryMB !== undefined) {
      this.memoryTracker.setMaxMemory(config.maxMemoryMB);
    }

    if (config.maxConcurrent !== undefined) {
      this.scheduler.setMaxConcurrent(config.maxConcurrent);
    }

    if (this.config.debugLogging) {
      this.log('Configuration updated');
      console.log('[TextureStreamingManager] New config:', this.config);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): StreamingManagerConfig {
    return { ...this.config };
  }

  /**
   * Update category configuration
   *
   * @param category Category to update
   * @param config Partial category configuration
   */
  setCategoryConfig(category: TextureCategory, config: Partial<CategoryConfig>): void {
    this.categoryManager.setConfig(category, config);
    if (this.config.debugLogging) {
      this.log(`Category "${category}" configuration updated`);
      console.log('[TextureStreamingManager] Category config:', config);
    }

    // Re-evaluate textures in this category
    const handles = this.registry.getByCategory(category);
    for (const handle of handles) {
      const priority = this.calculateTexturePriority(handle);
      handle.setPriority(priority);

      if (this.scheduler.isQueued(handle.id)) {
        this.scheduler.updatePriority(handle.id, priority);
      }
    }
  }

  /**
   * Get category configuration
   */
  getCategoryConfig(category: TextureCategory): CategoryConfig {
    return this.categoryManager.getConfig(category);
  }

  // ===========================================================================
  // Manual Control
  // ===========================================================================

  /**
   * Manually request to load a texture
   *
   * @param id Texture ID
   * @param priority Optional priority override
   */
  requestLoad(id: string, priority?: number): void {
    const handle = this.registry.get(id);
    if (!handle) {
      this.log(`Cannot load texture "${id}": not registered`, 'warn');
      return;
    }

    if (handle.isLoaded || handle.isLoading) {
      this.log(`Texture "${id}" already loaded or loading`);
      return;
    }

    const effectivePriority = priority ?? this.calculateTexturePriority(handle);
    handle.setPriority(effectivePriority);
    this.scheduler.enqueue(handle, effectivePriority);
    this.registry.updateState(id, 'queued');

    this.log(`Manually queued texture "${id}" with priority ${effectivePriority.toFixed(0)}`);
  }

  /**
   * Manually unload a texture
   *
   * @param id Texture ID
   */
  requestUnload(id: string): void {
    const handle = this.registry.get(id);
    if (!handle) {
      this.log(`Cannot unload texture "${id}": not registered`, 'warn');
      return;
    }

    // Cancel if loading
    if (this.scheduler.isLoading(id) || this.scheduler.isQueued(id)) {
      this.scheduler.dequeue(id);
    }

    // Unload
    if (handle.isLoaded) {
      handle.unload();
      this.log(`Manually unloaded texture "${id}"`);
    }
  }

  /**
   * Set user priority override for a texture
   *
   * @param id Texture ID
   * @param priority User priority (0-2, default 1)
   */
  setUserPriority(id: string, priority: number): void {
    const handle = this.registry.get(id);
    if (!handle) {
      this.log(`Cannot set priority for texture "${id}": not registered`, 'warn');
      return;
    }

    handle.setUserPriority(priority);

    // Recalculate and update
    const newPriority = this.calculateTexturePriority(handle);
    handle.setPriority(newPriority);

    if (this.scheduler.isQueued(id)) {
      this.scheduler.updatePriority(id, newPriority);
    }

    this.log(`Set user priority for "${id}" to ${priority} (effective: ${newPriority.toFixed(0)})`);
  }

  // ===========================================================================
  // Statistics & Debug
  // ===========================================================================

  /**
   * Get comprehensive streaming statistics
   */
  getStats(): StreamingStats {
    const registryStats = this.registry.getStats();
    const schedulerStats = this.scheduler.getStats();
    const memoryStats = this.memoryTracker.getStats();

    // Calculate priority distribution
    const allHandles = this.registry.getAll();
    const priorityDistribution = {
      high: 0,    // priority > 500
      medium: 0,  // priority 100-500
      low: 0,     // priority < 100
    };

    for (const handle of allHandles) {
      const p = handle.priority;
      if (p > 500) priorityDistribution.high++;
      else if (p >= 100) priorityDistribution.medium++;
      else priorityDistribution.low++;
    }

    return {
      // Counts
      totalTextures: registryStats.total,
      unloaded: registryStats.states.unloaded,
      queued: registryStats.states.queued,
      loading: registryStats.states.loading,
      partial: registryStats.states.partial,
      loaded: registryStats.states.loaded,
      error: registryStats.states.error,

      // Memory
      memoryUsed: memoryStats.used,
      memoryLimit: memoryStats.limit,
      memoryUsagePercent: memoryStats.usagePercent,

      // Performance
      activeLoads: schedulerStats.activeLoads,
      maxConcurrent: schedulerStats.maxConcurrent,
      averageLoadTime: schedulerStats.averageLoadTime,

      // Categories
      categoryStats: {
        persistent: {
          count: registryStats.categories.persistent,
          memoryUsed: registryStats.memory.persistent,
          loaded: this.registry.getLoadedCountByCategory('persistent'),
        },
        level: {
          count: registryStats.categories.level,
          memoryUsed: registryStats.memory.level,
          loaded: this.registry.getLoadedCountByCategory('level'),
        },
        dynamic: {
          count: registryStats.categories.dynamic,
          memoryUsed: registryStats.memory.dynamic,
          loaded: this.registry.getLoadedCountByCategory('dynamic'),
        },
      },

      // Priority distribution
      priorityDistribution,
    };
  }

  /**
   * Get detailed debug information
   */
  getDebugInfo(): any {
    const stats = this.getStats();

    return {
      config: this.config,
      stats,
      categoryConfigs: this.categoryManager.getAllConfigs(),
      memoryPressure: this.memoryTracker.getMemoryPressure(),
      queueSize: this.scheduler.getQueueSize(),
      timeSinceLastPriorityUpdate: Date.now() - this.lastPriorityUpdate,
      totalRegistered: this.totalRegistered,
      totalUnregistered: this.totalUnregistered,
    };
  }

  /**
   * Print debug statistics to console
   */
  debug(): void {
    console.group('[TextureStreamingManager] Debug Info');

    const stats = this.getStats();

    console.log('Configuration:', this.config);
    console.log('Textures:', {
      total: stats.totalTextures,
      loaded: stats.loaded,
      loading: stats.loading,
      queued: stats.queued,
      unloaded: stats.unloaded,
      error: stats.error,
    });
    console.log('Memory:', {
      used: `${(stats.memoryUsed / 1024 / 1024).toFixed(2)} MB`,
      limit: `${(stats.memoryLimit / 1024 / 1024).toFixed(2)} MB`,
      usage: `${stats.memoryUsagePercent.toFixed(1)}%`,
      pressure: this.memoryTracker.getMemoryPressure(),
    });
    console.log('Loading:', {
      active: stats.activeLoads,
      queued: this.scheduler.getQueueSize(),
      avgTime: `${stats.averageLoadTime.toFixed(0)}ms`,
    });
    console.log('Categories:', stats.categoryStats);
    console.log('Priority Distribution:', stats.priorityDistribution);

    console.groupEnd();
  }

  /**
   * Get handle by ID (for debugging)
   */
  getHandle(id: string): TextureHandle | undefined {
    return this.registry.get(id);
  }

  /**
   * Get all handles (for debugging)
   */
  getAllHandles(): TextureHandle[] {
    return this.registry.getAll();
  }

  // ===========================================================================
  // Logging
  // ===========================================================================

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info', data?: any): void {
    if (!this.config.debugLogging && level === 'info') return;

    const prefix = '[TextureStreamingManager]';

    if (level === 'error') {
      console.error(prefix, message, data ?? '');
    } else if (level === 'warn') {
      console.warn(prefix, message, data ?? '');
    } else {
      console.log(prefix, message, data ?? '');
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Destroy streaming manager and all textures
   */
  destroy(): void {
    if (this.isDestroyed) return;

    this.log('Destroying TextureStreamingManager');

    // Clear scheduler
    this.scheduler.clear();

    // Clear registry (destroys all handles)
    this.registry.clear();

    // Reset state
    this.isDestroyed = true;
    this.priorityUpdateTimer = 0;

    this.log('TextureStreamingManager destroyed');
  }
}

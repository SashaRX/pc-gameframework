/**
 * Texture streaming coordinator
 * Manages progressive texture loading with KTX2 loader
 */

import type * as pc from 'playcanvas';
import type { Ktx2ProgressiveLoader } from '../ktx2-loader/Ktx2ProgressiveLoader';
import type { KtxCacheManager } from '../ktx2-loader/KtxCacheManager';
import type { StreamingContext, TextureDefinition, TextureStreamingConfig } from './types';

interface ActiveLoad {
  loader: Ktx2ProgressiveLoader;
  textureId: string;
  sectorId: string;
  priority: number;
  entity: pc.Entity;
}

export class TextureStreaming {
  private loaderClass: typeof Ktx2ProgressiveLoader;
  private cacheManager?: KtxCacheManager;
  private config: TextureStreamingConfig;
  private activeLoads: Map<string, ActiveLoad> = new Map();
  private verbose: boolean;

  constructor(
    loaderClass: typeof Ktx2ProgressiveLoader,
    cacheManager?: KtxCacheManager,
    config?: Partial<TextureStreamingConfig>
  ) {
    this.loaderClass = loaderClass;
    this.cacheManager = cacheManager;
    this.verbose = config?.enableCache !== undefined;

    // Default configuration
    this.config = {
      defaultMinLevel: 8,
      adaptiveMargin: 1.5,
      stepDelayMs: 100,
      enableCache: true,
      cacheTtlDays: 30,
      ...config,
    };
  }

  /**
   * Load texture progressively with streaming context
   */
  async loadProgressive(
    app: pc.Application,
    entity: pc.Entity,
    textureDef: TextureDefinition,
    context: StreamingContext
  ): Promise<void> {
    const loadId = `${context.sectorId}:${textureDef.id}`;

    // Check if already loading
    if (this.activeLoads.has(loadId)) {
      if (this.verbose) {
        console.log(`[TextureStreaming] Already loading: ${loadId}`);
      }
      return;
    }

    try {
      // Configure loader based on streaming context
      const loaderConfig = {
        ktxUrl: textureDef.url,
        libktxModuleUrl: undefined, // Will use defaults
        libktxWasmUrl: undefined,
        progressive: true,
        stepDelayMs: this.config.stepDelayMs,
        isSrgb: textureDef.isSrgb !== undefined ? textureDef.isSrgb : true,
        adaptiveLoading: context.stopAtScreenRes !== undefined ? context.stopAtScreenRes : true,
        adaptiveMargin: this.config.adaptiveMargin,
        enableCache: this.config.enableCache,
        cacheMaxAgeDays: this.config.cacheTtlDays,
        useWorker: true,
        minFrameInterval: 16, // Target 60 FPS
        logLevel: this.verbose ? 3 : 1,
      };

      // Create loader instance
      const loader = new this.loaderClass(app, loaderConfig);

      // Store active load
      this.activeLoads.set(loadId, {
        loader,
        textureId: textureDef.id,
        sectorId: context.sectorId,
        priority: context.priority,
        entity,
      });

      if (this.verbose) {
        console.log(`[TextureStreaming] Starting load: ${loadId}`, {
          url: textureDef.url,
          minLevel: context.minLevel,
          maxLevel: context.maxLevel,
          priority: context.priority,
        });
      }

      // Initialize loader
      await loader.initialize();

      // Set priority if specified
      if (context.priority !== undefined) {
        loader.setPriority(context.priority);
      }

      // Start progressive loading
      await loader.loadToEntity(entity);

      if (this.verbose) {
        console.log(`[TextureStreaming] Completed load: ${loadId}`);
      }

      // Remove from active loads
      this.activeLoads.delete(loadId);
    } catch (err) {
      console.error(`[TextureStreaming] Failed to load ${loadId}:`, err);
      this.activeLoads.delete(loadId);
      throw err;
    }
  }

  /**
   * Pause loading for a texture
   */
  pause(sectorId: string, textureId: string): void {
    const loadId = `${sectorId}:${textureId}`;
    const activeLoad = this.activeLoads.get(loadId);

    if (activeLoad) {
      activeLoad.loader.pause();
      if (this.verbose) {
        console.log(`[TextureStreaming] Paused: ${loadId}`);
      }
    }
  }

  /**
   * Resume loading for a texture
   */
  resume(sectorId: string, textureId: string): void {
    const loadId = `${sectorId}:${textureId}`;
    const activeLoad = this.activeLoads.get(loadId);

    if (activeLoad) {
      activeLoad.loader.resume();
      if (this.verbose) {
        console.log(`[TextureStreaming] Resumed: ${loadId}`);
      }
    }
  }

  /**
   * Cancel loading for a texture
   */
  cancel(sectorId: string, textureId: string): void {
    const loadId = `${sectorId}:${textureId}`;
    const activeLoad = this.activeLoads.get(loadId);

    if (activeLoad) {
      activeLoad.loader.pause();
      activeLoad.loader.destroy();
      this.activeLoads.delete(loadId);

      if (this.verbose) {
        console.log(`[TextureStreaming] Cancelled: ${loadId}`);
      }
    }
  }

  /**
   * Cancel all loads for a sector
   */
  cancelSector(sectorId: string): void {
    const toCancel: string[] = [];

    for (const [loadId, activeLoad] of this.activeLoads) {
      if (activeLoad.sectorId === sectorId) {
        toCancel.push(loadId);
      }
    }

    for (const loadId of toCancel) {
      const [sid, tid] = loadId.split(':');
      this.cancel(sid, tid);
    }

    if (this.verbose && toCancel.length > 0) {
      console.log(`[TextureStreaming] Cancelled ${toCancel.length} loads for sector: ${sectorId}`);
    }
  }

  /**
   * Update priority for active loads
   */
  updatePriority(sectorId: string, priority: number): void {
    for (const [loadId, activeLoad] of this.activeLoads) {
      if (activeLoad.sectorId === sectorId) {
        activeLoad.priority = priority;
        activeLoad.loader.setPriority(priority);
      }
    }
  }

  /**
   * Get active load count
   */
  getActiveLoadCount(): number {
    return this.activeLoads.size;
  }

  /**
   * Get active loads for a sector
   */
  getSectorActiveLoads(sectorId: string): number {
    let count = 0;
    for (const activeLoad of this.activeLoads.values()) {
      if (activeLoad.sectorId === sectorId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if a texture is loading
   */
  isLoading(sectorId: string, textureId: string): boolean {
    const loadId = `${sectorId}:${textureId}`;
    return this.activeLoads.has(loadId);
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    if (!this.cacheManager) {
      return null;
    }
    return await this.cacheManager.getCacheStats();
  }

  /**
   * Clear texture cache
   */
  async clearCache(): Promise<void> {
    if (this.cacheManager) {
      await this.cacheManager.clear();
      if (this.verbose) {
        console.log('[TextureStreaming] Cache cleared');
      }
    }
  }

  /**
   * Cleanup all active loads
   */
  destroy(): void {
    for (const [loadId, activeLoad] of this.activeLoads) {
      activeLoad.loader.pause();
      activeLoad.loader.destroy();
    }
    this.activeLoads.clear();

    if (this.verbose) {
      console.log('[TextureStreaming] Destroyed');
    }
  }
}

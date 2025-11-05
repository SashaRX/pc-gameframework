/**
 * PlayCanvas Script for World Streaming System
 * Manages progressive sector-based world loading
 */

import type * as pc from 'playcanvas';
import * as pcRuntime from 'playcanvas';
import { StreamingManager } from '../streaming/StreamingManager';
import { StreamingEvent } from '../streaming/types';

// Script class exists at runtime but not exported in types
const Script = (pcRuntime as any).Script;

export class WorldStreamingScript extends Script {
  static scriptName = 'worldStreaming';

  declare app: pc.Application;
  declare entity: pc.Entity;

  /**
   * @attribute
   * @description Name of the camera entity to track
   */
  cameraEntityName = 'Camera';

  /**
   * @attribute
   * @range [50, 200]
   * @description Size of grid cell in world units
   */
  gridSize = 100;

  /**
   * @attribute
   * @range [100, 1000]
   * @description View distance for loading sectors
   */
  viewDistance = 300;

  /**
   * @attribute
   * @range [1, 10]
   * @description Maximum concurrent sector loads
   */
  maxConcurrentLoads = 3;

  /**
   * @attribute
   * @range [100, 2000]
   * @description Memory budget in MB
   */
  memoryBudgetMB = 500;

  /**
   * @attribute
   * @range [50, 500]
   * @description Priority radius for high-detail loading
   */
  priorityRadius = 150;

  /**
   * @attribute
   * @description Enable verbose logging
   */
  verbose = false;

  /**
   * @attribute
   * @description Enable debug visualization
   */
  debugVisualization = false;

  /**
   * @attribute
   * @range [5, 11]
   * @description Default minimum mip level for textures
   */
  textureMinLevel = 8;

  /**
   * @attribute
   * @range [1.0, 3.0]
   * @description Adaptive margin for texture loading
   */
  textureAdaptiveMargin = 1.5;

  /**
   * @attribute
   * @range [50, 500]
   * @description Step delay between mip loads (ms)
   */
  textureStepDelayMs = 100;

  /**
   * @attribute
   * @description Enable texture caching
   */
  enableTextureCache = true;

  /**
   * @attribute
   * @range [1, 90]
   * @description Texture cache TTL in days
   */
  textureCacheTtlDays = 30;

  private streamingManager: StreamingManager | null = null;
  private camera: pc.Entity | null = null;
  private lastUpdateTime = 0;
  private updateInterval = 0.1; // Update every 100ms

  async initialize() {
    console.log('[WorldStreaming] Initializing...');

    try {
      // Find camera
      this.camera = this.app.root.findByName(this.cameraEntityName) as pc.Entity;
      if (!this.camera) {
        console.error(`[WorldStreaming] Camera not found: ${this.cameraEntityName}`);
        return;
      }

      // Create streaming manager
      this.streamingManager = new StreamingManager(this.app);

      // Initialize with config
      this.streamingManager.initialize(
        {
          gridSize: this.gridSize,
          viewDistance: this.viewDistance,
          maxConcurrentLoads: this.maxConcurrentLoads,
          memoryBudget: this.memoryBudgetMB,
          priorityRadius: this.priorityRadius,
          debug: this.debugVisualization,
          verbose: this.verbose,
        },
        {
          defaultMinLevel: this.textureMinLevel,
          adaptiveMargin: this.textureAdaptiveMargin,
          stepDelayMs: this.textureStepDelayMs,
          enableCache: this.enableTextureCache,
          cacheTtlDays: this.textureCacheTtlDays,
        }
      );

      // Register event listeners
      this.streamingManager.on(StreamingEvent.SectorLoadComplete, (event) => {
        if (this.verbose) {
          console.log('[WorldStreaming] Sector loaded:', event.sectorId, {
            time: event.loadTime ? `${event.loadTime.toFixed(2)}ms` : 'N/A',
            memory: event.memoryUsage ? `${(event.memoryUsage / 1024 / 1024).toFixed(2)}MB` : 'N/A',
          });
        }
        this.app.fire('streaming:sector:loaded', event);
      });

      this.streamingManager.on(StreamingEvent.SectorUnloaded, (event) => {
        if (this.verbose) {
          console.log('[WorldStreaming] Sector unloaded:', event.sectorId);
        }
        this.app.fire('streaming:sector:unloaded', event);
      });

      this.streamingManager.on(StreamingEvent.SectorLoadFailed, (event) => {
        console.error('[WorldStreaming] Sector load failed:', event.sectorId, event.error);
        this.app.fire('streaming:sector:failed', event);
      });

      this.streamingManager.on(StreamingEvent.MemoryWarning, (event) => {
        console.warn('[WorldStreaming] Memory budget exceeded');
        this.app.fire('streaming:memory:warning', event);
      });

      // Register master materials (if any exist in the scene)
      this.registerMasterMaterials();

      console.log('[WorldStreaming] Initialized successfully');
    } catch (error) {
      console.error('[WorldStreaming] Initialization error:', error);
      this.app.fire('streaming:error', error);
    }
  }

  update(dt: number) {
    if (!this.streamingManager || !this.camera) return;

    // Throttle updates
    this.lastUpdateTime += dt;
    if (this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = 0;

    // Update streaming manager with camera position
    const cameraPos = this.camera.getPosition();
    const cameraDir = this.camera.forward;

    this.streamingManager.updateCamera(cameraPos, cameraDir, dt);

    // Debug visualization
    if (this.debugVisualization) {
      this.drawDebugInfo();
    }
  }

  /**
   * Register master materials from the scene
   * Look for entities tagged with "master_material"
   */
  private registerMasterMaterials() {
    if (!this.streamingManager) return;

    // Find all entities with master_material tag
    const masterMaterialEntities = this.app.root.findByTag('master_material') as pc.Entity[];

    for (const entity of masterMaterialEntities) {
      if ((entity as any).model && (entity as any).model.meshInstances.length > 0) {
        const material = (entity as any).model.meshInstances[0].material;
        const materialId = entity.name;

        this.streamingManager.registerMasterMaterial(materialId, material);

        if (this.verbose) {
          console.log('[WorldStreaming] Registered master material:', materialId);
        }
      }
    }
  }

  /**
   * Draw debug information
   */
  private drawDebugInfo() {
    if (!this.streamingManager || !this.camera) return;

    // Get memory stats
    const memoryStats = this.streamingManager.getMemoryUsage();

    // Draw debug text (use app.drawText if available)
    const debugText = [
      `Sectors Loaded: ${this.streamingManager.getLoadedSectorCount()}`,
      `Sectors Loading: ${this.streamingManager.getLoadingSectorCount()}`,
      `Memory: ${memoryStats.totalUsedMB.toFixed(2)}MB / ${memoryStats.budgetMB}MB`,
      `Camera: ${this.camera.getPosition().toString()}`,
    ].join('\n');

    // Fire event for UI to display
    this.app.fire('streaming:debug', {
      text: debugText,
      stats: memoryStats,
    });
  }

  /**
   * Manually load a sector (callable from other scripts)
   */
  async loadSector(sectorId: string, priority: number = 5): Promise<void> {
    if (!this.streamingManager) {
      console.error('[WorldStreaming] Manager not initialized');
      return;
    }

    await this.streamingManager.loadSectorByScript(sectorId, priority);
  }

  /**
   * Manually unload a sector (callable from other scripts)
   */
  unloadSector(sectorId: string): void {
    if (!this.streamingManager) {
      console.error('[WorldStreaming] Manager not initialized');
      return;
    }

    this.streamingManager.unloadSectorByScript(sectorId);
  }

  /**
   * Get sector status
   */
  getSectorStatus(sectorId: string): string {
    if (!this.streamingManager) {
      return 'unloaded';
    }

    return this.streamingManager.getSectorStatus(sectorId);
  }

  /**
   * Get memory usage
   */
  getMemoryUsage() {
    if (!this.streamingManager) {
      return null;
    }

    return this.streamingManager.getMemoryUsage();
  }

  onDestroy() {
    console.log('[WorldStreaming] Destroying...');

    if (this.streamingManager) {
      this.streamingManager.destroy();
      this.streamingManager = null;
    }
  }
}

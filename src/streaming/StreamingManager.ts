/**
 * Streaming Manager - coordinates sector loading and unloading
 * Main entry point for the streaming system
 */

import * as pc from 'playcanvas';
import type {
  StreamingConfig,
  LoadedSector,
  MemoryStats,
  SectorLoadEvent,
  TextureStreamingConfig,
} from './types';
import { SectorStatus, StreamingEvent } from './types';
import { SectorLoader } from './SectorLoader';
import { AssetSource } from './AssetSource';
import { MaterialFactory } from './MaterialFactory';
import { TextureStreaming } from './TextureStreaming';
import { MemoryManager } from './MemoryManager';
import { Ktx2ProgressiveLoader } from '../ktx2-loader/Ktx2ProgressiveLoader';
import {
  worldToGrid,
  gridToSectorId,
  getSectorIdsInRange,
  getGridCenter,
} from './utils/grid';
import { calculateSectorPriority, calculateLodLevel } from './utils/priority';

type EventCallback = (event: SectorLoadEvent) => void;

export class StreamingManager {
  private app: pc.Application;
  private config: StreamingConfig;
  private textureConfig: TextureStreamingConfig;

  // Core components
  private assetSource: AssetSource;
  private materialFactory: MaterialFactory;
  private textureStreaming: TextureStreaming;
  private memoryManager: MemoryManager;

  // Sector management
  private loadedSectors: Map<string, LoadedSector> = new Map();
  private sectorLoaders: Map<string, SectorLoader> = new Map();
  private loadingSectors: Set<string> = new Set();

  // Camera state
  private lastCameraPos: pc.Vec3 | null = null;
  private lastCameraDir: pc.Vec3 | null = null;
  private cameraVelocity: pc.Vec3 = new pc.Vec3();

  // Event system
  private eventCallbacks: Map<StreamingEvent, EventCallback[]> = new Map();

  // Update control
  private lastUpdateTime = 0;
  private updateInterval = 0.5; // seconds

  private verbose: boolean;
  private initialized = false;

  constructor(app: pc.Application) {
    this.app = app;

    // Default config (will be overridden by initialize())
    this.config = {
      gridSize: 100,
      viewDistance: 300,
      maxConcurrentLoads: 3,
      memoryBudget: 500,
      priorityRadius: 150,
      debug: false,
      verbose: false,
    };

    this.textureConfig = {
      defaultMinLevel: 8,
      adaptiveMargin: 1.5,
      stepDelayMs: 100,
      enableCache: true,
      cacheTtlDays: 30,
    };

    this.verbose = false;

    // Initialize components (will be properly set up in initialize())
    this.assetSource = new AssetSource(app, false);
    this.materialFactory = new MaterialFactory(app, false);
    this.textureStreaming = new TextureStreaming(Ktx2ProgressiveLoader);
    this.memoryManager = new MemoryManager(500);
  }

  /**
   * Initialize the streaming system
   */
  initialize(config: Partial<StreamingConfig>, textureConfig?: Partial<TextureStreamingConfig>): void {
    // Merge config
    this.config = { ...this.config, ...config };
    if (textureConfig) {
      this.textureConfig = { ...this.textureConfig, ...textureConfig };
    }

    this.verbose = this.config.verbose || false;

    // Re-initialize components with config
    this.assetSource = new AssetSource(this.app, this.verbose);
    this.materialFactory = new MaterialFactory(this.app, this.verbose);
    this.textureStreaming = new TextureStreaming(
      Ktx2ProgressiveLoader,
      undefined,
      this.textureConfig
    );
    this.memoryManager = new MemoryManager(this.config.memoryBudget);

    this.initialized = true;

    if (this.verbose) {
      console.log('[StreamingManager] Initialized with config:', {
        gridSize: this.config.gridSize,
        viewDistance: this.config.viewDistance,
        maxConcurrent: this.config.maxConcurrentLoads,
        memoryBudget: `${this.config.memoryBudget}MB`,
      });
    }
  }

  /**
   * Register a master material
   */
  registerMasterMaterial(id: string, material: pc.Material): void {
    this.materialFactory.registerMaster(id, material);
  }

  /**
   * Update camera position and trigger sector loading/unloading
   */
  updateCamera(position: pc.Vec3, direction: pc.Vec3, deltaTime?: number): void {
    if (!this.initialized) {
      console.warn('[StreamingManager] Not initialized. Call initialize() first.');
      return;
    }

    // Calculate velocity if we have previous position
    if (this.lastCameraPos && deltaTime) {
      this.cameraVelocity.copy(position).sub(this.lastCameraPos).mulScalar(1 / deltaTime);
    }

    this.lastCameraPos = position.clone();
    this.lastCameraDir = direction.clone();

    // Throttle updates
    const now = performance.now() / 1000;
    if (now - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = now;

    // Update sector streaming
    this.updateSectorStreaming();
  }

  /**
   * Main update logic for sector streaming
   */
  private async updateSectorStreaming(): Promise<void> {
    if (!this.lastCameraPos || !this.lastCameraDir) return;

    // Get sectors in range
    const sectorsInRange = getSectorIdsInRange(
      this.lastCameraPos,
      this.config.viewDistance,
      this.config.gridSize
    );

    // Calculate priorities for all sectors
    const sectorPriorities = sectorsInRange.map((sectorId) => {
      const gridCoords = worldToGrid(this.lastCameraPos!, this.config.gridSize);
      const sectorCenter = getGridCenter(gridCoords, this.config.gridSize);

      const priorityInfo = calculateSectorPriority(
        sectorCenter,
        this.lastCameraPos!,
        this.lastCameraDir!,
        this.config.viewDistance,
        this.cameraVelocity
      );

      return { sectorId, ...priorityInfo };
    });

    // Sort by priority (highest first)
    sectorPriorities.sort((a, b) => b.priority - a.priority);

    // Update loaded sectors
    for (const { sectorId, distance, priority } of sectorPriorities) {
      const loaded = this.loadedSectors.get(sectorId);

      if (loaded) {
        // Update existing sector
        loaded.distance = distance;
        loaded.priority = priority;
        loaded.lastAccessed = Date.now();
        this.memoryManager.updatePriority(sectorId, priority);

        // Update LOD if needed
        const targetLod = calculateLodLevel(
          distance,
          this.config.priorityRadius,
          this.config.viewDistance
        );

        if (targetLod !== loaded.currentLod) {
          const loader = this.sectorLoaders.get(sectorId);
          if (loader) {
            try {
              await loader.updateLod(targetLod);
              this.emitEvent(StreamingEvent.SectorLodChanged, {
                sectorId,
                status: loaded.status,
              });
            } catch (err) {
              console.error(`[StreamingManager] Failed to update LOD for ${sectorId}:`, err);
            }
          }
        }
      } else {
        // Load new sector (if not already loading)
        if (!this.loadingSectors.has(sectorId)) {
          // Check if we can load more sectors concurrently
          if (this.loadingSectors.size < this.config.maxConcurrentLoads) {
            this.loadSector(sectorId, distance, priority);
          }
        }
      }
    }

    // Unload sectors out of range
    const loadedSectorIds = Array.from(this.loadedSectors.keys());
    for (const sectorId of loadedSectorIds) {
      if (!sectorsInRange.includes(sectorId)) {
        this.unloadSector(sectorId);
      }
    }

    // Check memory budget
    if (this.memoryManager.isOverBudget()) {
      const toUnload = this.memoryManager.getSectorsToUnload();
      for (const sectorId of toUnload) {
        this.unloadSector(sectorId);
      }
      this.emitEvent(StreamingEvent.MemoryWarning, {
        sectorId: 'memory',
        status: SectorStatus.Unloaded,
      });
    }
  }

  /**
   * Load a sector by ID
   */
  private async loadSector(sectorId: string, distance: number, priority: number): Promise<void> {
    if (this.loadedSectors.has(sectorId) || this.loadingSectors.has(sectorId)) {
      return; // Already loaded or loading
    }

    this.loadingSectors.add(sectorId);

    if (this.verbose) {
      console.log(`[StreamingManager] Loading sector: ${sectorId}`, { distance, priority });
    }

    this.emitEvent(StreamingEvent.SectorLoadStart, {
      sectorId,
      status: SectorStatus.Loading,
    });

    const startTime = performance.now();

    try {
      // Create sector loader
      const loader = new SectorLoader(
        this.app,
        sectorId,
        this.assetSource,
        this.materialFactory,
        this.textureStreaming,
        this.verbose
      );

      this.sectorLoaders.set(sectorId, loader);

      // Load manifest
      await loader.loadManifest();

      // Calculate initial LOD
      const lodLevel = calculateLodLevel(
        distance,
        this.config.priorityRadius,
        this.config.viewDistance
      );

      // Load sector
      const loadedSector = await loader.load(lodLevel, priority);
      loadedSector.distance = distance;
      loadedSector.priority = priority;

      // Add to scene
      this.app.root.addChild(loadedSector.entity);

      // Register with managers
      this.loadedSectors.set(sectorId, loadedSector);
      this.memoryManager.registerSector(sectorId, loadedSector, loadedSector.memoryUsage);

      const loadTime = performance.now() - startTime;

      this.emitEvent(StreamingEvent.SectorLoadComplete, {
        sectorId,
        status: loadedSector.status,
        loadTime,
        memoryUsage: loadedSector.memoryUsage,
      });

      if (this.verbose) {
        console.log(`[StreamingManager] Sector loaded: ${sectorId} (${loadTime.toFixed(2)}ms)`);
      }
    } catch (err) {
      console.error(`[StreamingManager] Failed to load sector ${sectorId}:`, err);
      this.emitEvent(StreamingEvent.SectorLoadFailed, {
        sectorId,
        status: SectorStatus.Failed,
        error: err as Error,
      });
    } finally {
      this.loadingSectors.delete(sectorId);
    }
  }

  /**
   * Manually load a sector by script
   */
  async loadSectorByScript(sectorId: string, priority: number = 5): Promise<void> {
    if (this.loadedSectors.has(sectorId)) {
      return; // Already loaded
    }

    await this.loadSector(sectorId, 0, priority);
  }

  /**
   * Unload a sector
   */
  private unloadSector(sectorId: string): void {
    const loaded = this.loadedSectors.get(sectorId);
    if (!loaded) return;

    if (this.verbose) {
      console.log(`[StreamingManager] Unloading sector: ${sectorId}`);
    }

    // Get loader and unload
    const loader = this.sectorLoaders.get(sectorId);
    if (loader) {
      loader.unload();
    }

    // Cleanup
    this.loadedSectors.delete(sectorId);
    this.sectorLoaders.delete(sectorId);
    this.memoryManager.unregisterSector(sectorId);

    this.emitEvent(StreamingEvent.SectorUnloaded, {
      sectorId,
      status: SectorStatus.Unloaded,
    });
  }

  /**
   * Manually unload a sector by script
   */
  unloadSectorByScript(sectorId: string): void {
    this.unloadSector(sectorId);
  }

  /**
   * Get sector status
   */
  getSectorStatus(sectorId: string): SectorStatus {
    const loaded = this.loadedSectors.get(sectorId);
    if (loaded) {
      return loaded.status;
    }
    if (this.loadingSectors.has(sectorId)) {
      return SectorStatus.Loading;
    }
    return SectorStatus.Unloaded;
  }

  /**
   * Get memory usage statistics
   */
  getMemoryUsage(): MemoryStats {
    return this.memoryManager.getStats();
  }

  /**
   * Register event callback
   */
  on(event: StreamingEvent, callback: EventCallback): void {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, []);
    }
    this.eventCallbacks.get(event)!.push(callback);
  }

  /**
   * Emit event
   */
  private emitEvent(event: StreamingEvent, data: SectorLoadEvent): void {
    const callbacks = this.eventCallbacks.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(data);
      }
    }
  }

  /**
   * Get loaded sector count
   */
  getLoadedSectorCount(): number {
    return this.loadedSectors.size;
  }

  /**
   * Get loading sector count
   */
  getLoadingSectorCount(): number {
    return this.loadingSectors.size;
  }

  /**
   * Get all loaded sector IDs
   */
  getLoadedSectorIds(): string[] {
    return Array.from(this.loadedSectors.keys());
  }

  /**
   * Cleanup all resources
   */
  destroy(): void {
    if (this.verbose) {
      console.log('[StreamingManager] Destroying...');
    }

    // Unload all sectors
    const sectorIds = Array.from(this.loadedSectors.keys());
    for (const sectorId of sectorIds) {
      this.unloadSector(sectorId);
    }

    // Clear managers
    this.memoryManager.clear();
    this.materialFactory.clearCache();
    this.textureStreaming.destroy();

    this.initialized = false;
  }
}

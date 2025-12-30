/**
 * LodManager - Manage model LODs based on camera distance
 *
 * Workflow:
 * 1. When model registered, load initial LOD (the one with maxDistance: null)
 * 2. Track entities with LOD models
 * 3. On update, check distance to camera
 * 4. Load/switch to appropriate LOD
 */

import type * as pc from 'playcanvas';
import { MappingLoader } from './MappingLoader';
import { CacheManager } from './CacheManager';
import { MeshoptLoader } from '../libs/meshoptimizer/MeshoptLoader';
import { LodConfig } from './MappingTypes';

interface TrackedModel {
  assetId: string;
  entity: pc.Entity;
  lods: LodState[];
  currentLodIndex: number;
  materialIds: number[];
}

interface LodState {
  config: LodConfig;
  asset: pc.Asset | null;
  loaded: boolean;
  loading: boolean;
}

export interface LodManagerConfig {
  /** Update interval in ms */
  updateInterval?: number;
  /** Hysteresis to prevent LOD flickering (units) */
  hysteresis?: number;
  /** Debug logging */
  debug?: boolean;
}

const DEFAULT_CONFIG: LodManagerConfig = {
  updateInterval: 200,
  hysteresis: 5,
  debug: false,
};

export class LodManager {
  private app: pc.Application;
  private mapping: MappingLoader;
  private cache: CacheManager;
  private config: LodManagerConfig;

  private trackedModels = new Map<string, TrackedModel>();
  private camera: pc.Entity | null = null;
  private updateIntervalId: number | null = null;

  constructor(app: pc.Application, config: Partial<LodManagerConfig> = {}) {
    this.app = app;
    this.mapping = MappingLoader.getInstance();
    this.cache = CacheManager.getInstance();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[LodManager]', ...args);
    }
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Set camera for distance calculations
   */
  setCamera(camera: pc.Entity): void {
    this.camera = camera;
    this.log('Camera set:', camera.name);
  }

  /**
   * Find camera in scene
   */
  findCamera(): pc.Entity | null {
    const cameras = this.app.root.findComponents('camera') as pc.CameraComponent[];
    if (cameras.length > 0) {
      this.camera = cameras[0].entity;
      this.log('Camera found:', this.camera.name);
      return this.camera;
    }
    return null;
  }

  /**
   * Start update loop
   */
  start(): void {
    if (this.updateIntervalId) return;

    this.updateIntervalId = window.setInterval(() => {
      this.update();
    }, this.config.updateInterval);

    this.log('Started');
  }

  /**
   * Stop update loop
   */
  stop(): void {
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = null;
    }
    this.log('Stopped');
  }

  // ============================================================================
  // Model Registration
  // ============================================================================

  /**
   * Register entity with LOD model
   */
  async registerEntity(entity: pc.Entity, assetId: string | number): Promise<void> {
    const id = String(assetId);

    // Get LOD configs
    const lodConfigs = this.mapping.getModelLods(id);
    if (lodConfigs.length === 0) {
      this.log(`No LODs for model ${id}`);
      return;
    }

    // Get material IDs
    const materialIds = this.mapping.getModelMaterialIds(id);

    // Create tracked model
    const tracked: TrackedModel = {
      assetId: id,
      entity,
      lods: lodConfigs.map((config) => ({
        config,
        asset: null,
        loaded: false,
        loading: false,
      })),
      currentLodIndex: -1,
      materialIds,
    };

    this.trackedModels.set(entity.getGuid(), tracked);

    // Load initial LOD
    const initialIndex = this.mapping.getInitialLodIndex(id);
    await this.loadLod(tracked, initialIndex);
    this.applyLod(tracked, initialIndex);

    this.log(`Registered entity: ${entity.name}, model: ${id}, initial LOD: ${initialIndex}`);
  }

  /**
   * Unregister entity
   */
  unregisterEntity(entity: pc.Entity): void {
    const guid = entity.getGuid();
    const tracked = this.trackedModels.get(guid);

    if (tracked) {
      // Don't destroy assets - they might be shared
      this.trackedModels.delete(guid);
      this.log(`Unregistered entity: ${entity.name}`);
    }
  }

  // ============================================================================
  // LOD Loading
  // ============================================================================

  /**
   * Load specific LOD level
   */
  private async loadLod(tracked: TrackedModel, lodIndex: number): Promise<void> {
    const lodState = tracked.lods[lodIndex];
    if (!lodState || lodState.loaded || lodState.loading) return;

    lodState.loading = true;

    try {
      const url = this.mapping.getLodUrl(lodState.config);
      this.log(`Loading LOD ${lodIndex} for ${tracked.assetId}: ${url}`);

      // Check cache
      const cacheKey = `model:${tracked.assetId}:lod${lodIndex}`;
      const cached = await this.cache.get(cacheKey);
      let arrayBuffer: ArrayBuffer;

      if (cached && cached.data instanceof ArrayBuffer) {
        arrayBuffer = cached.data;
      } else {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        arrayBuffer = await response.arrayBuffer();

        await this.cache.set({
          id: cacheKey,
          type: 'model',
          data: arrayBuffer,
          size: arrayBuffer.byteLength,
          timestamp: Date.now(),
        });
      }

      // Init meshopt if needed
      await this.initMeshoptIfNeeded(arrayBuffer);

      // Parse GLB
      const asset = await this.parseGLB(
        `${tracked.assetId}_lod${lodIndex}`,
        arrayBuffer
      );

      lodState.asset = asset;
      lodState.loaded = true;

      this.log(`LOD ${lodIndex} loaded for ${tracked.assetId}`);
    } catch (error) {
      console.error(`[LodManager] Failed to load LOD ${lodIndex}:`, error);
    } finally {
      lodState.loading = false;
    }
  }

  private async initMeshoptIfNeeded(arrayBuffer: ArrayBuffer): Promise<void> {
    try {
      const view = new DataView(arrayBuffer);
      if (view.getUint32(0, true) !== 0x46546c67) return; // 'glTF'

      const jsonLength = view.getUint32(12, true);
      const jsonBytes = new Uint8Array(arrayBuffer, 20, jsonLength);
      const jsonStr = new TextDecoder().decode(jsonBytes);

      if (jsonStr.includes('EXT_meshopt_compression')) {
        const meshopt = MeshoptLoader.getInstance();
        await meshopt.initialize(this.app, this.config.debug);
      }
    } catch {}
  }

  private parseGLB(name: string, arrayBuffer: ArrayBuffer): Promise<pc.Asset> {
    return new Promise((resolve, reject) => {
      const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
      const blobUrl = URL.createObjectURL(blob);

      const AssetClass =
        (this.app.assets as any).constructor?.Asset ||
        (globalThis as any).pc?.Asset;

      const asset = new AssetClass(name, 'container', {
        url: blobUrl,
        filename: `${name}.glb`,
      }) as pc.Asset;

      asset.on('load', () => {
        URL.revokeObjectURL(blobUrl);
        resolve(asset);
      });

      asset.on('error', (err: string) => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(err));
      });

      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });
  }

  // ============================================================================
  // LOD Switching
  // ============================================================================

  /**
   * Apply LOD to entity
   */
  private applyLod(tracked: TrackedModel, lodIndex: number): void {
    const lodState = tracked.lods[lodIndex];
    if (!lodState?.loaded || !lodState.asset) return;

    const entity = tracked.entity;
    const resource = lodState.asset.resource as any;

    // Get or create render component
    let render = entity.render;
    if (!render) {
      entity.addComponent('render', { type: 'asset' });
      render = entity.render;
    }

    if (!render) return;

    // Apply renders
    const renders = resource?.renders;
    if (renders && renders.length > 0) {
      render.asset = renders[0].id;
    }

    tracked.currentLodIndex = lodIndex;
    this.log(`Applied LOD ${lodIndex} to ${entity.name}`);
  }

  // ============================================================================
  // Update Loop
  // ============================================================================

  /**
   * Update LODs based on camera distance
   */
  private update(): void {
    if (!this.camera) return;

    const cameraPos = this.camera.getPosition();

    for (const [guid, tracked] of this.trackedModels) {
      if (!tracked.entity.enabled) continue;

      const entityPos = tracked.entity.getPosition();
      const distance = cameraPos.distance(entityPos);

      // Determine target LOD
      const targetLod = this.selectLod(tracked, distance);

      if (targetLod !== tracked.currentLodIndex) {
        this.switchLod(tracked, targetLod);
      }
    }
  }

  /**
   * Select LOD based on distance
   */
  private selectLod(tracked: TrackedModel, distance: number): number {
    const lods = tracked.lods;
    const hysteresis = this.config.hysteresis || 0;

    // Add hysteresis to current LOD to prevent flickering
    const adjustedDistance =
      distance + (tracked.currentLodIndex >= 0 ? hysteresis : 0);

    for (let i = 0; i < lods.length; i++) {
      const maxDist = lods[i].config.maxDistance;
      if (maxDist !== null && adjustedDistance < maxDist) {
        return i;
      }
    }

    return lods.length - 1;
  }

  /**
   * Switch to target LOD
   */
  private async switchLod(tracked: TrackedModel, targetIndex: number): Promise<void> {
    const lodState = tracked.lods[targetIndex];

    if (!lodState.loaded && !lodState.loading) {
      await this.loadLod(tracked, targetIndex);
    }

    if (lodState.loaded) {
      this.applyLod(tracked, targetIndex);
    }
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  getTrackedCount(): number {
    return this.trackedModels.size;
  }

  getCurrentLod(entity: pc.Entity): number {
    const tracked = this.trackedModels.get(entity.getGuid());
    return tracked?.currentLodIndex ?? -1;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  destroy(): void {
    this.stop();
    this.trackedModels.clear();
  }
}

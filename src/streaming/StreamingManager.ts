/**
 * StreamingManager - Main coordinator for asset streaming
 *
 * Responsibilities:
 * - Load manifest at startup
 * - Scan templates for asset references
 * - Coordinate loading of models, materials, textures
 * - Manage memory budgets
 * - Update LODs based on camera distance
 */

import type * as pc from 'playcanvas';
import { AssetManifest } from './AssetManifest';
import { CacheManager } from './CacheManager';
import { ModelLoader, LoadedModel } from './loaders/ModelLoader';
import { MaterialLoader, LoadedMaterial } from './loaders/MaterialLoader';
import { TextureLoader, LoadedTexture } from './loaders/TextureLoader';
import { StreamingConfig, DEFAULT_STREAMING_CONFIG, EntityAssetRefs } from './types';

interface TrackedEntity {
  entity: pc.Entity;
  modelId?: string;
  materialIds: string[];
  distance: number;
  visible: boolean;
  lastUpdate: number;
}

export class StreamingManager {
  private app: pc.Application;
  private config: StreamingConfig;

  // Sub-systems
  private manifest: AssetManifest;
  private cache: CacheManager;
  private modelLoader: ModelLoader;
  private materialLoader: MaterialLoader;
  private textureLoader: TextureLoader;

  // Tracking
  private trackedEntities = new Map<string, TrackedEntity>();
  private camera: pc.Entity | null = null;

  // State
  private initialized = false;
  private updating = false;
  private updateInterval: number | null = null;

  constructor(app: pc.Application, config: Partial<StreamingConfig> = {}) {
    this.app = app;
    this.config = { ...DEFAULT_STREAMING_CONFIG, ...config };

    // Initialize singletons
    this.manifest = AssetManifest.getInstance();
    this.cache = CacheManager.getInstance(
      this.config.maxTextureMemoryMB + this.config.maxModelMemoryMB,
      this.config.useIndexedDB
    );

    // Initialize loaders
    this.modelLoader = new ModelLoader(app, this.config.debug);
    this.materialLoader = new MaterialLoader(app, this.config.debug);
    this.textureLoader = new TextureLoader(app, {
      libktxModuleUrl: this.config.libktxModuleUrl,
      libktxWasmUrl: this.config.libktxWasmUrl,
      maxConcurrent: this.config.maxConcurrent,
      debug: this.config.debug,
    });
  }

  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[StreamingManager]', ...args);
    }
  }

  /**
   * Initialize the streaming system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.log('Initializing...');

    // Validate required URLs
    if (!this.config.manifestUrl) {
      throw new Error('[StreamingManager] manifestUrl is required');
    }
    if (!this.config.libktxModuleUrl || !this.config.libktxWasmUrl) {
      throw new Error('[StreamingManager] libktx URLs are required');
    }

    // Initialize cache
    await this.cache.init();

    // Load manifest
    await this.manifest.load(this.config.manifestUrl);

    // Register master materials
    this.materialLoader.registerMastersFromAssets('Master_');

    // Find camera
    this.findCamera();

    // Start update loop
    this.startUpdateLoop();

    this.initialized = true;
    this.log('Initialized');
  }

  /**
   * Find main camera in scene
   */
  private findCamera(): void {
    const cameras = this.app.root.findComponents('camera') as pc.CameraComponent[];
    if (cameras.length > 0) {
      this.camera = cameras[0].entity;
      this.log('Found camera:', this.camera.name);
    }
  }

  /**
   * Set camera manually
   */
  setCamera(camera: pc.Entity): void {
    this.camera = camera;
  }

  // ============================================================================
  // Template Processing
  // ============================================================================

  /**
   * Process instantiated template - scan and load assets
   */
  async processTemplate(instance: pc.Entity, templateName?: string): Promise<void> {
    this.log(`Processing template: ${templateName || instance.name}`);

    // Scan all entities in hierarchy
    const refs = this.scanEntityHierarchy(instance);

    this.log(`Found refs:`, {
      entities: refs.length,
      models: [...new Set(refs.map((r) => r.modelId).filter(Boolean))].length,
      materials: [...new Set(refs.flatMap((r) => r.materialIds))].length,
    });

    // Track entities
    for (const ref of refs) {
      this.trackEntity(ref);
    }

    // Queue initial loads
    await this.loadAssetsForRefs(refs);
  }

  /**
   * Scan entity hierarchy for asset references
   */
  private scanEntityHierarchy(root: pc.Entity): EntityAssetRefs[] {
    const refs: EntityAssetRefs[] = [];

    const scan = (entity: pc.Entity, path: string) => {
      const entityPath = path ? `${path}/${entity.name}` : entity.name;

      // Check for render component
      const render = entity.render;
      if (render) {
        const ref: EntityAssetRefs = {
          entityId: entity.getGuid(),
          entityPath,
          materialIds: [],
          textureIds: [],
        };

        // Get model reference (from entity tags or custom data)
        const modelTag = entity.tags.has('model:')
          ? entity.tags.list().find((t) => t.startsWith('model:'))
          : null;
        if (modelTag) {
          ref.modelId = modelTag.replace('model:', '');
        }

        // Get material references
        const materialTags = entity.tags.list().filter((t) => t.startsWith('material:'));
        ref.materialIds = materialTags.map((t) => t.replace('material:', ''));

        // Get direct texture references
        const textureTags = entity.tags.list().filter((t) => t.startsWith('texture:'));
        ref.textureIds = textureTags.map((t) => t.replace('texture:', ''));

        refs.push(ref);
      }

      // Recurse children
      for (const child of entity.children as pc.Entity[]) {
        scan(child, entityPath);
      }
    };

    scan(root, '');
    return refs;
  }

  /**
   * Track entity for LOD updates
   */
  private trackEntity(ref: EntityAssetRefs): void {
    const entity = this.app.root.findByGuid(ref.entityId) as pc.Entity;
    if (!entity) return;

    this.trackedEntities.set(ref.entityId, {
      entity,
      modelId: ref.modelId,
      materialIds: ref.materialIds,
      distance: Infinity,
      visible: false,
      lastUpdate: 0,
    });
  }

  /**
   * Load assets for entity refs
   */
  private async loadAssetsForRefs(refs: EntityAssetRefs[]): Promise<void> {
    // Collect unique IDs
    const modelIds = [...new Set(refs.map((r) => r.modelId).filter(Boolean))] as string[];
    const materialIds = [...new Set(refs.flatMap((r) => r.materialIds))];
    const textureIds = [...new Set(refs.flatMap((r) => r.textureIds))];

    // Load models
    const modelPromises = modelIds.map((id) =>
      this.modelLoader.load(id).catch((err) => {
        console.error(`[StreamingManager] Failed to load model ${id}:`, err);
        return null;
      })
    );

    // Load materials
    const materialPromises = materialIds.map((id) =>
      this.materialLoader.load(id).catch((err) => {
        console.error(`[StreamingManager] Failed to load material ${id}:`, err);
        return null;
      })
    );

    // Wait for models and materials
    const [models, materials] = await Promise.all([
      Promise.all(modelPromises),
      Promise.all(materialPromises),
    ]);

    // Collect texture IDs from materials
    for (const mat of materials) {
      if (mat) {
        textureIds.push(...Object.values(mat.textureSlots));
      }
    }

    // Load textures (start at low LOD)
    const uniqueTextureIds = [...new Set(textureIds)];
    const texturePromises = uniqueTextureIds.map((id) =>
      this.textureLoader.load(id, 6).catch((err) => {
        // Start at LOD 6
        console.error(`[StreamingManager] Failed to load texture ${id}:`, err);
        return null;
      })
    );

    await Promise.all(texturePromises);

    // Apply to entities
    this.applyAssetsToEntities(refs);
  }

  /**
   * Apply loaded assets to entities
   */
  private applyAssetsToEntities(refs: EntityAssetRefs[]): void {
    for (const ref of refs) {
      const entity = this.app.root.findByGuid(ref.entityId) as pc.Entity;
      if (!entity) continue;

      // Apply model
      if (ref.modelId) {
        const model = this.modelLoader.getLoaded(ref.modelId);
        if (model) {
          this.modelLoader.applyToEntity(model, entity);
        }
      }

      // Apply materials
      if (ref.materialIds.length > 0 && entity.render) {
        const meshInstances = entity.render.meshInstances || [];

        for (let i = 0; i < ref.materialIds.length && i < meshInstances.length; i++) {
          const mat = this.materialLoader.getLoaded(ref.materialIds[i]);
          if (mat) {
            meshInstances[i].material = mat.material;

            // Apply textures to material
            for (const [slot, textureId] of Object.entries(mat.textureSlots)) {
              const texture = this.textureLoader.getTexture(textureId);
              if (texture) {
                this.materialLoader.setTexture(mat.material, slot, texture);
              }
            }
          }
        }
      }
    }

    this.log('Applied assets to entities');
  }

  // ============================================================================
  // Update Loop
  // ============================================================================

  /**
   * Start LOD update loop
   */
  private startUpdateLoop(): void {
    if (this.updateInterval) return;

    this.updateInterval = window.setInterval(() => {
      this.update();
    }, 100); // 10 updates per second

    this.log('Update loop started');
  }

  /**
   * Stop update loop
   */
  stopUpdateLoop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Main update - calculate distances, update LODs
   */
  private update(): void {
    if (this.updating || !this.camera) return;
    this.updating = true;

    const cameraPos = this.camera.getPosition();
    const now = Date.now();

    for (const [id, tracked] of this.trackedEntities) {
      // Calculate distance
      const entityPos = tracked.entity.getPosition();
      tracked.distance = cameraPos.distance(entityPos);

      // Check visibility (simple frustum check)
      tracked.visible = this.isVisible(tracked.entity);

      // Update texture LODs
      if (tracked.visible && now - tracked.lastUpdate > 500) {
        this.updateEntityLods(tracked);
        tracked.lastUpdate = now;
      }
    }

    this.updating = false;
  }

  /**
   * Simple visibility check
   */
  private isVisible(entity: pc.Entity): boolean {
    // TODO: Proper frustum culling
    return entity.enabled;
  }

  /**
   * Update LODs for entity based on distance
   */
  private updateEntityLods(tracked: TrackedEntity): void {
    if (!tracked.entity.render) return;

    const meshInstances = tracked.entity.render.meshInstances || [];

    for (const mi of meshInstances) {
      const mat = mi.material as pc.StandardMaterial;
      if (!mat) continue;

      // Check each texture slot
      for (const slot of ['diffuseMap', 'normalMap']) {
        const texture = (mat as any)[slot] as pc.Texture;
        if (!texture) continue;

        // LOD is handled automatically by Ktx2ProgressiveLoader adaptive loading
        // based on entity screen size
      }
    }
  }

  /**
   * Find texture ID by texture object
   */
  private findTextureId(texture: pc.Texture): string | null {
    // Linear search through loaded textures
    for (const [id, loaded] of this.textureLoader['loadedTextures']) {
      if (loaded.texture === texture) {
        return id;
      }
    }
    return null;
  }

  /**
   * Calculate approximate screen size of entity
   */
  private calculateScreenSize(entity: pc.Entity, distance: number): number {
    // Rough estimate based on distance
    const fov = 45;
    const screenHeight = this.app.graphicsDevice.height;
    const entitySize = 1; // Assume 1 unit size

    const projectedSize = (entitySize / distance) * (screenHeight / (2 * Math.tan((fov * Math.PI) / 360)));

    return Math.max(1, projectedSize);
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Manually load a model
   */
  async loadModel(modelId: string): Promise<LoadedModel | null> {
    try {
      return await this.modelLoader.load(modelId);
    } catch (err) {
      console.error(`[StreamingManager] Failed to load model ${modelId}:`, err);
      return null;
    }
  }

  /**
   * Manually load a material
   */
  async loadMaterial(materialId: string): Promise<LoadedMaterial | null> {
    try {
      return await this.materialLoader.load(materialId);
    } catch (err) {
      console.error(`[StreamingManager] Failed to load material ${materialId}:`, err);
      return null;
    }
  }

  /**
   * Manually load a texture
   */
  async loadTexture(textureId: string, targetLod = 0): Promise<LoadedTexture | null> {
    try {
      return await this.textureLoader.load(textureId, targetLod);
    } catch (err) {
      console.error(`[StreamingManager] Failed to load texture ${textureId}:`, err);
      return null;
    }
  }

  /**
   * Get statistics
   */
  getStats(): object {
    return {
      models: this.modelLoader.getStats(),
      materials: this.materialLoader.getStats(),
      textures: this.textureLoader.getStats(),
      cache: this.cache.getStats(),
      trackedEntities: this.trackedEntities.size,
    };
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.stopUpdateLoop();
    this.textureLoader.destroy();
    this.trackedEntities.clear();
    this.log('Destroyed');
  }
}

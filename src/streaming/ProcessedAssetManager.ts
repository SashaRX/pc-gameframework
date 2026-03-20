/**
 * ProcessedAssetManager - Main coordinator for processed asset loading
 *
 * This is the main entry point that ties everything together:
 * 1. Load mapping.json
 * 2. Register assets with original IDs
 * 3. Compile master materials
 * 4. Handle template instantiation
 * 5. Load models with LOD
 * 6. Load materials with instances
 * 7. Load textures (including packed OGM)
 *
 * See docs/MAPPING_SPEC.md for configuration details
 */

import type * as pc from 'playcanvas';
import { MappingLoader } from './MappingLoader';
import { AssetRegistrar } from './AssetRegistrar';
import { MaterialInstanceLoader } from './MaterialInstanceLoader';
import { LodManager } from './LodManager';
import { CacheManager } from './CacheManager';
import { Ktx2ProgressiveLoader } from '../loaders/Ktx2ProgressiveLoader';
import { LoadedMaterialInstance, isPackedTextureKey } from './MappingTypes';
import { NwStats } from '../debug/NwStats';

export interface ProcessedAssetManagerConfig {
  /** URL to mapping.json */
  mappingUrl: string;
  /** libktx module URL */
  libktxModuleUrl: string;
  /** libktx WASM URL */
  libktxWasmUrl: string;
  /** Master material prefix in asset registry (if not using masterMaterials in mapping) */
  masterMaterialPrefix?: string;
  /** Max concurrent texture loads */
  maxConcurrentTextures?: number;
  /** Enable IndexedDB caching */
  useIndexedDB?: boolean;
  /** Debug logging */
  debug?: boolean;
}

const DEFAULT_CONFIG: Partial<ProcessedAssetManagerConfig> = {
  masterMaterialPrefix: 'master_',
  maxConcurrentTextures: 4,
  useIndexedDB: true,
  debug: false,
};

export class ProcessedAssetManager {
  private app: pc.Application;
  private config: ProcessedAssetManagerConfig;

  // Sub-systems
  private mapping: MappingLoader;
  private registrar: AssetRegistrar;
  private materialLoader: MaterialInstanceLoader;
  private lodManager: LodManager;
  private cache: CacheManager;

  // Texture loading
  private textureLoaders = new Map<string, Ktx2ProgressiveLoader>();
  private loadedTextures = new Map<string, pc.Texture>();
  private loadingTextures = new Map<string, Promise<pc.Texture>>();
  private activeTextureLoads = 0;

  // State
  private initialized = false;

  constructor(app: pc.Application, config: ProcessedAssetManagerConfig) {
    this.app = app;
    this.config = { ...DEFAULT_CONFIG, ...config } as ProcessedAssetManagerConfig;

    // Initialize sub-systems
    this.mapping = MappingLoader.getInstance();
    this.cache = CacheManager.getInstance(512, this.config.useIndexedDB);
    this.registrar = new AssetRegistrar(app, { debug: this.config.debug });
    this.materialLoader = new MaterialInstanceLoader(app, { debug: this.config.debug });
    this.lodManager = new LodManager(app, { debug: this.config.debug });

    // Init NwStats — mounts app.stats.nw and activates pc.Tracing if debug build
    NwStats.init(app);
  }

  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[ProcessedAssetManager]', ...args);
    }
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the system
   * Call this BEFORE loading scene
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.log('Initializing...');

    // 1. Init cache
    await this.cache.init();

    // 2. Load mapping
    await this.mapping.load(this.config.mappingUrl);

    // 3. Register all assets with original IDs
    this.registrar.registerAll();

    // 4. Register master materials
    // Try from mapping first, fall back to prefix search
    if (this.mapping.getMasterMaterialNames().length > 0) {
      this.materialLoader.registerMastersFromMapping();
    } else if (this.config.masterMaterialPrefix) {
      this.materialLoader.registerMastersFromAssets(this.config.masterMaterialPrefix);
    }

    // 5. Find camera for LOD
    this.lodManager.findCamera();

    // 6. Start LOD update loop
    this.lodManager.start();

    this.initialized = true;
    this.log('Initialized');
  }

  /**
   * Set camera for LOD calculations
   */
  setCamera(camera: pc.Entity): void {
    this.lodManager.setCamera(camera);
  }

  // ============================================================================
  // MiniStats
  // ============================================================================

  /**
   * Create MiniStats overlay pre-configured with NW pipeline graphs.
   * Requires pc.MiniStats (available in debug launch or extras bundle).
   *
   * @param startSizeIndex 0=small, 1=medium, 2=large
   */
  createMiniStats(startSizeIndex = 1): any {
    return NwStats.createMiniStats(this.app, startSizeIndex);
  }

  // ============================================================================
  // Template Processing
  // ============================================================================

  /**
   * Process instantiated template
   * Scans for asset references and loads them
   */
  async processTemplate(templateInstance: pc.Entity): Promise<void> {
    this.log(`Processing template: ${templateInstance.name}`);

    // Collect all entities with render components
    const entities = this.findRenderEntities(templateInstance);

    // Process each entity
    for (const entity of entities) {
      await this.processEntity(entity);
    }

    // Update LOD tracked count in stats
    NwStats.setLodTracked(this.lodManager.getTrackedCount());

    this.log(`Template processed: ${templateInstance.name}`);
  }

  /**
   * Find all entities with render components
   */
  private findRenderEntities(root: pc.Entity): pc.Entity[] {
    const result: pc.Entity[] = [];

    const scan = (entity: pc.Entity) => {
      if (entity.render) {
        result.push(entity);
      }
      for (const child of entity.children as pc.Entity[]) {
        scan(child);
      }
    };

    scan(root);
    return result;
  }

  /**
   * Process single entity
   */
  private async processEntity(entity: pc.Entity): Promise<void> {
    const render = entity.render;
    if (!render) return;

    // Get model asset ID
    const modelAssetId = (render as any).asset;
    if (!modelAssetId) return;

    const modelId = String(modelAssetId);

    // Check if this model is in our mapping
    if (!this.mapping.hasModel(modelId)) {
      this.log(`Model ${modelId} not in mapping, skipping`);
      return;
    }

    // Register with LOD manager
    await this.lodManager.registerEntity(entity, modelId);

    // Get material IDs from mapping
    const materialIds = this.mapping.getModelMaterialIds(modelId);

    // Load materials
    for (const matId of materialIds) {
      await this.loadMaterial(matId);
    }

    // Apply materials to mesh instances
    await this.applyMaterials(entity, materialIds);
  }

  // ============================================================================
  // Material Loading
  // ============================================================================

  /**
   * Load material by ID
   */
  async loadMaterial(assetId: number | string): Promise<void> {
    const id = String(assetId);

    // Load material instance
    const instance = await this.materialLoader.load(id);

    // Load textures for this material
    await this.loadMaterialTextures(instance);
  }

  /**
   * Load all textures for a material
   */
  private async loadMaterialTextures(instance: LoadedMaterialInstance): Promise<void> {
    const slots = this.materialLoader.getTextureSlots(instance);

    for (const slot of slots) {
      const ref = this.materialLoader.getTextureRef(instance, slot);
      if (ref === null) continue;

      // Get texture URL from mapping (works for both asset IDs and packed keys)
      const url = this.mapping.getTextureUrl(ref);
      if (!url) {
        this.log(`Texture not found in mapping: ${ref}`);
        continue;
      }

      const texture = await this.loadTexture(url);
      if (texture) {
        // Apply texture to material slot
        (instance.material as any)[slot] = texture;
        instance.material.update();
        this.log(`Applied texture to ${instance.id}.${slot}`);
      }
    }

    instance.texturesLoaded = true;
  }

  /**
   * Load texture from URL
   */
  private async loadTexture(url: string): Promise<pc.Texture | null> {
    // Already loaded?
    const existing = this.loadedTextures.get(url);
    if (existing) return existing;

    // Already loading?
    const loading = this.loadingTextures.get(url);
    if (loading) return loading;

    // Wait for slot
    while (this.activeTextureLoads >= (this.config.maxConcurrentTextures || 4)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Start loading
    this.activeTextureLoads++;
    NwStats.onTextureLoadStart();
    const promise = this.doLoadTexture(url);
    this.loadingTextures.set(url, promise);

    try {
      const texture = await promise;
      this.loadedTextures.set(url, texture);
      NwStats.onTextureLoadEnd(false);
      return texture;
    } catch (e) {
      NwStats.onTextureLoadEnd(true);
      throw e;
    } finally {
      this.activeTextureLoads--;
      this.loadingTextures.delete(url);
    }
  }

  private async doLoadTexture(url: string): Promise<pc.Texture> {
    this.log(`Loading texture: ${url}`);

    const loader = new Ktx2ProgressiveLoader(this.app, {
      ktxUrl: url,
      libktxModuleUrl: this.config.libktxModuleUrl,
      libktxWasmUrl: this.config.libktxWasmUrl,
      verbose: this.config.debug,
      useWorker: true,
      progressive: true,
      adaptiveLoading: true,
    });

    this.textureLoaders.set(url, loader);

    await loader.initialize();

    // Create temp entity for loading
    const tempEntity = new (this.app.root.constructor as any)('temp_tex') as pc.Entity;
    tempEntity.addComponent('render', { type: 'box' });

    const texture = await loader.loadToEntity(tempEntity);
    tempEntity.destroy();

    if (!texture) {
      throw new Error(`Failed to load texture: ${url}`);
    }

    return texture;
  }

  // ============================================================================
  // Material Application
  // ============================================================================

  /**
   * Apply materials to entity mesh instances
   */
  private async applyMaterials(entity: pc.Entity, materialIds: number[]): Promise<void> {
    const render = entity.render;
    if (!render) return;

    const meshInstances = render.meshInstances || [];

    for (let i = 0; i < materialIds.length && i < meshInstances.length; i++) {
      const material = this.materialLoader.getMaterial(materialIds[i]);
      if (material) {
        meshInstances[i].material = material;
      }
    }

    this.log(`Applied ${materialIds.length} materials to ${entity.name}`);
  }

  // ============================================================================
  // Stats & Cleanup
  // ============================================================================

  getStats(): object {
    return {
      registrar: this.registrar.getStats(),
      materials: this.materialLoader.getStats(),
      lod: {
        tracked: this.lodManager.getTrackedCount(),
      },
      textures: {
        loaded: this.loadedTextures.size,
        loading: this.loadingTextures.size,
      },
    };
  }

  destroy(): void {
    this.lodManager.destroy();

    for (const loader of this.textureLoaders.values()) {
      loader.destroy();
    }
    this.textureLoaders.clear();

    for (const texture of this.loadedTextures.values()) {
      texture.destroy();
    }
    this.loadedTextures.clear();

    this.log('Destroyed');
  }
}

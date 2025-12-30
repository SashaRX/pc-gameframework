/**
 * AssetRegistrar - Registers placeholder assets with original PlayCanvas IDs
 *
 * This is the KEY component that makes templates work:
 * - Templates reference assets by numeric ID
 * - Original assets are excluded from build
 * - We register assets with same IDs pointing to external server
 * - When template instantiates, app.assets.get(id) finds our registered assets
 */

import type * as pc from 'playcanvas';
import { MappingLoader } from './MappingLoader';

export interface RegistrarConfig {
  /** Register model assets */
  registerModels?: boolean;
  /** Register material assets */
  registerMaterials?: boolean;
  /** Auto-load assets when accessed */
  autoLoad?: boolean;
  /** Debug logging */
  debug?: boolean;
}

const DEFAULT_CONFIG: RegistrarConfig = {
  registerModels: true,
  registerMaterials: true,
  autoLoad: true,
  debug: false,
};

export class AssetRegistrar {
  private app: pc.Application;
  private mapping: MappingLoader;
  private config: RegistrarConfig;

  private registeredModels = new Set<string>();
  private registeredMaterials = new Set<string>();

  constructor(app: pc.Application, config: Partial<RegistrarConfig> = {}) {
    this.app = app;
    this.mapping = MappingLoader.getInstance();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[AssetRegistrar]', ...args);
    }
  }

  // ============================================================================
  // Main Registration
  // ============================================================================

  /**
   * Register all assets from mapping
   * Call this BEFORE loading scene/templates
   */
  registerAll(): void {
    if (!this.mapping.isLoaded()) {
      throw new Error('[AssetRegistrar] MappingLoader not loaded. Call MappingLoader.load() first.');
    }

    if (this.config.registerModels) {
      this.registerAllModels();
    }

    if (this.config.registerMaterials) {
      this.registerAllMaterials();
    }

    this.log('Registration complete:', {
      models: this.registeredModels.size,
      materials: this.registeredMaterials.size,
    });
  }

  // ============================================================================
  // Model Registration
  // ============================================================================

  private registerAllModels(): void {
    const modelIds = this.mapping.getAllModelIds();

    for (const id of modelIds) {
      this.registerModel(id);
    }
  }

  /**
   * Register a model asset with original ID
   */
  registerModel(assetId: string | number): pc.Asset | null {
    const id = String(assetId);
    const numericId = parseInt(id, 10);

    // Already registered?
    if (this.registeredModels.has(id)) {
      return this.app.assets.get(numericId) || null;
    }

    // Check if already exists in registry
    const existing = this.app.assets.get(numericId);
    if (existing) {
      this.log(`Model ${id} already in registry`);
      this.registeredModels.add(id);
      return existing;
    }

    // Get model info from mapping
    const modelMapping = this.mapping.getModel(id);
    if (!modelMapping) {
      this.log(`Model ${id} not in mapping`);
      return null;
    }

    // Get initial LOD (the one to load first)
    const initialLodIndex = this.mapping.getInitialLodIndex(id);
    const lods = this.mapping.getModelLods(id);
    const initialLod = lods[initialLodIndex];

    if (!initialLod) {
      this.log(`Model ${id} has no LODs`);
      return null;
    }

    // Create asset with original ID
    const url = this.mapping.getLodUrlFromConfig(initialLod);
    const asset = this.createAssetWithId(
      numericId,
      modelMapping.name,
      'container',
      url,
      `${modelMapping.name}.glb`
    );

    // Store LOD info on asset for later use
    (asset as any).__lods = lods;
    (asset as any).__currentLod = initialLodIndex;
    (asset as any).__materialIds = modelMapping.materials;

    this.app.assets.add(asset);
    this.registeredModels.add(id);

    this.log(`Registered model: ${id} (${modelMapping.name})`);

    return asset;
  }

  // ============================================================================
  // Material Registration
  // ============================================================================

  private registerAllMaterials(): void {
    const materialIds = this.mapping.getAllMaterialIds();

    for (const id of materialIds) {
      this.registerMaterial(id);
    }
  }

  /**
   * Register a material asset with original ID
   */
  registerMaterial(assetId: string | number): pc.Asset | null {
    const id = String(assetId);
    const numericId = parseInt(id, 10);

    // Already registered?
    if (this.registeredMaterials.has(id)) {
      return this.app.assets.get(numericId) || null;
    }

    // Check if already exists in registry
    const existing = this.app.assets.get(numericId);
    if (existing) {
      this.log(`Material ${id} already in registry`);
      this.registeredMaterials.add(id);
      return existing;
    }

    // Get material URL from mapping
    const url = this.mapping.getMaterialUrl(id);
    if (!url) {
      this.log(`Material ${id} not in mapping`);
      return null;
    }

    // Create asset with original ID
    // Note: We use 'json' type because material instance is JSON
    // The actual pc.StandardMaterial will be created when loaded
    const asset = this.createAssetWithId(
      numericId,
      `material_${id}`,
      'json',
      url,
      `material_${id}.json`
    );

    // Mark as material instance for our loader
    (asset as any).__isMaterialInstance = true;

    this.app.assets.add(asset);
    this.registeredMaterials.add(id);

    this.log(`Registered material: ${id}`);

    return asset;
  }

  // ============================================================================
  // Asset Creation
  // ============================================================================

  /**
   * Create pc.Asset with specific ID
   * This is the key trick - asset.id is writable!
   */
  private createAssetWithId(
    id: number,
    name: string,
    type: string,
    url: string,
    filename: string
  ): pc.Asset {
    // Get Asset constructor
    const AssetClass = (this.app.assets as any).constructor?.Asset ||
      (globalThis as any).pc?.Asset;

    if (!AssetClass) {
      throw new Error('[AssetRegistrar] Cannot find pc.Asset constructor');
    }

    // Create asset
    const asset = new AssetClass(name, type, {
      url,
      filename,
    }) as pc.Asset;

    // Set the ID to original PlayCanvas ID
    // This makes templates find our asset via app.assets.get(id)
    asset.id = id;

    // Disable preload - we control loading
    asset.preload = false;

    return asset;
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  isModelRegistered(assetId: string | number): boolean {
    return this.registeredModels.has(String(assetId));
  }

  isMaterialRegistered(assetId: string | number): boolean {
    return this.registeredMaterials.has(String(assetId));
  }

  getRegisteredModelIds(): string[] {
    return Array.from(this.registeredModels);
  }

  getRegisteredMaterialIds(): string[] {
    return Array.from(this.registeredMaterials);
  }

  // ============================================================================
  // Stats
  // ============================================================================

  getStats(): { models: number; materials: number } {
    return {
      models: this.registeredModels.size,
      materials: this.registeredMaterials.size,
    };
  }
}

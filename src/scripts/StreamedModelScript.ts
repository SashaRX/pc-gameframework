/**
 * StreamedModelScript - PlayCanvas Script Component for streamed models
 *
 * Attach to any entity with a render component in the Editor.
 * Automatically loads model LODs, materials, and textures from mapping.json.
 *
 * Usage in Editor:
 * 1. Add this script to entity with render component
 * 2. Set modelAssetId to the original PlayCanvas model asset ID
 * 3. ProcessedAssetManager will handle the rest
 *
 * Or use auto-detection:
 * - Leave modelAssetId empty
 * - Script will read asset ID from render.asset
 */

import type * as pc from 'playcanvas';
import { MappingLoader } from '../streaming/MappingLoader';
import { MaterialInstanceLoader } from '../streaming/MaterialInstanceLoader';
import { LodManager } from '../streaming/LodManager';

// Script attributes for Editor
interface StreamedModelAttributes {
  /** Model asset ID (leave 0 for auto-detect from render.asset) */
  modelAssetId: number;
  /** Load immediately on enable */
  autoLoad: boolean;
  /** Priority (higher = load first) */
  priority: number;
  /** Initial LOD to show (2 = lowest detail, fastest) */
  initialLod: number;
}

export class StreamedModelScript {
  // PlayCanvas Script properties
  static __name = 'streamedModel';

  // Declare as pc.ScriptType compatible
  app!: pc.Application;
  entity!: pc.Entity;
  enabled!: boolean;

  // Attributes (configured in Editor)
  modelAssetId!: number;
  autoLoad!: boolean;
  priority!: number;
  initialLod!: number;

  // Internal state
  private mapping!: MappingLoader;
  private materialLoader!: MaterialInstanceLoader;
  private lodManager!: LodManager;
  private loaded = false;
  private loading = false;
  private resolvedModelId: string | null = null;

  initialize(): void {
    this.mapping = MappingLoader.getInstance();
    this.materialLoader = new MaterialInstanceLoader(this.app);
    this.lodManager = new LodManager(this.app, {});

    // Resolve model ID
    this.resolvedModelId = this.resolveModelId();

    if (this.autoLoad && this.resolvedModelId) {
      this.load();
    }
  }

  /**
   * Resolve model asset ID from attribute or render component
   */
  private resolveModelId(): string | null {
    // Use explicit attribute if set
    if (this.modelAssetId && this.modelAssetId > 0) {
      return String(this.modelAssetId);
    }

    // Auto-detect from render component
    const render = this.entity.render;
    if (render) {
      const assetId = (render as any).asset;
      if (assetId) {
        return String(assetId);
      }
    }

    console.warn(`[StreamedModelScript] No model ID for entity: ${this.entity.name}`);
    return null;
  }

  /**
   * Load model with LODs and materials
   */
  async load(): Promise<void> {
    if (this.loaded || this.loading || !this.resolvedModelId) return;

    this.loading = true;

    try {
      const modelId = this.resolvedModelId;

      // Check if model is in mapping
      if (!this.mapping.hasModel(modelId)) {
        console.warn(`[StreamedModelScript] Model ${modelId} not in mapping`);
        return;
      }

      // Register with LOD manager
      await this.lodManager.registerEntity(this.entity, modelId);

      // Load materials
      const materialIds = this.mapping.getModelMaterialIds(modelId);
      for (const matId of materialIds) {
        await this.loadMaterial(matId);
      }

      // Apply materials
      this.applyMaterials(materialIds);

      this.loaded = true;
      this.entity.fire('streamedmodel:loaded', { modelId, materialIds });

    } catch (error) {
      console.error(`[StreamedModelScript] Load error:`, error);
      this.entity.fire('streamedmodel:error', error);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Load material by ID
   */
  private async loadMaterial(assetId: number): Promise<void> {
    await this.materialLoader.load(assetId);
  }

  /**
   * Apply materials to mesh instances
   */
  private applyMaterials(materialIds: number[]): void {
    const render = this.entity.render;
    if (!render) return;

    const meshInstances = render.meshInstances || [];

    for (let i = 0; i < materialIds.length && i < meshInstances.length; i++) {
      const material = this.materialLoader.getMaterial(materialIds[i]);
      if (material) {
        meshInstances[i].material = material;
      }
    }
  }

  /**
   * Unload and cleanup
   */
  unload(): void {
    if (!this.loaded) return;

    // Unregister from LOD manager
    if (this.resolvedModelId) {
      this.lodManager.unregisterEntity?.(this.entity);
    }

    this.loaded = false;
    this.entity.fire('streamedmodel:unloaded');
  }

  // Lifecycle
  onEnable(): void {
    if (this.autoLoad && !this.loaded && this.resolvedModelId) {
      this.load();
    }
  }

  onDisable(): void {
    // Optionally unload when disabled
    // this.unload();
  }

  onDestroy(): void {
    this.unload();
  }

  // Getters for external access
  isLoaded(): boolean {
    return this.loaded;
  }

  isLoading(): boolean {
    return this.loading;
  }

  getModelId(): string | null {
    return this.resolvedModelId;
  }
}

// Define script attributes for PlayCanvas Editor
(StreamedModelScript as any).__attributes = [
  {
    name: 'modelAssetId',
    type: 'number',
    default: 0,
    title: 'Model Asset ID',
    description: 'Original PlayCanvas model asset ID. Leave 0 to auto-detect from render.asset',
  },
  {
    name: 'autoLoad',
    type: 'boolean',
    default: true,
    title: 'Auto Load',
    description: 'Load automatically when enabled',
  },
  {
    name: 'priority',
    type: 'number',
    default: 0,
    title: 'Priority',
    description: 'Loading priority (higher = load first)',
  },
  {
    name: 'initialLod',
    type: 'number',
    default: 2,
    title: 'Initial LOD',
    description: 'Initial LOD level (0=highest detail, 2=lowest)',
    min: 0,
    max: 3,
  },
];

// Export for registration
export default StreamedModelScript;

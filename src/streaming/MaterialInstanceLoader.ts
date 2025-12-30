/**
 * MaterialInstanceLoader - Load material instances from JSON
 *
 * Workflow:
 * 1. Load instance JSON from server
 * 2. Find master material by name
 * 3. Clone master (no shader compilation!)
 * 4. Apply params from JSON
 * 5. Queue texture loading (including ORM packed textures)
 */

import type * as pc from 'playcanvas';
import { MappingLoader } from './MappingLoader';
import { CacheManager } from './CacheManager';
import {
  MaterialInstanceJson,
  PackedTextureRef,
  isPackedTextureRef,
  LoadedMaterialInstance,
} from './MappingTypes';

export interface MaterialInstanceLoaderConfig {
  debug?: boolean;
}

export class MaterialInstanceLoader {
  private app: pc.Application;
  private mapping: MappingLoader;
  private cache: CacheManager;
  private debug: boolean;

  private masterMaterials = new Map<string, pc.StandardMaterial>();
  private loadedInstances = new Map<string, LoadedMaterialInstance>();
  private loadingPromises = new Map<string, Promise<LoadedMaterialInstance>>();

  constructor(app: pc.Application, config: MaterialInstanceLoaderConfig = {}) {
    this.app = app;
    this.mapping = MappingLoader.getInstance();
    this.cache = CacheManager.getInstance();
    this.debug = config.debug || false;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[MaterialInstanceLoader]', ...args);
    }
  }

  // ============================================================================
  // Master Material Registration
  // ============================================================================

  /**
   * Register master material by name
   * Call this after master materials are compiled
   */
  registerMaster(name: string, material: pc.StandardMaterial): void {
    this.masterMaterials.set(name, material);
    this.log(`Registered master: ${name}`);
  }

  /**
   * Auto-register masters from asset registry by prefix
   */
  registerMastersFromAssets(prefix = 'master_'): void {
    const assets = this.app.assets.filter((asset: pc.Asset) => {
      return asset.type === 'material' && asset.name.toLowerCase().startsWith(prefix);
    });

    for (const asset of assets) {
      if (asset.resource) {
        const name = asset.name;
        this.masterMaterials.set(name, asset.resource as pc.StandardMaterial);
        this.log(`Auto-registered master: ${name}`);
      }
    }

    this.log(`Total masters: ${this.masterMaterials.size}`);
  }

  getMaster(name: string): pc.StandardMaterial | null {
    return this.masterMaterials.get(name) || null;
  }

  // ============================================================================
  // Instance Loading
  // ============================================================================

  /**
   * Load material instance by PlayCanvas asset ID
   */
  async load(assetId: string | number): Promise<LoadedMaterialInstance> {
    const id = String(assetId);

    // Already loaded?
    const existing = this.loadedInstances.get(id);
    if (existing) {
      return existing;
    }

    // Already loading?
    const loading = this.loadingPromises.get(id);
    if (loading) {
      return loading;
    }

    // Start loading
    const promise = this.doLoad(id);
    this.loadingPromises.set(id, promise);

    try {
      const result = await promise;
      this.loadedInstances.set(id, result);
      return result;
    } finally {
      this.loadingPromises.delete(id);
    }
  }

  private async doLoad(id: string): Promise<LoadedMaterialInstance> {
    // Get URL from mapping
    const url = this.mapping.getMaterialUrl(id);
    if (!url) {
      throw new Error(`[MaterialInstanceLoader] Material ${id} not in mapping`);
    }

    this.log(`Loading instance: ${id} from ${url}`);

    // Check cache
    const cacheKey = `mat:${id}`;
    const cached = await this.cache.get(cacheKey);
    let instanceJson: MaterialInstanceJson;

    if (cached && typeof cached.data === 'object') {
      instanceJson = cached.data as MaterialInstanceJson;
    } else {
      // Fetch from server
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      instanceJson = await response.json();

      // Cache
      await this.cache.set({
        id: cacheKey,
        type: 'material',
        data: instanceJson,
        size: JSON.stringify(instanceJson).length * 2,
        timestamp: Date.now(),
      });
    }

    // Create instance
    return this.createInstance(id, instanceJson);
  }

  /**
   * Create material instance from JSON
   */
  private createInstance(id: string, json: MaterialInstanceJson): LoadedMaterialInstance {
    // Find master
    const master = this.masterMaterials.get(json.master);
    if (!master) {
      throw new Error(`[MaterialInstanceLoader] Master '${json.master}' not found. Registered: ${Array.from(this.masterMaterials.keys()).join(', ')}`);
    }

    // Clone master - NO shader compilation!
    const material = master.clone() as pc.StandardMaterial;
    material.name = `instance_${id}`;

    // Apply params
    if (json.params) {
      this.applyParams(material, json.params);
    }

    // Collect texture paths for later loading
    const texturePaths = new Map<string, string | PackedTextureRef>();
    if (json.textures) {
      for (const [slot, ref] of Object.entries(json.textures)) {
        texturePaths.set(slot, ref);
      }
    }

    this.log(`Created instance: ${id}`, {
      master: json.master,
      params: Object.keys(json.params || {}),
      textures: Array.from(texturePaths.keys()),
    });

    return {
      id,
      material,
      masterName: json.master,
      texturePaths,
      texturesLoaded: false,
    };
  }

  /**
   * Apply parameters to material
   */
  private applyParams(material: pc.StandardMaterial, params: Record<string, any>): void {
    for (const [key, value] of Object.entries(params)) {
      if (key in material) {
        try {
          // Handle color arrays
          if (Array.isArray(value) && value.length === 3 && key.toLowerCase().includes('color') ||
              ['diffuse', 'specular', 'emissive'].includes(key)) {
            const Color = (globalThis as any).pc?.Color;
            if (Color) {
              (material as any)[key] = new Color(value[0], value[1], value[2]);
            }
          } else {
            (material as any)[key] = value;
          }
        } catch (e) {
          console.warn(`[MaterialInstanceLoader] Failed to set ${key}:`, e);
        }
      }
    }

    material.update();
  }

  // ============================================================================
  // Texture Application
  // ============================================================================

  /**
   * Apply loaded texture to material instance
   */
  applyTexture(
    instance: LoadedMaterialInstance,
    slot: string,
    texture: pc.Texture
  ): void {
    const material = instance.material;

    if (slot in material) {
      (material as any)[slot] = texture;
      material.update();
      this.log(`Applied texture to ${instance.id}.${slot}`);
    }
  }

  /**
   * Get texture path for slot
   */
  getTexturePath(instance: LoadedMaterialInstance, slot: string): string | PackedTextureRef | null {
    return instance.texturePaths.get(slot) || null;
  }

  /**
   * Get all texture slots that need loading
   */
  getTextureSlots(instance: LoadedMaterialInstance): string[] {
    return Array.from(instance.texturePaths.keys());
  }

  /**
   * Check if slot has packed texture (ORM)
   */
  isPackedTexture(instance: LoadedMaterialInstance, slot: string): boolean {
    const ref = instance.texturePaths.get(slot);
    return ref ? isPackedTextureRef(ref) : false;
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  isLoaded(assetId: string | number): boolean {
    return this.loadedInstances.has(String(assetId));
  }

  getLoaded(assetId: string | number): LoadedMaterialInstance | null {
    return this.loadedInstances.get(String(assetId)) || null;
  }

  getMaterial(assetId: string | number): pc.StandardMaterial | null {
    return this.loadedInstances.get(String(assetId))?.material || null;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  unload(assetId: string | number): void {
    const id = String(assetId);
    const instance = this.loadedInstances.get(id);

    if (instance) {
      instance.material.destroy();
      this.loadedInstances.delete(id);
      this.log(`Unloaded: ${id}`);
    }
  }

  // ============================================================================
  // Stats
  // ============================================================================

  getStats(): { masters: number; loaded: number; loading: number } {
    return {
      masters: this.masterMaterials.size,
      loaded: this.loadedInstances.size,
      loading: this.loadingPromises.size,
    };
  }
}

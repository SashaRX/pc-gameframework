/**
 * MaterialLoader - Load material instances from JSON
 *
 * Features:
 * - Loads material instance JSON from server
 * - Clones master materials
 * - Applies parameters
 * - Returns texture IDs needed for this material
 */

import type * as pc from 'playcanvas';
import { AssetManifest } from '../AssetManifest';
import { CacheManager } from '../CacheManager';
import { MaterialInstanceData } from '../types';

export interface LoadedMaterial {
  id: string;
  material: pc.StandardMaterial;
  masterName: string;
  textureSlots: Record<string, string>; // slot -> texture ID
}

// Standard texture slots in PlayCanvas
const TEXTURE_SLOTS = [
  'diffuseMap',
  'normalMap',
  'heightMap',
  'glossMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'opacityMap',
  'lightMap',
  'specularMap',
  'specularityFactorMap',
  'clearCoatMap',
  'clearCoatNormalMap',
  'clearCoatGlossMap',
  'sheenMap',
  'sheenGlossMap',
];

export class MaterialLoader {
  private app: pc.Application;
  private manifest: AssetManifest;
  private cache: CacheManager;
  private loadingPromises = new Map<string, Promise<LoadedMaterial>>();
  private loadedMaterials = new Map<string, LoadedMaterial>();
  private masterMaterials = new Map<string, pc.StandardMaterial>();
  private debug: boolean;

  constructor(app: pc.Application, debug = false) {
    this.app = app;
    this.manifest = AssetManifest.getInstance();
    this.cache = CacheManager.getInstance();
    this.debug = debug;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[MaterialLoader]', ...args);
    }
  }

  /**
   * Register a master material (call at startup)
   */
  registerMaster(name: string, material: pc.StandardMaterial): void {
    this.masterMaterials.set(name, material);
    this.log(`Registered master material: ${name}`);
  }

  /**
   * Register master materials from asset registry
   */
  registerMastersFromAssets(prefix = 'Master_'): void {
    const assets = this.app.assets.filter((asset: pc.Asset) => {
      return asset.type === 'material' && asset.name.startsWith(prefix);
    });

    for (const asset of assets) {
      if (asset.resource) {
        const name = asset.name.replace(prefix, '');
        this.masterMaterials.set(name, asset.resource as pc.StandardMaterial);
        this.log(`Auto-registered master: ${name}`);
      }
    }

    this.log(`Total master materials: ${this.masterMaterials.size}`);
  }

  /**
   * Load material instance by ID
   */
  async load(materialId: string): Promise<LoadedMaterial> {
    // Already loaded?
    const existing = this.loadedMaterials.get(materialId);
    if (existing) {
      this.log(`Using cached material: ${materialId}`);
      return existing;
    }

    // Already loading?
    const loadingPromise = this.loadingPromises.get(materialId);
    if (loadingPromise) {
      return loadingPromise;
    }

    // Start loading
    const promise = this.doLoad(materialId);
    this.loadingPromises.set(materialId, promise);

    try {
      const result = await promise;
      this.loadedMaterials.set(materialId, result);
      return result;
    } finally {
      this.loadingPromises.delete(materialId);
    }
  }

  private async doLoad(materialId: string): Promise<LoadedMaterial> {
    const url = this.manifest.getMaterialUrl(materialId);
    if (!url) {
      throw new Error(`[MaterialLoader] Material not found in manifest: ${materialId}`);
    }

    this.log(`Loading material: ${materialId} from ${url}`);

    // Check cache
    const cached = await this.cache.get(`material:${materialId}`);
    let instanceData: MaterialInstanceData;

    if (cached && typeof cached.data === 'object') {
      this.log(`Found in cache: ${materialId}`);
      instanceData = cached.data as MaterialInstanceData;
    } else {
      // Fetch from server
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`[MaterialLoader] HTTP ${response.status}: ${response.statusText}`);
      }
      instanceData = await response.json();

      // Cache for next time
      const jsonString = JSON.stringify(instanceData);
      await this.cache.set({
        id: `material:${materialId}`,
        type: 'material',
        data: instanceData,
        size: jsonString.length * 2, // UTF-16
        timestamp: Date.now(),
        version: this.manifest.getVersion(),
      });
    }

    // Create material instance
    return this.createInstance(materialId, instanceData);
  }

  /**
   * Create material instance from data
   */
  private createInstance(materialId: string, data: MaterialInstanceData): LoadedMaterial {
    // Find master material
    const master = this.masterMaterials.get(data.master);
    if (!master) {
      throw new Error(`[MaterialLoader] Master material not found: ${data.master}`);
    }

    // Clone master
    const material = master.clone() as pc.StandardMaterial;
    material.name = materialId;

    // Apply parameters
    if (data.params) {
      this.applyParams(material, data.params);
    }

    // Collect texture slots (textures loaded separately)
    const textureSlots: Record<string, string> = {};
    if (data.textures) {
      for (const [slot, textureId] of Object.entries(data.textures)) {
        if (TEXTURE_SLOTS.includes(slot)) {
          textureSlots[slot] = textureId;
        }
      }
    }

    this.log(`Created material instance: ${materialId}`, {
      master: data.master,
      textureSlots: Object.keys(textureSlots),
      params: data.params ? Object.keys(data.params) : [],
    });

    return {
      id: materialId,
      material,
      masterName: data.master,
      textureSlots,
    };
  }

  /**
   * Apply parameters to material
   */
  private applyParams(material: pc.StandardMaterial, params: Record<string, any>): void {
    for (const [key, value] of Object.entries(params)) {
      if (key in material) {
        try {
          (material as any)[key] = value;
        } catch (e) {
          console.warn(`[MaterialLoader] Failed to set param ${key}:`, e);
        }
      }
    }
    material.update();
  }

  /**
   * Set texture on material
   */
  setTexture(material: pc.StandardMaterial, slot: string, texture: pc.Texture): void {
    if (TEXTURE_SLOTS.includes(slot) && slot in material) {
      (material as any)[slot] = texture;
      material.update();
      this.log(`Set texture on ${material.name}.${slot}`);
    }
  }

  /**
   * Apply material to mesh instances
   */
  applyToMeshInstances(
    material: LoadedMaterial,
    meshInstances: pc.MeshInstance[],
    materialIndex = 0
  ): void {
    for (const mi of meshInstances) {
      if (mi.material) {
        mi.material = material.material;
      }
    }
    this.log(`Applied material ${material.id} to ${meshInstances.length} mesh instances`);
  }

  /**
   * Check if material is loaded
   */
  isLoaded(materialId: string): boolean {
    return this.loadedMaterials.has(materialId);
  }

  /**
   * Get loaded material
   */
  getLoaded(materialId: string): LoadedMaterial | null {
    return this.loadedMaterials.get(materialId) || null;
  }

  /**
   * Unload material
   */
  unload(materialId: string): void {
    const material = this.loadedMaterials.get(materialId);
    if (material) {
      material.material.destroy();
      this.loadedMaterials.delete(materialId);
      this.cache.removeFromMemory(`material:${materialId}`);
      this.log(`Unloaded material: ${materialId}`);
    }
  }

  /**
   * Get all texture IDs needed by loaded materials
   */
  getAllRequiredTextures(): string[] {
    const textureIds = new Set<string>();
    for (const material of this.loadedMaterials.values()) {
      for (const textureId of Object.values(material.textureSlots)) {
        textureIds.add(textureId);
      }
    }
    return Array.from(textureIds);
  }

  /**
   * Get stats
   */
  getStats(): { loaded: number; loading: number; masters: number } {
    return {
      loaded: this.loadedMaterials.size,
      loading: this.loadingPromises.size,
      masters: this.masterMaterials.size,
    };
  }
}

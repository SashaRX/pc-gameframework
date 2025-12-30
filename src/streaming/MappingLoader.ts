/**
 * MappingLoader - Loads and provides access to mapping.json
 *
 * Singleton that loads mapping from B2 server and provides
 * lookup methods for models, materials, textures.
 */

import {
  AssetMapping,
  ModelMapping,
  LodConfig,
} from './MappingTypes';

export class MappingLoader {
  private static instance: MappingLoader | null = null;

  private mapping: AssetMapping | null = null;
  private baseUrl = '';
  private loaded = false;
  private loading = false;
  private loadPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): MappingLoader {
    if (!MappingLoader.instance) {
      MappingLoader.instance = new MappingLoader();
    }
    return MappingLoader.instance;
  }

  // ============================================================================
  // Loading
  // ============================================================================

  /**
   * Load mapping.json from URL
   */
  async load(mappingUrl: string): Promise<void> {
    if (this.loaded) return;

    if (this.loading && this.loadPromise) {
      return this.loadPromise;
    }

    this.loading = true;
    this.loadPromise = this.doLoad(mappingUrl);

    try {
      await this.loadPromise;
    } finally {
      this.loading = false;
    }
  }

  private async doLoad(mappingUrl: string): Promise<void> {
    console.log('[MappingLoader] Loading:', mappingUrl);

    const response = await fetch(mappingUrl);
    if (!response.ok) {
      throw new Error(`[MappingLoader] HTTP ${response.status}: ${response.statusText}`);
    }

    this.mapping = await response.json();
    if (!this.mapping) {
      throw new Error('[MappingLoader] Empty mapping');
    }

    this.baseUrl = this.mapping.baseUrl.replace(/\/$/, '');
    this.loaded = true;

    console.log('[MappingLoader] Loaded:', {
      baseUrl: this.baseUrl,
      version: this.mapping.version,
      models: Object.keys(this.mapping.models).length,
      materials: Object.keys(this.mapping.materials).length,
    });
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  // ============================================================================
  // Model Methods
  // ============================================================================

  /**
   * Get model mapping by PlayCanvas asset ID
   */
  getModel(assetId: string | number): ModelMapping | null {
    return this.mapping?.models?.[String(assetId)] || null;
  }

  /**
   * Check if model exists in mapping
   */
  hasModel(assetId: string | number): boolean {
    return !!this.mapping?.models?.[String(assetId)];
  }

  /**
   * Get all model IDs
   */
  getAllModelIds(): string[] {
    return Object.keys(this.mapping?.models || {});
  }

  /**
   * Get LOD configs for model
   */
  getModelLods(assetId: string | number): LodConfig[] {
    return this.getModel(assetId)?.lods || [];
  }

  /**
   * Get full URL for LOD file
   */
  getLodUrl(lodConfig: LodConfig): string {
    return `${this.baseUrl}/${lodConfig.path}`;
  }

  /**
   * Get material IDs for model
   */
  getModelMaterialIds(assetId: string | number): number[] {
    return this.getModel(assetId)?.materials || [];
  }

  /**
   * Find LOD to load first (the one with maxDistance: null)
   */
  getInitialLodIndex(assetId: string | number): number {
    const lods = this.getModelLods(assetId);
    const idx = lods.findIndex(l => l.maxDistance === null);
    return idx >= 0 ? idx : lods.length - 1;
  }

  /**
   * Select LOD index by distance
   */
  selectLodByDistance(assetId: string | number, distance: number): number {
    const lods = this.getModelLods(assetId);

    // Find first LOD where distance < maxDistance
    for (let i = 0; i < lods.length; i++) {
      const maxDist = lods[i].maxDistance;
      if (maxDist !== null && distance < maxDist) {
        return i;
      }
    }

    // Return last LOD (infinite distance)
    return lods.length - 1;
  }

  // ============================================================================
  // Material Methods
  // ============================================================================

  /**
   * Get material instance JSON path by PlayCanvas asset ID
   */
  getMaterialPath(assetId: string | number): string | null {
    return this.mapping?.materials?.[String(assetId)] || null;
  }

  /**
   * Get full URL for material instance JSON
   */
  getMaterialUrl(assetId: string | number): string | null {
    const path = this.getMaterialPath(assetId);
    if (!path) return null;
    return `${this.baseUrl}/${path}`;
  }

  /**
   * Check if material exists in mapping
   */
  hasMaterial(assetId: string | number): boolean {
    return !!this.mapping?.materials?.[String(assetId)];
  }

  /**
   * Get all material IDs
   */
  getAllMaterialIds(): string[] {
    return Object.keys(this.mapping?.materials || {});
  }

  // ============================================================================
  // Texture Methods
  // ============================================================================

  /**
   * Get full URL for texture path
   */
  getTextureUrl(texturePath: string): string {
    return `${this.baseUrl}/${texturePath}`;
  }

  // ============================================================================
  // Utility
  // ============================================================================

  /**
   * Get raw mapping (for debugging)
   */
  getRawMapping(): AssetMapping | null {
    return this.mapping;
  }

  /**
   * Reset instance (for testing)
   */
  static reset(): void {
    MappingLoader.instance = null;
  }
}

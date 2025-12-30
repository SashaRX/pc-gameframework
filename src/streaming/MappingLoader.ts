/**
 * MappingLoader - Loads and provides access to mapping.json
 *
 * Singleton that loads mapping from B2 server and provides
 * lookup methods for models, materials, textures.
 *
 * See docs/MAPPING_SPEC.md for mapping.json structure
 */

import {
  AssetMapping,
  ModelMapping,
  LodConfig,
  PackedTextureEntry,
  isPackedTextureEntry,
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

    const textureCount = this.mapping.textures ? Object.keys(this.mapping.textures).length : 0;
    const masterCount = this.mapping.masterMaterials ? Object.keys(this.mapping.masterMaterials).length : 0;

    console.log('[MappingLoader] Loaded:', {
      baseUrl: this.baseUrl,
      version: this.mapping.version,
      generated: this.mapping.generated,
      models: Object.keys(this.mapping.models).length,
      materials: Object.keys(this.mapping.materials).length,
      textures: textureCount,
      masterMaterials: masterCount,
    });
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getVersion(): string | undefined {
    return this.mapping?.version;
  }

  // ============================================================================
  // Master Materials
  // ============================================================================

  /**
   * Get master material asset ID by name
   */
  getMasterMaterialId(name: string): number | null {
    return this.mapping?.masterMaterials?.[name] ?? null;
  }

  /**
   * Get all master material names
   */
  getMasterMaterialNames(): string[] {
    return Object.keys(this.mapping?.masterMaterials || {});
  }

  /**
   * Check if master material exists
   */
  hasMasterMaterial(name: string): boolean {
    return !!this.mapping?.masterMaterials?.[name];
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
   * Get LOD configs for model, sorted by distance
   */
  getModelLods(assetId: string | number): LodConfig[] {
    const model = this.getModel(assetId);
    if (!model) return [];
    // Sort by distance ascending (closest first)
    return [...model.lods].sort((a, b) => a.distance - b.distance);
  }

  /**
   * Get full URL for LOD file
   */
  getLodUrl(assetId: string | number, lodLevel: number): string | null {
    const lods = this.getModel(assetId)?.lods;
    if (!lods) return null;
    const lod = lods.find(l => l.level === lodLevel);
    if (!lod) return null;
    return `${this.baseUrl}/${lod.file}`;
  }

  /**
   * Get full URL for LOD config
   */
  getLodUrlFromConfig(lodConfig: LodConfig): string {
    return `${this.baseUrl}/${lodConfig.file}`;
  }

  /**
   * Get material IDs for model
   */
  getModelMaterialIds(assetId: string | number): number[] {
    return this.getModel(assetId)?.materials || [];
  }

  /**
   * Get initial LOD to load (highest distance = lowest detail = fastest load)
   */
  getInitialLodIndex(assetId: string | number): number {
    const lods = this.getModelLods(assetId);
    if (lods.length === 0) return 0;
    // Return index of highest distance (last in sorted array)
    return lods.length - 1;
  }

  /**
   * Select LOD level by camera distance
   */
  selectLodByDistance(assetId: string | number, cameraDistance: number): number {
    const lods = this.getModelLods(assetId);
    if (lods.length === 0) return 0;

    // Lods are sorted by distance ascending
    // Find first LOD where cameraDistance < next LOD's distance
    for (let i = 0; i < lods.length - 1; i++) {
      if (cameraDistance < lods[i + 1].distance) {
        return lods[i].level;
      }
    }

    // Return highest distance LOD
    return lods[lods.length - 1].level;
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
   * Get texture entry by asset ID or packed key
   */
  getTextureEntry(key: string | number): string | PackedTextureEntry | null {
    return this.mapping?.textures?.[String(key)] || null;
  }

  /**
   * Get texture file path (works for both regular and packed)
   */
  getTexturePath(key: string | number): string | null {
    const entry = this.getTextureEntry(key);
    if (!entry) return null;
    if (isPackedTextureEntry(entry)) {
      return entry.file;
    }
    return entry;
  }

  /**
   * Get full URL for texture
   */
  getTextureUrl(key: string | number): string | null {
    const path = this.getTexturePath(key);
    if (!path) return null;
    return `${this.baseUrl}/${path}`;
  }

  /**
   * Check if texture is a packed texture
   */
  isPackedTexture(key: string | number): boolean {
    const entry = this.getTextureEntry(key);
    return entry !== null && isPackedTextureEntry(entry);
  }

  /**
   * Get packed texture source asset IDs
   */
  getPackedTextureSources(key: string | number): number[] | null {
    const entry = this.getTextureEntry(key);
    if (!entry || !isPackedTextureEntry(entry)) return null;
    return entry.sources;
  }

  /**
   * Check if texture exists in mapping
   */
  hasTexture(key: string | number): boolean {
    return !!this.mapping?.textures?.[String(key)];
  }

  /**
   * Get all texture keys
   */
  getAllTextureKeys(): string[] {
    return Object.keys(this.mapping?.textures || {});
  }

  // ============================================================================
  // Utility
  // ============================================================================

  /**
   * Build full URL from relative path
   */
  buildUrl(relativePath: string): string {
    return `${this.baseUrl}/${relativePath}`;
  }

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

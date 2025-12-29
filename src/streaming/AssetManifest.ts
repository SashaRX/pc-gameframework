/**
 * AssetManifest - Registry of all streamable assets on external server
 *
 * Loads manifest JSON at startup, provides URL resolution and asset lookup.
 */

import {
  AssetManifestData,
  ModelEntry,
  MaterialEntry,
  TextureEntry,
} from './types';

export class AssetManifest {
  private static instance: AssetManifest | null = null;

  private manifest: AssetManifestData | null = null;
  private baseUrl = '';
  private version = '';
  private loaded = false;
  private loading = false;
  private loadPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): AssetManifest {
    if (!AssetManifest.instance) {
      AssetManifest.instance = new AssetManifest();
    }
    return AssetManifest.instance;
  }

  /**
   * Load manifest from URL
   */
  async load(manifestUrl: string): Promise<void> {
    if (this.loaded) {
      return;
    }

    if (this.loading && this.loadPromise) {
      return this.loadPromise;
    }

    this.loading = true;
    this.loadPromise = this.doLoad(manifestUrl);

    try {
      await this.loadPromise;
    } finally {
      this.loading = false;
    }
  }

  private async doLoad(manifestUrl: string): Promise<void> {
    console.log('[AssetManifest] Loading:', manifestUrl);

    try {
      const response = await fetch(manifestUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.manifest = await response.json();

      if (!this.manifest) {
        throw new Error('Empty manifest');
      }

      this.baseUrl = this.manifest.baseUrl.replace(/\/$/, ''); // Remove trailing slash
      this.version = this.manifest.version || '';
      this.loaded = true;

      console.log('[AssetManifest] Loaded:', {
        baseUrl: this.baseUrl,
        version: this.version,
        models: Object.keys(this.manifest.models || {}).length,
        materials: Object.keys(this.manifest.materials || {}).length,
        textures: Object.keys(this.manifest.textures || {}).length,
      });
    } catch (error) {
      console.error('[AssetManifest] Failed to load:', error);
      throw error;
    }
  }

  /**
   * Check if manifest is loaded
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Get manifest version
   */
  getVersion(): string {
    return this.version;
  }

  // ============================================================================
  // Model Methods
  // ============================================================================

  /**
   * Get model entry by ID
   */
  getModel(id: string): ModelEntry | null {
    return this.manifest?.models?.[id] || null;
  }

  /**
   * Get full URL for model
   */
  getModelUrl(id: string): string | null {
    const entry = this.getModel(id);
    if (!entry) return null;
    return `${this.baseUrl}/${entry.file}`;
  }

  /**
   * Check if model exists in manifest
   */
  hasModel(id: string): boolean {
    return !!this.manifest?.models?.[id];
  }

  /**
   * Get all model IDs
   */
  getAllModelIds(): string[] {
    return Object.keys(this.manifest?.models || {});
  }

  // ============================================================================
  // Material Methods
  // ============================================================================

  /**
   * Get material entry by ID
   */
  getMaterial(id: string): MaterialEntry | null {
    return this.manifest?.materials?.[id] || null;
  }

  /**
   * Get full URL for material instance JSON
   */
  getMaterialUrl(id: string): string | null {
    const entry = this.getMaterial(id);
    if (!entry) return null;
    return `${this.baseUrl}/${entry.file}`;
  }

  /**
   * Get master material name for material instance
   */
  getMasterMaterial(id: string): string | null {
    const entry = this.getMaterial(id);
    return entry?.master || null;
  }

  /**
   * Check if material exists in manifest
   */
  hasMaterial(id: string): boolean {
    return !!this.manifest?.materials?.[id];
  }

  /**
   * Get all material IDs
   */
  getAllMaterialIds(): string[] {
    return Object.keys(this.manifest?.materials || {});
  }

  // ============================================================================
  // Texture Methods
  // ============================================================================

  /**
   * Get texture entry by ID
   */
  getTexture(id: string): TextureEntry | null {
    return this.manifest?.textures?.[id] || null;
  }

  /**
   * Get full URL for texture
   */
  getTextureUrl(id: string): string | null {
    const entry = this.getTexture(id);
    if (!entry) return null;
    return `${this.baseUrl}/${entry.file}`;
  }

  /**
   * Get texture category
   */
  getTextureCategory(id: string): 'hero' | 'environment' | 'detail' {
    const entry = this.getTexture(id);
    return entry?.category || 'environment';
  }

  /**
   * Get texture file size (for memory budgeting)
   */
  getTextureSize(id: string): number {
    const entry = this.getTexture(id);
    return entry?.size || 0;
  }

  /**
   * Check if texture exists in manifest
   */
  hasTexture(id: string): boolean {
    return !!this.manifest?.textures?.[id];
  }

  /**
   * Get all texture IDs
   */
  getAllTextureIds(): string[] {
    return Object.keys(this.manifest?.textures || {});
  }

  /**
   * Get textures by category
   */
  getTexturesByCategory(category: 'hero' | 'environment' | 'detail'): string[] {
    const textures = this.manifest?.textures || {};
    return Object.entries(textures)
      .filter(([_, entry]) => (entry.category || 'environment') === category)
      .map(([id]) => id);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Resolve any asset URL by type and ID
   */
  resolveUrl(type: 'model' | 'material' | 'texture', id: string): string | null {
    switch (type) {
      case 'model':
        return this.getModelUrl(id);
      case 'material':
        return this.getMaterialUrl(id);
      case 'texture':
        return this.getTextureUrl(id);
      default:
        return null;
    }
  }

  /**
   * Get total estimated size of assets
   */
  getTotalSize(): { models: number; textures: number; total: number } {
    let models = 0;
    let textures = 0;

    for (const entry of Object.values(this.manifest?.models || {})) {
      models += entry.size || 0;
    }

    for (const entry of Object.values(this.manifest?.textures || {})) {
      textures += entry.size || 0;
    }

    return { models, textures, total: models + textures };
  }

  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get raw manifest data (for debugging)
   */
  getRawManifest(): AssetManifestData | null {
    return this.manifest;
  }

  /**
   * Reset instance (for testing)
   */
  static reset(): void {
    AssetManifest.instance = null;
  }
}

/**
 * AssetManifest - Registry of all streamable assets on external server
 *
 * Loads manifest JSON at startup, provides URL resolution and asset lookup.
 */

import {
  AssetManifestData,
  AssetEntry,
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

      // Count by type
      const assets = this.manifest.assets || {};
      const counts = { model: 0, material: 0, texture: 0 };
      for (const entry of Object.values(assets)) {
        counts[entry.type]++;
      }

      console.log('[AssetManifest] Loaded:', {
        baseUrl: this.baseUrl,
        version: this.version,
        totalAssets: Object.keys(assets).length,
        models: counts.model,
        materials: counts.material,
        textures: counts.texture,
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
  // Asset Methods (by PlayCanvas Asset ID)
  // ============================================================================

  /**
   * Get asset entry by PlayCanvas Asset ID
   */
  getAsset(id: string): AssetEntry | null {
    return this.manifest?.assets?.[id] || null;
  }

  /**
   * Get full URL for asset
   */
  getAssetUrl(id: string): string | null {
    const entry = this.getAsset(id);
    if (!entry) return null;
    return `${this.baseUrl}/${entry.file}`;
  }

  /**
   * Get asset type
   */
  getAssetType(id: string): 'model' | 'material' | 'texture' | null {
    const entry = this.getAsset(id);
    return entry?.type || null;
  }

  /**
   * Check if asset exists in manifest
   */
  hasAsset(id: string): boolean {
    return !!this.manifest?.assets?.[id];
  }

  /**
   * Get all asset IDs
   */
  getAllAssetIds(): string[] {
    return Object.keys(this.manifest?.assets || {});
  }

  /**
   * Get assets by type
   */
  getAssetsByType(type: 'model' | 'material' | 'texture'): string[] {
    const assets = this.manifest?.assets || {};
    return Object.entries(assets)
      .filter(([_, entry]) => entry.type === type)
      .map(([id]) => id);
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /**
   * Get model URL (alias)
   */
  getModelUrl(id: string): string | null {
    const entry = this.getAsset(id);
    if (!entry || entry.type !== 'model') return null;
    return `${this.baseUrl}/${entry.file}`;
  }

  /**
   * Get material URL (alias)
   */
  getMaterialUrl(id: string): string | null {
    const entry = this.getAsset(id);
    if (!entry || entry.type !== 'material') return null;
    return `${this.baseUrl}/${entry.file}`;
  }

  /**
   * Get texture URL (alias)
   */
  getTextureUrl(id: string): string | null {
    const entry = this.getAsset(id);
    if (!entry || entry.type !== 'texture') return null;
    return `${this.baseUrl}/${entry.file}`;
  }

  /**
   * Get master material name (for material assets)
   */
  getMasterMaterial(id: string): string | null {
    const entry = this.getAsset(id);
    return entry?.master || null;
  }

  /**
   * Get texture category
   */
  getTextureCategory(id: string): 'hero' | 'environment' | 'detail' {
    const entry = this.getAsset(id);
    return entry?.category || 'environment';
  }

  /**
   * Get asset file size
   */
  getAssetSize(id: string): number {
    const entry = this.getAsset(id);
    return entry?.size || 0;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get total estimated size of assets
   */
  getTotalSize(): { models: number; materials: number; textures: number; total: number } {
    let models = 0;
    let materials = 0;
    let textures = 0;

    for (const entry of Object.values(this.manifest?.assets || {})) {
      const size = entry.size || 0;
      switch (entry.type) {
        case 'model':
          models += size;
          break;
        case 'material':
          materials += size;
          break;
        case 'texture':
          textures += size;
          break;
      }
    }

    return { models, materials, textures, total: models + materials + textures };
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

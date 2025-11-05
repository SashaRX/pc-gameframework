/**
 * Asset source for loading various asset types
 * Handles meshes, GLB models, and other resources
 */

import type * as pc from 'playcanvas';

export class AssetSource {
  private app: pc.Application;
  private pendingLoads: Set<string> = new Set();
  private loadProgress: Map<string, number> = new Map();
  private verbose: boolean;

  constructor(app: pc.Application, verbose: boolean = false) {
    this.app = app;
    this.verbose = verbose;
  }

  /**
   * Load a GLB model from URL
   * Returns the root entity of the loaded model
   */
  async loadGlb(url: string): Promise<pc.Entity> {
    if (this.verbose) {
      console.log(`[AssetSource] Loading GLB: ${url}`);
    }

    this.pendingLoads.add(url);
    this.loadProgress.set(url, 0);

    try {
      // Create container asset
      const asset = new (this.app.assets as any).Asset(`glb_${Date.now()}`, 'container', {
        url: url,
      });

      // Set up progress tracking
      asset.on('progress', (progress: number) => {
        this.loadProgress.set(url, progress);
        if (this.verbose) {
          console.log(`[AssetSource] GLB progress ${url}: ${(progress * 100).toFixed(1)}%`);
        }
      });

      // Load the asset
      await new Promise<void>((resolve, reject) => {
        asset.once('load', () => resolve());
        asset.once('error', (err: Error) => reject(err));
        this.app.assets.add(asset);
        this.app.assets.load(asset);
      });

      // Instantiate the model
      const entity = asset.resource.instantiateRenderEntity();

      this.pendingLoads.delete(url);
      this.loadProgress.delete(url);

      if (this.verbose) {
        console.log(`[AssetSource] GLB loaded: ${url}`);
      }

      return entity;
    } catch (err) {
      this.pendingLoads.delete(url);
      this.loadProgress.delete(url);
      console.error(`[AssetSource] Failed to load GLB ${url}:`, err);
      throw err;
    }
  }

  /**
   * Load a mesh from URL
   * Note: For PlayCanvas, this typically loads GLB and extracts mesh
   */
  async loadMesh(url: string): Promise<pc.Mesh> {
    if (this.verbose) {
      console.log(`[AssetSource] Loading mesh: ${url}`);
    }

    try {
      // Load as GLB
      const entity = await this.loadGlb(url);

      // Find first mesh in the entity hierarchy
      const mesh = this.extractMeshFromEntity(entity);

      if (!mesh) {
        throw new Error(`No mesh found in GLB: ${url}`);
      }

      return mesh;
    } catch (err) {
      console.error(`[AssetSource] Failed to load mesh ${url}:`, err);
      throw err;
    }
  }

  /**
   * Extract mesh from entity (recursively searches hierarchy)
   */
  private extractMeshFromEntity(entity: pc.Entity): pc.Mesh | null {
    // Check if this entity has a model component with mesh instances
    const model = (entity as any).model;
    if (model && model.meshInstances && model.meshInstances.length > 0) {
      return model.meshInstances[0].mesh;
    }

    // Recursively check children
    for (let i = 0; i < entity.children.length; i++) {
      const mesh = this.extractMeshFromEntity(entity.children[i] as pc.Entity);
      if (mesh) {
        return mesh;
      }
    }

    return null;
  }

  /**
   * Instantiate a template by ID
   */
  instantiateTemplate(templateId: string): pc.Entity | null {
    // Try to find by name first, then by ID
    const asset = this.app.assets.find(templateId) || this.app.assets.get(parseInt(templateId, 10));
    if (!asset) {
      console.error(`[AssetSource] Template not found: ${templateId}`);
      return null;
    }

    if (asset.type !== 'template') {
      console.error(`[AssetSource] Asset is not a template: ${templateId}`);
      return null;
    }

    if (!asset.resource) {
      console.error(`[AssetSource] Template not loaded: ${templateId}`);
      return null;
    }

    const entity = (asset.resource as any).instantiate() as pc.Entity;

    if (this.verbose) {
      console.log(`[AssetSource] Instantiated template: ${templateId}`);
    }

    return entity;
  }

  /**
   * Preload a template asset
   */
  async preloadTemplate(templateId: string): Promise<void> {
    const asset = this.app.assets.find(templateId) || this.app.assets.get(parseInt(templateId, 10));
    if (!asset) {
      throw new Error(`Template not found: ${templateId}`);
    }

    if (asset.loaded) {
      return; // Already loaded
    }

    return new Promise<void>((resolve, reject) => {
      asset.once('load', () => resolve());
      asset.once('error', (err: Error) => reject(err));
      this.app.assets.load(asset);
    });
  }

  /**
   * Get overall loading progress (0-1)
   */
  getProgress(): number {
    if (this.loadProgress.size === 0) {
      return 1.0; // Nothing loading
    }

    let total = 0;
    for (const progress of this.loadProgress.values()) {
      total += progress;
    }

    return total / this.loadProgress.size;
  }

  /**
   * Get number of pending loads
   */
  getPendingCount(): number {
    return this.pendingLoads.size;
  }

  /**
   * Check if a URL is currently loading
   */
  isLoading(url: string): boolean {
    return this.pendingLoads.has(url);
  }

  /**
   * Cancel all pending loads
   * Note: PlayCanvas doesn't provide a direct way to cancel asset loads
   */
  cancelAll(): void {
    // Clear tracking (actual load cancellation is limited in PlayCanvas)
    this.pendingLoads.clear();
    this.loadProgress.clear();

    if (this.verbose) {
      console.log('[AssetSource] Cancelled all pending loads');
    }
  }

  /**
   * Load material asset
   */
  async loadMaterial(materialId: string): Promise<pc.Material> {
    const asset = this.app.assets.find(materialId) || this.app.assets.get(parseInt(materialId, 10));
    if (!asset) {
      throw new Error(`Material asset not found: ${materialId}`);
    }

    if (!asset.loaded) {
      await new Promise<void>((resolve, reject) => {
        asset.once('load', () => resolve());
        asset.once('error', (err: Error) => reject(err));
        this.app.assets.load(asset);
      });
    }

    return asset.resource as pc.Material;
  }
}

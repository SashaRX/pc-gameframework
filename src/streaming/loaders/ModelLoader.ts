/**
 * ModelLoader - Load GLB models from external server
 *
 * Features:
 * - Loads GLB via fetch
 * - Supports meshoptimizer compressed models
 * - Caches loaded models
 * - Applies to entity render components
 */

import type * as pc from 'playcanvas';
import { AssetManifest } from '../AssetManifest';
import { CacheManager } from '../CacheManager';
import { MeshoptLoader } from '../../libs/meshoptimizer/MeshoptLoader';

export interface LoadedModel {
  id: string;
  container: pc.Asset;
  resource: any; // ContainerResource
}

export class ModelLoader {
  private app: pc.Application;
  private manifest: AssetManifest;
  private cache: CacheManager;
  private loadingPromises = new Map<string, Promise<LoadedModel>>();
  private loadedModels = new Map<string, LoadedModel>();
  private debug: boolean;

  constructor(app: pc.Application, debug = false) {
    this.app = app;
    this.manifest = AssetManifest.getInstance();
    this.cache = CacheManager.getInstance();
    this.debug = debug;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[ModelLoader]', ...args);
    }
  }

  /**
   * Load model by ID
   */
  async load(modelId: string): Promise<LoadedModel> {
    // Already loaded?
    const existing = this.loadedModels.get(modelId);
    if (existing) {
      this.log(`Using cached model: ${modelId}`);
      return existing;
    }

    // Already loading?
    const loadingPromise = this.loadingPromises.get(modelId);
    if (loadingPromise) {
      return loadingPromise;
    }

    // Start loading
    const promise = this.doLoad(modelId);
    this.loadingPromises.set(modelId, promise);

    try {
      const result = await promise;
      this.loadedModels.set(modelId, result);
      return result;
    } finally {
      this.loadingPromises.delete(modelId);
    }
  }

  private async doLoad(modelId: string): Promise<LoadedModel> {
    const url = this.manifest.getModelUrl(modelId);
    if (!url) {
      throw new Error(`[ModelLoader] Model not found in manifest: ${modelId}`);
    }

    this.log(`Loading model: ${modelId} from ${url}`);

    // Check IndexedDB cache
    const cached = await this.cache.get(`model:${modelId}`);
    let arrayBuffer: ArrayBuffer;

    if (cached && cached.data instanceof ArrayBuffer) {
      this.log(`Found in cache: ${modelId}`);
      arrayBuffer = cached.data;
    } else {
      // Fetch from server
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`[ModelLoader] HTTP ${response.status}: ${response.statusText}`);
      }
      arrayBuffer = await response.arrayBuffer();

      // Cache for next time
      await this.cache.set({
        id: `model:${modelId}`,
        type: 'model',
        data: arrayBuffer,
        size: arrayBuffer.byteLength,
        timestamp: Date.now(),
        version: this.manifest.getVersion(),
      });
    }

    // Initialize meshoptimizer if needed
    await this.initMeshoptIfNeeded(arrayBuffer);

    // Parse GLB
    const container = await this.parseGLB(modelId, arrayBuffer, url);

    const resource = container.resource as any;
    this.log(`Model loaded: ${modelId}`, {
      meshInstances: resource?.meshInstances?.length || 0,
      renders: resource?.renders?.length || 0,
    });

    return {
      id: modelId,
      container,
      resource: container.resource as pc.ContainerResource,
    };
  }

  /**
   * Check if GLB uses meshopt compression and init decoder
   */
  private async initMeshoptIfNeeded(arrayBuffer: ArrayBuffer): Promise<void> {
    // Quick check for meshopt extension in GLB
    const hasMeshopt = this.checkForMeshoptExtension(arrayBuffer);

    if (hasMeshopt) {
      this.log('Model uses meshopt compression, initializing decoder...');
      const meshoptLoader = MeshoptLoader.getInstance();
      await meshoptLoader.initialize(this.app, this.debug);
    }
  }

  /**
   * Quick scan for EXT_meshopt_compression in GLB
   */
  private checkForMeshoptExtension(arrayBuffer: ArrayBuffer): boolean {
    try {
      const view = new DataView(arrayBuffer);

      // GLB header: magic (4) + version (4) + length (4)
      const magic = view.getUint32(0, true);
      if (magic !== 0x46546C67) {
        // 'glTF' in little-endian
        return false;
      }

      // JSON chunk header at offset 12
      const jsonLength = view.getUint32(12, true);

      // Extract JSON
      const jsonBytes = new Uint8Array(arrayBuffer, 20, jsonLength);
      const jsonStr = new TextDecoder().decode(jsonBytes);

      // Quick string check (faster than full parse)
      return jsonStr.includes('EXT_meshopt_compression');
    } catch {
      return false;
    }
  }

  /**
   * Parse GLB into PlayCanvas container asset
   */
  private parseGLB(modelId: string, arrayBuffer: ArrayBuffer, url: string): Promise<pc.Asset> {
    return new Promise((resolve, reject) => {
      const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
      const blobUrl = URL.createObjectURL(blob);

      const asset = new (this.app.assets.constructor as any).Asset(
        modelId,
        'container',
        { url: blobUrl, filename: `${modelId}.glb` }
      ) as pc.Asset;

      asset.on('load', () => {
        URL.revokeObjectURL(blobUrl);
        resolve(asset);
      });

      asset.on('error', (err: string) => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(`[ModelLoader] Failed to parse GLB: ${err}`));
      });

      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });
  }

  /**
   * Apply loaded model to entity
   */
  applyToEntity(model: LoadedModel, entity: pc.Entity): void {
    if (!model.resource) {
      console.error('[ModelLoader] No resource in model:', model.id);
      return;
    }

    // Get or create render component
    let render = entity.render;
    if (!render) {
      entity.addComponent('render', { type: 'asset' });
      render = entity.render;
    }

    if (!render) {
      console.error('[ModelLoader] Failed to create render component');
      return;
    }

    // Apply model renders
    const resource = model.resource as any;
    const renders = resource?.renders;
    if (renders && renders.length > 0) {
      render.asset = renders[0].id;
    }

    this.log(`Applied model ${model.id} to entity ${entity.name}`);
  }

  /**
   * Check if model is loaded
   */
  isLoaded(modelId: string): boolean {
    return this.loadedModels.has(modelId);
  }

  /**
   * Get loaded model
   */
  getLoaded(modelId: string): LoadedModel | null {
    return this.loadedModels.get(modelId) || null;
  }

  /**
   * Unload model (remove from memory, keep in IndexedDB)
   */
  unload(modelId: string): void {
    const model = this.loadedModels.get(modelId);
    if (model) {
      // Remove asset from registry
      this.app.assets.remove(model.container);
      model.container.unload();

      this.loadedModels.delete(modelId);
      this.cache.removeFromMemory(`model:${modelId}`);

      this.log(`Unloaded model: ${modelId}`);
    }
  }

  /**
   * Get loading stats
   */
  getStats(): { loaded: number; loading: number } {
    return {
      loaded: this.loadedModels.size,
      loading: this.loadingPromises.size,
    };
  }
}

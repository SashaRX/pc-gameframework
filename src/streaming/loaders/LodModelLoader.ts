/**
 * LodModelLoader - Load and manage models with LOD support
 *
 * Features:
 * - Loads multiple LOD levels per model
 * - Distance-based or screen-size based LOD selection
 * - Lazy loading of lower priority LODs
 * - Optional crossfade between LODs
 */

import type * as pc from 'playcanvas';
import { AssetManifest } from '../AssetManifest';
import { CacheManager } from '../CacheManager';
import { MeshoptLoader } from '../../libs/meshoptimizer/MeshoptLoader';
import {
  ProcessedModelEntry,
  ModelLodConfig,
  ModelLodFile,
  LoadedModelWithLods,
  LoadedLodLevel,
} from '../types-extended';

export class LodModelLoader {
  private app: pc.Application;
  private manifest: AssetManifest;
  private cache: CacheManager;
  private debug: boolean;

  private loadedModels = new Map<string, LoadedModelWithLods>();
  private loadingPromises = new Map<string, Promise<LoadedModelWithLods>>();

  /** Default distances if not specified in config */
  private static DEFAULT_LOD_DISTANCES = [0, 10, 25, 50, 100, 200];

  constructor(app: pc.Application, debug = false) {
    this.app = app;
    this.manifest = AssetManifest.getInstance();
    this.cache = CacheManager.getInstance();
    this.debug = debug;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[LodModelLoader]', ...args);
    }
  }

  // ============================================================================
  // Main Loading API
  // ============================================================================

  /**
   * Load model with LODs by asset ID
   * Initially loads only the most appropriate LOD for current distance
   *
   * @param modelId Original PlayCanvas asset ID
   * @param initialDistance Distance to camera for initial LOD selection
   */
  async load(modelId: string, initialDistance = 0): Promise<LoadedModelWithLods> {
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
    const promise = this.doLoad(modelId, initialDistance);
    this.loadingPromises.set(modelId, promise);

    try {
      const result = await promise;
      this.loadedModels.set(modelId, result);
      return result;
    } finally {
      this.loadingPromises.delete(modelId);
    }
  }

  private async doLoad(modelId: string, initialDistance: number): Promise<LoadedModelWithLods> {
    // Get model entry from manifest
    const entry = this.manifest.getAsset(modelId) as ProcessedModelEntry | null;
    if (!entry || entry.type !== 'model') {
      throw new Error(`[LodModelLoader] Model not found in manifest: ${modelId}`);
    }

    const config = entry.lods;
    this.log(`Loading model: ${modelId}`, {
      lodCount: config.files.length,
      mode: config.mode,
    });

    // Create model structure
    const model: LoadedModelWithLods = {
      id: modelId,
      config,
      lods: new Map(),
      currentLod: -1,
    };

    // Determine which LOD to load first
    const targetLod = this.selectLodLevel(config, initialDistance);

    // Load the target LOD
    await this.loadLodLevel(model, targetLod);
    model.currentLod = targetLod;

    this.log(`Model loaded: ${modelId}, initial LOD: ${targetLod}`);

    return model;
  }

  /**
   * Select appropriate LOD level based on distance
   */
  private selectLodLevel(config: ModelLodConfig, distance: number): number {
    const files = config.files;

    if (config.mode === 'distance') {
      // Find highest quality LOD that meets distance threshold
      for (let i = files.length - 1; i >= 0; i--) {
        const lodDistance = files[i].distance ?? LodModelLoader.DEFAULT_LOD_DISTANCES[i] ?? 1000;
        if (distance >= lodDistance) {
          return files[i].level;
        }
      }
      return files[0].level; // Highest quality
    }

    // Default: return highest quality
    return 0;
  }

  /**
   * Load a specific LOD level for a model
   */
  async loadLodLevel(model: LoadedModelWithLods, level: number): Promise<LoadedLodLevel> {
    // Already loaded?
    const existing = model.lods.get(level);
    if (existing?.loaded) {
      return existing;
    }

    // Find the LOD file config
    const lodFile = model.config.files.find((f) => f.level === level);
    if (!lodFile) {
      throw new Error(`[LodModelLoader] LOD level ${level} not found for model ${model.id}`);
    }

    // Create loading entry
    const lodLevel: LoadedLodLevel = existing || {
      level,
      asset: null as any,
      resource: null,
      loaded: false,
      loading: true,
    };

    if (!existing) {
      model.lods.set(level, lodLevel);
    }

    lodLevel.loading = true;

    try {
      // Get full URL
      const baseUrl = this.manifest.getBaseUrl();
      const url = `${baseUrl}/${lodFile.file}`;

      this.log(`Loading LOD ${level} for ${model.id}: ${url}`);

      // Check cache
      const cacheKey = `model:${model.id}:lod${level}`;
      const cached = await this.cache.get(cacheKey);
      let arrayBuffer: ArrayBuffer;

      if (cached && cached.data instanceof ArrayBuffer) {
        this.log(`Cache hit: ${cacheKey}`);
        arrayBuffer = cached.data;
      } else {
        // Fetch from server
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        arrayBuffer = await response.arrayBuffer();

        // Cache for next time
        await this.cache.set({
          id: cacheKey,
          type: 'model',
          data: arrayBuffer,
          size: arrayBuffer.byteLength,
          timestamp: Date.now(),
          version: this.manifest.getVersion(),
        });
      }

      // Initialize meshopt decoder if GLB uses EXT_meshopt_compression
      const meshoptDecoder = await this.initMeshoptIfNeeded(arrayBuffer);

      // Parse GLB — passes decoder so processAsync hook decompresses bufferViews
      const asset = await this.parseGLB(`${model.id}_lod${level}`, arrayBuffer, meshoptDecoder);

      lodLevel.asset = asset;
      lodLevel.resource = asset.resource;
      lodLevel.loaded = true;
      lodLevel.loading = false;

      this.log(`LOD ${level} loaded for ${model.id}`);

      return lodLevel;
    } catch (error) {
      lodLevel.loading = false;
      throw error;
    }
  }

  // ============================================================================
  // LOD Switching
  // ============================================================================

  /**
   * Update LOD for model based on distance to camera
   * Returns true if LOD was switched
   */
  async updateLod(modelId: string, distance: number): Promise<boolean> {
    const model = this.loadedModels.get(modelId);
    if (!model) return false;

    const targetLod = this.selectLodLevel(model.config, distance);

    if (targetLod === model.currentLod) {
      return false;
    }

    // Load new LOD if needed
    if (!model.lods.get(targetLod)?.loaded) {
      await this.loadLodLevel(model, targetLod);
    }

    const oldLod = model.currentLod;
    model.currentLod = targetLod;

    this.log(`LOD switch for ${modelId}: ${oldLod} -> ${targetLod}`);

    // Apply to entity if attached
    if (model.entity) {
      this.applyLodToEntity(model, model.entity);
    }

    return true;
  }

  /**
   * Apply current LOD to entity
   */
  applyLodToEntity(model: LoadedModelWithLods, entity: pc.Entity): void {
    const lodLevel = model.lods.get(model.currentLod);
    if (!lodLevel?.loaded) {
      this.log(`Cannot apply LOD ${model.currentLod} - not loaded`);
      return;
    }

    // Get or create render component
    let render = entity.render;
    if (!render) {
      entity.addComponent('render', { type: 'asset' });
      render = entity.render;
    }

    if (!render) {
      console.error('[LodModelLoader] Failed to create render component');
      return;
    }

    // Apply model renders
    const resource = lodLevel.resource as any;
    const renders = resource?.renders;
    if (renders && renders.length > 0) {
      render.asset = renders[0].id;
    }

    // Track entity
    model.entity = entity;

    this.log(`Applied LOD ${model.currentLod} to entity ${entity.name}`);
  }

  /**
   * Attach model to entity with initial LOD
   */
  applyToEntity(model: LoadedModelWithLods, entity: pc.Entity): void {
    this.applyLodToEntity(model, entity);
  }

  // ============================================================================
  // Preloading
  // ============================================================================

  /**
   * Preload additional LOD levels in background
   */
  async preloadLods(modelId: string, levels?: number[]): Promise<void> {
    const model = this.loadedModels.get(modelId);
    if (!model) return;

    const toLoad = levels || model.config.files.map((f) => f.level);

    const promises = toLoad
      .filter((level) => !model.lods.get(level)?.loaded)
      .map((level) =>
        this.loadLodLevel(model, level).catch((err) => {
          console.warn(`[LodModelLoader] Failed to preload LOD ${level}:`, err);
        })
      );

    await Promise.all(promises);
  }

  /**
   * Preload next lower quality LOD (for smooth streaming)
   */
  async preloadNextLod(modelId: string): Promise<void> {
    const model = this.loadedModels.get(modelId);
    if (!model) return;

    const currentLevel = model.currentLod;
    const nextLevel = model.config.files.find((f) => f.level > currentLevel);

    if (nextLevel && !model.lods.get(nextLevel.level)?.loaded) {
      await this.loadLodLevel(model, nextLevel.level);
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Quick scan for EXT_meshopt_compression in GLB JSON chunk.
   * Returns parsed glTF JSON if extension is present, null otherwise.
   * Returning the parsed JSON avoids double-parsing later.
   */
  private checkForMeshoptExtension(arrayBuffer: ArrayBuffer): object | null {
    try {
      const view = new DataView(arrayBuffer);
      if (view.getUint32(0, true) !== 0x46546c67) return null; // 'glTF' magic
      const jsonLength = view.getUint32(12, true);
      const jsonStr = new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonLength));
      if (!jsonStr.includes('EXT_meshopt_compression')) return null;
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  /**
   * Initialize MeshoptDecoder if GLB uses EXT_meshopt_compression.
   * Returns the decoder instance if needed, null otherwise.
   */
  private async initMeshoptIfNeeded(arrayBuffer: ArrayBuffer): Promise<import('../../libs/meshoptimizer/MeshoptLoader').MeshoptDecoder | null> {
    const gltf = this.checkForMeshoptExtension(arrayBuffer);
    if (!gltf) return null;

    const meshoptLoader = MeshoptLoader.getInstance();
    const decoder = await meshoptLoader.initialize(this.app, this.debug);

    this.log('EXT_meshopt_compression detected — decoder ready, SIMD:', decoder.supported);
    return decoder;
  }

  /**
   * Build a bufferView.processAsync callback for PlayCanvas GlbParser.
   *
   * GlbParser calls this for every bufferView with signature:
   *   processAsync(gltfBufferView, buffers, callback(err, Uint8Array | null))
   *
   * If the bufferView has EXT_meshopt_compression extension we:
   *   1. Resolve the compressed source buffer (the extension's own buffer index)
   *   2. Slice out the compressed bytes
   *   3. Allocate output buffer: count * byteStride
   *   4. Call decoder.decodeGltfBuffer() synchronously (WASM is ready by this point)
   *   5. Return decoded Uint8Array — GlbParser will use it in place of raw data
   *
   * Returning null from callback falls through to the default path (raw slice).
   *
   * Spec ref: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/EXT_meshopt_compression
   */
  private buildMeshoptBufferViewHook(
    decoder: import('../../libs/meshoptimizer/MeshoptLoader').MeshoptDecoder,
    glbBinaryChunk: Uint8Array,
    gltfBuffers: Array<{ byteOffset: number; byteLength: number; uri?: string }>
  ): (gltfBufferView: any, buffers: Promise<Uint8Array>[], cb: (err: Error | null, result: Uint8Array | null) => void) => void {

    return (gltfBufferView: any, _buffers: Promise<Uint8Array>[], cb) => {
      const ext = gltfBufferView?.extensions?.EXT_meshopt_compression;
      if (!ext) {
        cb(null, null); // not compressed — use default path
        return;
      }

      try {
        // Compressed data lives in ext.buffer (may differ from the parent bufferView.buffer)
        // For GLB the binary chunk is buffer index 0 with no URI
        const srcBuf = gltfBuffers[ext.buffer];
        const srcOffset = (srcBuf?.byteOffset ?? 0) + (ext.byteOffset ?? 0);
        const source = glbBinaryChunk.subarray(srcOffset, srcOffset + ext.byteLength);

        const count: number      = ext.count;
        const byteStride: number = ext.byteStride;
        const mode: string       = ext.mode   ?? 'ATTRIBUTES';
        const filter: string     = ext.filter ?? 'NONE';

        const target = new Uint8Array(count * byteStride);

        // decodeGltfBuffer is synchronous — WASM decoder is fully initialised
        decoder.decodeGltfBuffer(target, count, byteStride, source, mode as any, filter as any);

        // Propagate byteStride so GlbParser sees it (same as default path does for non-compressed)
        (target as any).byteStride = byteStride;

        this.log(`meshopt: decoded bufferView — mode=${mode} filter=${filter} count=${count} stride=${byteStride} → ${target.byteLength}B`);

        cb(null, target);
      } catch (err: any) {
        cb(new Error(`[LodModelLoader] meshopt decode failed: ${err.message ?? err}`), null);
      }
    };
  }

  /**
   * Parse GLB ArrayBuffer into a PlayCanvas container Asset.
   *
   * If a meshoptDecoder is provided the asset.options.bufferView.processAsync
   * hook is installed so GlbParser decompresses every meshopt bufferView before
   * building vertex / index buffers.  This is the correct integration point —
   * PlayCanvas calls the hook for every bufferView before any geometry is built.
   *
   * KHR_mesh_quantization requires no special handling: PlayCanvas reads accessor
   * types (INT8/UINT8/INT16/UINT16) natively and the normalized flag is respected
   * by the vertex format builder.
   */
  private parseGLB(
    name: string,
    arrayBuffer: ArrayBuffer,
    decoder?: import('../../libs/meshoptimizer/MeshoptLoader').MeshoptDecoder | null
  ): Promise<pc.Asset> {
    return new Promise((resolve, reject) => {
      const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
      const blobUrl = URL.createObjectURL(blob);

      const AssetClass = (this.app.assets as any).constructor?.Asset ||
        (globalThis as any).pc?.Asset;

      if (!AssetClass) {
        URL.revokeObjectURL(blobUrl);
        reject(new Error('Cannot find pc.Asset constructor'));
        return;
      }

      const asset = new AssetClass(name, 'container', {
        url: blobUrl,
        filename: `${name}.glb`,
      }) as pc.Asset;

      // ---- meshopt hook ----
      // Installed only when the GLB uses EXT_meshopt_compression.
      // GlbParser passes options.bufferView.processAsync(gltfBufView, buffers, cb)
      // for every bufferView, giving us the chance to decompress before geometry build.
      if (decoder) {
        // Extract GLB header fields needed to locate the binary chunk and buffers.
        // GLB layout: [header 12B][JSON chunk][BIN chunk]
        //   Chunk header: length(4) + type(4)  (type 0x4E4F534A=JSON, 0x004E4942=BIN)
        const dv = new DataView(arrayBuffer);
        const jsonChunkLength = dv.getUint32(12, true);
        // BIN chunk starts right after JSON chunk header (8B) + JSON data
        const binChunkDataOffset = 12 + 8 + jsonChunkLength; // skip JSON chunkLen+type+data
        const binChunkLength = binChunkDataOffset < arrayBuffer.byteLength
          ? dv.getUint32(binChunkDataOffset - 8 + jsonChunkLength + 8, true)
          : 0;

        // Recalculate correctly:
        // offset 0: magic(4) + version(4) + totalLength(4) = 12
        // offset 12: jsonChunkLen(4) + jsonChunkType(4) + jsonData(jsonChunkLen)
        // offset 12+8+jsonChunkLen: binChunkLen(4) + binChunkType(4) + binData
        const binOffset = 12 + 8 + jsonChunkLength; // = start of BIN chunk header
        const glbBinaryChunk = new Uint8Array(
          arrayBuffer,
          binOffset + 8, // skip BIN chunk header
          dv.getUint32(binOffset, true)
        );

        // Parse gltf.buffers from JSON chunk to get byteOffset mapping
        const jsonStr = new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonChunkLength));
        const gltf = JSON.parse(jsonStr);
        const gltfBuffers: Array<{ byteOffset: number; byteLength: number; uri?: string }> =
          (gltf.buffers ?? []).map((_b: any, _i: number) => ({
            byteOffset: 0,       // GLB binary chunk always starts at offset 0
            byteLength: _b.byteLength,
            uri: _b.uri,
          }));

        const processAsync = this.buildMeshoptBufferViewHook(decoder, glbBinaryChunk, gltfBuffers);
        (asset as any).options = { bufferView: { processAsync } };
      }
      // ---- end meshopt hook ----

      asset.on('load', () => {
        URL.revokeObjectURL(blobUrl);
        resolve(asset);
      });

      asset.on('error', (err: string) => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(`Failed to parse GLB: ${err}`));
      });

      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  isLoaded(modelId: string): boolean {
    return this.loadedModels.has(modelId);
  }

  getLoaded(modelId: string): LoadedModelWithLods | null {
    return this.loadedModels.get(modelId) || null;
  }

  getCurrentLod(modelId: string): number {
    return this.loadedModels.get(modelId)?.currentLod ?? -1;
  }

  getLoadedLodLevels(modelId: string): number[] {
    const model = this.loadedModels.get(modelId);
    if (!model) return [];

    return Array.from(model.lods.entries())
      .filter(([_, lod]) => lod.loaded)
      .map(([level]) => level);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Unload specific LOD level (keep others)
   */
  unloadLod(modelId: string, level: number): void {
    const model = this.loadedModels.get(modelId);
    if (!model) return;

    const lod = model.lods.get(level);
    if (!lod?.loaded) return;

    // Don't unload current LOD
    if (model.currentLod === level) {
      this.log(`Cannot unload current LOD ${level} for ${modelId}`);
      return;
    }

    // Cleanup
    this.app.assets.remove(lod.asset);
    lod.asset.unload();
    model.lods.delete(level);

    this.log(`Unloaded LOD ${level} for ${modelId}`);
  }

  /**
   * Unload entire model
   */
  unload(modelId: string): void {
    const model = this.loadedModels.get(modelId);
    if (!model) return;

    // Unload all LODs
    for (const [level, lod] of model.lods) {
      if (lod.loaded) {
        this.app.assets.remove(lod.asset);
        lod.asset.unload();
      }
    }

    model.lods.clear();
    this.loadedModels.delete(modelId);

    this.log(`Unloaded model: ${modelId}`);
  }

  /**
   * Get statistics
   */
  getStats(): {
    loadedModels: number;
    totalLods: number;
    loadingCount: number;
  } {
    let totalLods = 0;
    for (const model of this.loadedModels.values()) {
      totalLods += model.lods.size;
    }

    return {
      loadedModels: this.loadedModels.size,
      totalLods,
      loadingCount: this.loadingPromises.size,
    };
  }
}

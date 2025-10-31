/**
 * KTX2 Progressive Loader for PlayCanvas
 * 
 * ESM + TypeScript implementation with:
 * - Progressive mipmap loading
 * - Web Worker transcoding
 * - IndexedDB caching
 * - Adaptive loading based on screen size
 * - Memory management
 */

import * as pc from 'playcanvas';
import type {
  Ktx2LoaderConfig,
  Ktx2ProbeResult,
  Ktx2TranscodeResult,
  OnProgressCallback,
  OnCompleteCallback,
  LoadStats,
  MipLoadInfo,
  KtxModule,
  KtxApi,
} from './types';
import { KtxCacheManager } from './KtxCacheManager';
import { alignValue, readU64asNumber, writeU64 } from './utils/alignment';
import { parseDFDColorSpace } from './utils/colorspace';

export class Ktx2ProgressiveLoader {
  private app: pc.Application;
  private config: Required<Ktx2LoaderConfig>;
  
  // Worker state
  private worker: Worker | null = null;
  private workerReady = false;
  private workerMessageId = 0;
  private workerPendingCallbacks = new Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }>();
  
  // KTX module (for main thread fallback)
  private ktxModule: KtxModule | null = null;
  private ktxApi: KtxApi | null = null;
  
  // Cache manager
  private cacheManager: KtxCacheManager | null = null;
  
  // Custom material for LOD control
  private customMaterial: pc.StandardMaterial | null = null;

  constructor(app: pc.Application, config: Ktx2LoaderConfig) {
    this.app = app;
    
    // Set defaults
    this.config = {
      ktxUrl: config.ktxUrl,
      progressive: config.progressive ?? true,
      isSrgb: config.isSrgb ?? false,
      stepDelayMs: config.stepDelayMs ?? 150,
      verbose: config.verbose ?? true,
      maxRgbaBytes: config.maxRgbaBytes ?? 67108864, // 64MB
      enableAniso: config.enableAniso ?? true,
      adaptiveLoading: config.adaptiveLoading ?? false,
      adaptiveMargin: config.adaptiveMargin ?? 1.5,
      useWorker: config.useWorker ?? true,
      minFrameInterval: config.minFrameInterval ?? 16, // 60fps
      enableCache: config.enableCache ?? true,
      cacheMaxAgeDays: config.cacheMaxAgeDays ?? 7,
    };
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Initialize the loader (load libktx, setup worker, init cache)
   */
  async initialize(libktxModuleUrl?: string, libktxWasmUrl?: string): Promise<void> {
    if (this.config.verbose) {
      console.log('[KTX2] Initializing loader...');
    }

    // Initialize cache
    if (this.config.enableCache) {
      this.cacheManager = new KtxCacheManager('ktx2-cache', 1);
      await this.cacheManager.init();
      
      // Clean old entries
      await this.cacheManager.clearOld(this.config.cacheMaxAgeDays);
      
      if (this.config.verbose) {
        console.log('[KTX2] Cache initialized');
      }
    }

    // Initialize worker
    if (this.config.useWorker) {
      const success = await this.initWorker(libktxModuleUrl, libktxWasmUrl);
      if (!success && this.config.verbose) {
        console.warn('[KTX2] Worker initialization failed, will use main thread');
      }
    }

    // Fallback: initialize main thread module
    if (!this.config.useWorker || !this.workerReady) {
      await this.initMainThreadModule(libktxModuleUrl, libktxWasmUrl);
    }

    if (this.config.verbose) {
      console.log('[KTX2] Loader ready');
    }
  }

  /**
   * Load texture progressively and apply to entity
   */
  async loadToEntity(
    entity: pc.Entity,
    callbacks?: {
      onProgress?: OnProgressCallback;
      onComplete?: OnCompleteCallback;
    }
  ): Promise<pc.Texture> {
    if (!this.config.ktxUrl) {
      throw new Error('ktxUrl not configured');
    }

    const loadStats: LoadStats = {
      startTime: performance.now(),
      bytesDownloaded: 0,
      bytesTranscoded: 0,
      levelsLoaded: 0,
      levelsCached: 0,
      heapPeakSize: 0,
      heapCurrentSize: 0,
      memoryFreed: 0,
    };

    // 1. Probe the file
    const probe = await this.probe(this.config.ktxUrl);
    
    if (this.config.verbose) {
      console.log('[KTX2] Probe complete:', {
        levels: probe.levelCount,
        size: `${probe.width}x${probe.height}`,
        totalSize: `${(probe.totalSize / 1024 / 1024).toFixed(2)} MB`,
      });
    }

    // 2. Determine which levels to load
    const startLevel = this.config.adaptiveLoading
      ? this.calculateStartLevel(entity, probe.width, probe.height, probe.levelCount)
      : probe.levelCount - 1;

    if (this.config.verbose && this.config.adaptiveLoading) {
      console.log(`[KTX2] Adaptive loading: starting from level ${startLevel}`);
    }

    // 3. Check cache for available levels
    const cachedLevels = this.config.enableCache && this.cacheManager
      ? await this.cacheManager.getMipList(this.config.ktxUrl)
      : [];

    if (this.config.verbose && cachedLevels.length > 0) {
      console.log(`[KTX2] Found ${cachedLevels.length} cached levels:`, cachedLevels);
    }

    // 4. Create texture
    const texture = this.createTexture(probe);
    
    // 5. Progressive loading loop
    let lastFrameTime = performance.now();

    for (let i = startLevel; i < probe.levelCount; i++) {
      const levelInfo = probe.levels[i];
      if (!levelInfo) continue;

      let result: Ktx2TranscodeResult | undefined;
      let fromCache = false;

      // Try to load from cache first
      if (this.config.enableCache && cachedLevels.includes(i) && this.cacheManager) {
        const cached = await this.cacheManager.loadMip(this.config.ktxUrl, i);
        if (cached) {
          result = {
            width: cached.width,
            height: cached.height,
            data: cached.data,
          };
          fromCache = true;
          loadStats.levelsCached++;
          
          if (this.config.verbose) {
            console.log(`[KTX2] Level ${i} loaded from cache`);
          }
        }
      }

      // Load from network if not cached
      if (!fromCache) {
        const transcodeStart = performance.now();
        
        // Fetch level payload
        const payload = await this.fetchRange(
          this.config.ktxUrl,
          levelInfo.byteOffset,
          levelInfo.byteOffset + levelInfo.byteLength - 1
        );
        
        loadStats.bytesDownloaded += payload.byteLength;

        // Repack to mini-KTX2
        const miniKtx = this.repackSingleLevel(probe, i, payload);

        // Transcode
        result = await this.transcode(miniKtx);
        
        const transcodeTime = performance.now() - transcodeStart;
        loadStats.bytesTranscoded += result.data.byteLength;

        // Save to cache
        if (this.config.enableCache && this.cacheManager) {
          await this.cacheManager.saveMip(this.config.ktxUrl, i, result.data, {
            width: result.width,
            height: result.height,
            timestamp: Date.now(),
          });
        }

        if (this.config.verbose) {
          console.log(
            `[KTX2] Level ${i}: ${result.width}x${result.height} ` +
            `(${(transcodeTime).toFixed(1)}ms)`
          );
        }
      }

      // Check result exists
      if (!result) {
        console.error(`[KTX2] Failed to load level ${i}`);
        continue;
      }

      // Upload to GPU
      this.uploadMipLevel(texture, i, result);
      loadStats.levelsLoaded++;

      // Update heap stats
      if (result.heapStats) {
        loadStats.heapPeakSize = Math.max(loadStats.heapPeakSize, result.heapStats.before);
        loadStats.heapCurrentSize = result.heapStats.after;
        loadStats.memoryFreed += result.heapStats.freed || 0;
      }

      // Free memory
      result.data = null as any;

      // Progress callback
      if (callbacks?.onProgress) {
        const mipInfo: MipLoadInfo = {
          level: i,
          width: result.width,
          height: result.height,
          byteLength: levelInfo.byteLength,
          cached: fromCache,
          transcodeTime: 0,
        };
        callbacks.onProgress(i - startLevel + 1, probe.levelCount - startLevel, mipInfo);
      }

      // FPS limiter
      if (i < probe.levelCount - 1) {
        const now = performance.now();
        const elapsed = now - lastFrameTime;
        const minInterval = Math.max(this.config.minFrameInterval, 0);
        const waitTime = Math.max(minInterval - elapsed, 0) + this.config.stepDelayMs;

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        lastFrameTime = performance.now();
      }
    }

    // Apply texture to entity
    this.applyTextureToEntity(entity, texture);

    // Completion stats
    loadStats.endTime = performance.now();
    loadStats.totalTime = loadStats.endTime - loadStats.startTime;
    loadStats.averageTimePerLevel = loadStats.totalTime / loadStats.levelsLoaded;

    if (callbacks?.onComplete) {
      callbacks.onComplete(loadStats);
    }

    if (this.config.verbose) {
      console.log('[KTX2] Loading complete:', {
        totalTime: `${(loadStats.totalTime! / 1000).toFixed(2)}s`,
        levelsLoaded: loadStats.levelsLoaded,
        levelsCached: loadStats.levelsCached,
        downloaded: `${(loadStats.bytesDownloaded / 1024 / 1024).toFixed(2)} MB`,
        transcoded: `${(loadStats.bytesTranscoded / 1024 / 1024).toFixed(2)} MB`,
      });
    }

    return texture;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    if (this.customMaterial) {
      this.customMaterial.destroy();
      this.customMaterial = null;
    }

    if (this.config.verbose) {
      console.log('[KTX2] Loader disposed');
    }
  }

  // ============================================================================
  // Private Methods - Stubs (TODO: Implement)
  // ============================================================================

  private async initWorker(libktxModuleUrl?: string, libktxWasmUrl?: string): Promise<boolean> {
    // TODO: Implement worker initialization
    return false;
  }

  private async initMainThreadModule(libktxModuleUrl?: string, libktxWasmUrl?: string): Promise<void> {
    // TODO: Implement main thread module loading
  }

  private async probe(url: string): Promise<Ktx2ProbeResult> {
    // TODO: Implement probe
    throw new Error('probe() not implemented yet');
  }

  private async fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
    // TODO: Implement range fetch
    throw new Error('fetchRange() not implemented yet');
  }

  private repackSingleLevel(probe: Ktx2ProbeResult, level: number, payload: Uint8Array): Uint8Array {
    // TODO: Implement repack
    throw new Error('repackSingleLevel() not implemented yet');
  }

  private async transcode(miniKtx: Uint8Array): Promise<Ktx2TranscodeResult> {
    // TODO: Implement transcode routing
    throw new Error('transcode() not implemented yet');
  }

  private createTexture(probe: Ktx2ProbeResult): pc.Texture {
    const texture = new pc.Texture(this.app.graphicsDevice, {
      width: probe.width,
      height: probe.height,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_REPEAT,
    });

    texture.name = `ktx2_${probe.url.split('/').pop()}`;
    
    return texture;
  }

  private uploadMipLevel(texture: pc.Texture, level: number, result: Ktx2TranscodeResult): void {
    // TODO: Implement GPU upload
    if (this.config.verbose) {
      console.log(`[KTX2] Uploading level ${level} to GPU: ${result.width}x${result.height}`);
    }
  }

  private applyTextureToEntity(entity: pc.Entity, texture: pc.Texture): void {
    const model = entity.model;
    if (model && model.meshInstances.length > 0) {
      const material = model.meshInstances[0].material as pc.StandardMaterial;
      if (material) {
        material.diffuseMap = texture;
        material.update();
      }
    }
  }

  private calculateStartLevel(entity: pc.Entity, baseW: number, baseH: number, levelCount: number): number {
    // TODO: Implement adaptive start level calculation
    return levelCount - 1;
  }
}

export default Ktx2ProgressiveLoader;
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
import { PIXELFORMAT_SRGBA8, PIXELFORMAT_RGBA8 } from 'playcanvas';
import type {
  Ktx2LoaderConfig,
  Ktx2ProbeResult,
  Ktx2TranscodeResult,
  Ktx2LevelInfo,
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

  /**
   * Initialize libktx module on main thread (fallback when worker is disabled)
   */
  private async initMainThreadModule(libktxModuleUrl?: string, libktxWasmUrl?: string): Promise<void> {
    if (this.config.verbose) {
      console.log('[KTX2] Loading libktx module on main thread...');
    }

    try {
      // Fetch and evaluate libktx.mjs as a script
      // This works in AMD/PlayCanvas environment
      const scriptUrl = libktxModuleUrl;

      if (!scriptUrl) {
        throw new Error('libktxModuleUrl is required. Pass app.assets.find("libktx.mjs").getFileUrl()');
      }

      // Load the script and get the factory function
      const createKtxModule = await this.loadLibktxScript(scriptUrl);

      // Initialize the module
      const moduleConfig: any = {};
      if (libktxWasmUrl) {
        moduleConfig.locateFile = (filename: string) => {
          if (filename.endsWith('.wasm')) {
            return libktxWasmUrl;
          }
          return filename;
        };
      }

      this.ktxModule = await createKtxModule(moduleConfig);

      if (!this.ktxModule) {
        throw new Error('Failed to create KTX module');
      }

      // Create API wrappers
      const module = this.ktxModule;
      this.ktxApi = {
        malloc: module.cwrap('malloc', 'number', ['number']) as (size: number) => number,
        free: module.cwrap('free', null, ['number']) as (ptr: number) => void,
        createFromMemory: module.cwrap('ktxTexture_CreateFromMemory', 'number', ['number', 'number', 'number', 'number']) as (data: number, size: number, flags: number, outPtr: number) => number,
        destroy: module.cwrap('ktxTexture_Destroy', null, ['number']) as (texPtr: number) => void,
        transcode: module.cwrap('ktxTexture2_TranscodeBasis', 'number', ['number', 'number', 'number']) as (texPtr: number, format: number, flags: number) => number,
        needsTranscoding: module.cwrap('ktxTexture2_NeedsTranscoding', 'number', ['number']) as (texPtr: number) => number,
        getData: module.cwrap('ktxTexture_GetData', 'number', ['number']) as (texPtr: number) => number,
        getDataSize: module.cwrap('ktxTexture_GetDataSize', 'number', ['number']) as (texPtr: number) => number,
        getWidth: module.cwrap('ktxTexture_GetBaseWidth', 'number', ['number']) as (texPtr: number) => number,
        getHeight: module.cwrap('ktxTexture_GetBaseHeight', 'number', ['number']) as (texPtr: number) => number,
        errorString: (code: number) => `Error code: ${code}`,
        HEAPU8: module.HEAPU8,
      };

      if (this.config.verbose) {
        console.log('[KTX2] libktx module loaded successfully');
      }
    } catch (error) {
      console.error('[KTX2] Failed to load libktx module:', error);
      throw error;
    }
  }

  /**
   * Load libktx.mjs script dynamically
   * Works in AMD/PlayCanvas environment
   */
  private async loadLibktxScript(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // Fetch the script text
      fetch(url)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status}`);
          }
          return response.text();
        })
        .then(scriptText => {
          // Remove export statement to make it work in global scope
          // libktx.mjs exports: export default Module;
          const modifiedScript = scriptText.replace(/export\s+default\s+(\w+);?/g, 'window.libktxModule = $1;');

          // Create and execute script
          const script = document.createElement('script');
          script.textContent = modifiedScript;

          script.onload = () => {
            const createModule = (window as any).libktxModule;
            if (!createModule) {
              reject(new Error('libktxModule not found in window after script load'));
              return;
            }

            // Cleanup
            delete (window as any).libktxModule;
            script.remove();

            resolve(createModule);
          };

          script.onerror = () => {
            reject(new Error(`Failed to load libktx script from ${url}`));
            script.remove();
          };

          document.head.appendChild(script);
        })
        .catch(reject);
    });
  }

  /**
   * Probe KTX2 file: fetch header, parse metadata, determine range support
   */
  private async probe(url: string): Promise<Ktx2ProbeResult> {
    if (this.config.verbose) {
      console.log('[KTX2] Probing:', url);
    }

    // Step 1: HEAD request to get file size and check range support
    let totalSize = 0;
    let supportsRanges = false;

    try {
      const headResponse = await fetch(url, { method: 'HEAD' });

      if (!headResponse.ok) {
        throw new Error(`HEAD request failed: ${headResponse.status} ${headResponse.statusText}`);
      }

      // Get file size
      const contentLength = headResponse.headers.get('Content-Length');
      if (contentLength) {
        totalSize = parseInt(contentLength, 10);
      }

      // Check range support
      const acceptRanges = headResponse.headers.get('Accept-Ranges');
      supportsRanges = acceptRanges === 'bytes';

      if (this.config.verbose) {
        console.log('[KTX2] HEAD response:', {
          fileSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
          supportsRanges,
        });
      }
    } catch (error) {
      console.warn('[KTX2] HEAD request failed, will try GET:', error);
    }

    // Step 2: Fetch header (80 bytes) + estimate for level index
    // We'll fetch 4KB to be safe (covers header + many mip levels)
    const initialFetchSize = 4096;
    const headerBytes = await this.fetchRange(url, 0, initialFetchSize - 1);

    // Step 3: Parse KTX2 header
    const view = new DataView(headerBytes.buffer, headerBytes.byteOffset);

    // Validate identifier
    const identifier = new Uint8Array(headerBytes.buffer, headerBytes.byteOffset, 12);
    const expectedIdentifier = new Uint8Array([
      0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A
    ]);

    for (let i = 0; i < 12; i++) {
      if (identifier[i] !== expectedIdentifier[i]) {
        throw new Error(`Invalid KTX2 identifier at byte ${i}: expected ${expectedIdentifier[i]}, got ${identifier[i]}`);
      }
    }

    // Parse header fields (all uint32 except sgd which is uint64)
    const vkFormat = view.getUint32(12, true);
    const typeSize = view.getUint32(16, true);
    const pixelWidth = view.getUint32(20, true);
    const pixelHeight = view.getUint32(24, true);
    const pixelDepth = view.getUint32(28, true);
    const layerCount = view.getUint32(32, true);
    const faceCount = view.getUint32(36, true);
    const levelCount = view.getUint32(40, true);
    const supercompressionScheme = view.getUint32(44, true);

    // Parse descriptor offsets/lengths
    const dfdOff = view.getUint32(48, true);
    const dfdLen = view.getUint32(52, true);
    const kvdOff = view.getUint32(56, true);
    const kvdLen = view.getUint32(60, true);
    const sgdOff = readU64asNumber(view, 64);
    const sgdLen = readU64asNumber(view, 72);

    // Step 4: Parse level index (starts at byte 80)
    const levelIndexSize = Math.max(1, levelCount) * 24; // 24 bytes per level
    const levels: Ktx2LevelInfo[] = [];

    for (let i = 0; i < levelCount; i++) {
      const offset = 80 + i * 24;
      const byteOffset = readU64asNumber(view, offset);
      const byteLength = readU64asNumber(view, offset + 8);
      const uncompressedByteLength = readU64asNumber(view, offset + 16);

      levels.push({
        byteOffset,
        byteLength,
        uncompressedByteLength,
      });
    }

    // Step 5: Fetch DFD (Data Format Descriptor) to get color space
    const dfd = dfdLen > 0 ? await this.fetchRange(url, dfdOff, dfdOff + dfdLen - 1) : new Uint8Array(0);
    const colorSpace = parseDFDColorSpace(dfd, this.config.verbose);

    // Step 6: Fetch KVD and SGD if needed (for now we just allocate empty)
    const kvd = kvdLen > 0 ? await this.fetchRange(url, kvdOff, kvdOff + kvdLen - 1) : new Uint8Array(0);
    const sgd = sgdLen > 0 ? await this.fetchRange(url, sgdOff, sgdOff + sgdLen - 1) : new Uint8Array(0);

    // Update total size if we didn't get it from HEAD
    if (totalSize === 0 && levels.length > 0) {
      const lastLevel = levels[levels.length - 1];
      totalSize = lastLevel.byteOffset + lastLevel.byteLength;
    }

    const result: Ktx2ProbeResult = {
      url,
      totalSize,
      supportsRanges,
      headerSize: 80 + levelIndexSize,
      headerBytes: new Uint8Array(headerBytes.buffer, headerBytes.byteOffset, 80 + levelIndexSize),
      levelCount,
      layerCount,
      faceCount,
      pixelDepth,
      levelIndexSize,
      levels,
      dfd,
      kvd,
      sgd,
      dfdOff,
      dfdLen,
      kvdOff,
      kvdLen,
      sgdOff,
      sgdLen,
      width: pixelWidth,
      height: pixelHeight,
      colorSpace,
    };

    if (this.config.verbose) {
      console.log('[KTX2] Probe complete:', {
        size: `${pixelWidth}x${pixelHeight}`,
        levels: levelCount,
        fileSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
        colorSpace: colorSpace.isSrgb ? 'sRGB' : 'Linear',
        supportsRanges,
      });
    }

    return result;
  }

  /**
   * Fetch a byte range from URL
   * Uses Range header if supported, falls back to full GET
   */
  private async fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
    try {
      // Try range request first
      const response = await fetch(url, {
        headers: {
          'Range': `bytes=${start}-${end}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      // Check if server supports ranges (206 Partial Content)
      if (response.status === 206) {
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      }

      // Server returned 200 (full content) - extract the range we need
      if (response.status === 200) {
        const arrayBuffer = await response.arrayBuffer();
        const fullData = new Uint8Array(arrayBuffer);

        // Return the requested slice
        return fullData.slice(start, end + 1);
      }

      throw new Error(`Unexpected response status: ${response.status}`);
    } catch (error) {
      // Fallback: fetch entire file and slice
      if (this.config.verbose) {
        console.warn(`[KTX2] Range request failed (${start}-${end}), falling back to full fetch:`, error);
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Fallback fetch failed: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const fullData = new Uint8Array(arrayBuffer);

      return fullData.slice(start, end + 1);
    }
  }

  /**
   * Repack a single mipmap level into a valid mini-KTX2 file
   * This creates a minimal KTX2 file containing just one level that libktx can transcode
   *
   * Structure:
   * 1. KTX2 Header (80 bytes) - modified to show levelCount=1
   * 2. Level Index (24 bytes) - single entry pointing to data
   * 3. DFD (Data Format Descriptor) - copied from original
   * 4. KVD (Key-Value Data) - copied from original
   * 5. SGD (Supercompression Global Data) - copied from original
   * 6. Mipmap data - the actual payload
   */
  private repackSingleLevel(probe: Ktx2ProbeResult, level: number, payload: Uint8Array): Uint8Array {
    const levelInfo = probe.levels[level];
    if (!levelInfo) {
      throw new Error(`Level ${level} not found in probe result`);
    }

    // Calculate sizes for the mini-KTX2 file
    const headerSize = 80;
    const levelIndexSize = 24; // Single level entry (3 × uint64)

    // Align sections according to KTX2 spec
    let offset = headerSize + levelIndexSize;

    // DFD offset (must be 4-byte aligned)
    const dfdOffset = alignValue(offset, 4);
    const dfdLength = probe.dfd.length;
    offset = dfdOffset + dfdLength;

    // KVD offset (must be 4-byte aligned)
    const kvdOffset = alignValue(offset, 4);
    const kvdLength = probe.kvd.length;
    offset = kvdOffset + kvdLength;

    // SGD offset (must be 8-byte aligned)
    const sgdOffset = alignValue(offset, 8);
    const sgdLength = probe.sgd.length;
    offset = sgdOffset + sgdLength;

    // Mipmap data offset (must be 8-byte aligned)
    const dataOffset = alignValue(offset, 8);
    const dataLength = payload.length;

    // Total mini-KTX2 size
    const totalSize = dataOffset + dataLength;

    // Create buffer for mini-KTX2
    const miniKtx = new Uint8Array(totalSize);
    const view = new DataView(miniKtx.buffer);

    // ========================================================================
    // 1. Write KTX2 Header (80 bytes)
    // ========================================================================

    // Identifier (12 bytes)
    const identifier = new Uint8Array([
      0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A
    ]);
    miniKtx.set(identifier, 0);

    // Copy header fields from probe (or reconstruct from original headerBytes)
    const origView = new DataView(probe.headerBytes.buffer, probe.headerBytes.byteOffset);

    // Copy vkFormat, typeSize (bytes 12-19)
    view.setUint32(12, origView.getUint32(12, true), true); // vkFormat
    view.setUint32(16, origView.getUint32(16, true), true); // typeSize

    // Calculate dimensions for this mip level
    const mipWidth = Math.max(1, probe.width >> level);
    const mipHeight = Math.max(1, probe.height >> level);

    view.setUint32(20, mipWidth, true);  // pixelWidth
    view.setUint32(24, mipHeight, true); // pixelHeight
    view.setUint32(28, origView.getUint32(28, true), true); // pixelDepth
    view.setUint32(32, origView.getUint32(32, true), true); // layerCount
    view.setUint32(36, origView.getUint32(36, true), true); // faceCount
    view.setUint32(40, 1, true); // levelCount = 1 (THIS IS KEY!)
    view.setUint32(44, origView.getUint32(44, true), true); // supercompressionScheme

    // Write descriptor offsets/lengths
    view.setUint32(48, dfdOffset, true); // dfdByteOffset
    view.setUint32(52, dfdLength, true); // dfdByteLength
    view.setUint32(56, kvdOffset, true); // kvdByteOffset
    view.setUint32(60, kvdLength, true); // kvdByteLength
    writeU64(view, 64, sgdOffset);       // sgdByteOffset (uint64)
    writeU64(view, 72, sgdLength);       // sgdByteLength (uint64)

    // ========================================================================
    // 2. Write Level Index (24 bytes) - single entry
    // ========================================================================

    const levelIndexOffset = 80;
    writeU64(view, levelIndexOffset, dataOffset);                         // byteOffset
    writeU64(view, levelIndexOffset + 8, dataLength);                     // byteLength
    writeU64(view, levelIndexOffset + 16, levelInfo.uncompressedByteLength); // uncompressedByteLength

    // ========================================================================
    // 3. Write DFD (Data Format Descriptor)
    // ========================================================================

    if (dfdLength > 0) {
      miniKtx.set(probe.dfd, dfdOffset);
    }

    // ========================================================================
    // 4. Write KVD (Key-Value Data)
    // ========================================================================

    if (kvdLength > 0) {
      miniKtx.set(probe.kvd, kvdOffset);
    }

    // ========================================================================
    // 5. Write SGD (Supercompression Global Data)
    // ========================================================================

    if (sgdLength > 0) {
      miniKtx.set(probe.sgd, sgdOffset);
    }

    // ========================================================================
    // 6. Write Mipmap Data
    // ========================================================================

    miniKtx.set(payload, dataOffset);

    if (this.config.verbose) {
      console.log(`[KTX2] Repacked level ${level}:`, {
        originalSize: `${(levelInfo.byteLength / 1024).toFixed(2)} KB`,
        miniKtxSize: `${(totalSize / 1024).toFixed(2)} KB`,
        dimensions: `${mipWidth}x${mipHeight}`,
        overhead: `${((totalSize - dataLength) / 1024).toFixed(2)} KB`,
      });
    }

    return miniKtx;
  }

  /**
   * Transcode mini-KTX2 to RGBA using libktx
   * Routes to worker if available, otherwise uses main thread
   */
  private async transcode(miniKtx: Uint8Array): Promise<Ktx2TranscodeResult> {
    // For now, use main thread (worker implementation is TODO)
    if (!this.ktxApi || !this.ktxModule) {
      throw new Error('libktx not initialized. Call initialize() first.');
    }

    return this.transcodeMainThread(miniKtx);
  }

  /**
   * Transcode on main thread using libktx
   */
  private transcodeMainThread(miniKtx: Uint8Array): Ktx2TranscodeResult {
    if (!this.ktxApi || !this.ktxModule) {
      throw new Error('libktx not initialized');
    }

    const heapBefore = this.ktxModule.HEAPU8.length;

    // Allocate memory for the mini-KTX2 data
    const dataPtr = this.ktxApi.malloc(miniKtx.byteLength);
    if (!dataPtr) {
      throw new Error('Failed to allocate memory for KTX2 data');
    }

    try {
      // Copy mini-KTX2 data to WASM heap
      this.ktxModule.HEAPU8.set(miniKtx, dataPtr);

      // Create texture from memory
      const texPtrPtr = this.ktxApi.malloc(4); // Pointer to pointer
      const createFlags = 0; // KTX_TEXTURE_CREATE_NO_FLAGS

      const createResult = this.ktxApi.createFromMemory(
        dataPtr,
        miniKtx.byteLength,
        createFlags,
        texPtrPtr
      );

      if (createResult !== 0) {
        throw new Error(`ktxTexture_CreateFromMemory failed: ${this.ktxApi.errorString(createResult)}`);
      }

      // Get texture pointer
      const texPtr = this.ktxModule.getValue(texPtrPtr, 'i32');
      this.ktxApi.free(texPtrPtr);

      if (!texPtr) {
        throw new Error('Failed to get texture pointer');
      }

      // Check if transcoding is needed
      const needsTranscoding = this.ktxApi.needsTranscoding(texPtr);

      if (needsTranscoding) {
        // Transcode to RGBA32 (format 13 in libktx)
        const RGBA32_FORMAT = 13;
        const transcodeFlags = 0;

        const transcodeResult = this.ktxApi.transcode(texPtr, RGBA32_FORMAT, transcodeFlags);

        if (transcodeResult !== 0) {
          this.ktxApi.destroy(texPtr);
          throw new Error(`ktxTexture2_TranscodeBasis failed: ${this.ktxApi.errorString(transcodeResult)}`);
        }
      }

      // Get transcoded data
      const dataSize = this.ktxApi.getDataSize(texPtr);
      const dataOffset = this.ktxApi.getData(texPtr);
      const width = this.ktxApi.getWidth(texPtr);
      const height = this.ktxApi.getHeight(texPtr);

      if (!dataSize || !dataOffset) {
        this.ktxApi.destroy(texPtr);
        throw new Error('Failed to get texture data');
      }

      // Copy data from WASM heap
      const rgbaData = new Uint8Array(dataSize);
      rgbaData.set(this.ktxModule.HEAPU8.subarray(dataOffset, dataOffset + dataSize));

      // Cleanup
      this.ktxApi.destroy(texPtr);
      this.ktxApi.free(dataPtr);

      const heapAfter = this.ktxModule.HEAPU8.length;
      const heapFreed = Math.max(0, heapBefore - heapAfter);

      return {
        width,
        height,
        data: rgbaData,
        heapStats: {
          before: heapBefore,
          after: heapAfter,
          freed: heapFreed,
        },
      };

    } catch (error) {
      // Cleanup on error
      this.ktxApi.free(dataPtr);
      throw error;
    }
  }

  private createTexture(probe: Ktx2ProbeResult): pc.Texture {
    // Determine pixel format based on colorspace
    // In PlayCanvas 2.x, color textures (diffuse, albedo, etc) should use sRGB formats
    // Linear formats are used for data textures (normal maps, roughness, etc)
    const useSrgb = this.config.isSrgb || probe.colorSpace?.isSrgb;
    const format = useSrgb ? PIXELFORMAT_SRGBA8 : PIXELFORMAT_RGBA8;

    const texture = new pc.Texture(this.app.graphicsDevice, {
      width: probe.width,
      height: probe.height,
      format: format,
      mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_REPEAT,
    });

    texture.name = `ktx2_${probe.url.split('/').pop()}`;

    if (this.config.verbose) {
      console.log(`[KTX2] Created texture with format: ${useSrgb ? 'SRGBA8' : 'RGBA8'}`);
    }

    return texture;
  }

  /**
   * Upload RGBA mipmap data to GPU texture
   *
   * Note: This uses WebGL2 API directly for mipmap levels > 0
   * PlayCanvas 2.x supports WebGL2 only (WebGL1 support was removed in v2.0)
   */
  private uploadMipLevel(texture: pc.Texture, level: number, result: Ktx2TranscodeResult): void {
    if (!result.data || result.data.length === 0) {
      console.error(`[KTX2] Cannot upload level ${level}: empty data`);
      return;
    }

    try {
      // Upload to GPU using PlayCanvas Texture API
      if (level === 0) {
        // For the first level, use PlayCanvas API
        const pixels = texture.lock();
        if (pixels) {
          pixels.set(result.data);
          texture.unlock();
        }
      } else {
        // For subsequent mip levels, we need to use WebGL2 directly
        // PlayCanvas doesn't expose a high-level API for uploading specific mip levels
        const device = this.app.graphicsDevice;
        const gl = (device as any).gl as WebGL2RenderingContext | null;

        if (!gl) {
          console.error('[KTX2] WebGL2 context not available');
          return;
        }

        // Bind the texture
        const webglTexture = (texture as any)._glTexture;
        if (!webglTexture) {
          console.error('[KTX2] WebGL texture not found');
          return;
        }

        gl.bindTexture(gl.TEXTURE_2D, webglTexture);

        // Determine internal format based on texture format
        // PlayCanvas 2.x requires correct sRGB internal formats
        const useSrgb = this.config.isSrgb;
        const internalFormat = useSrgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;

        // Upload the mipmap level
        // texImage2D(target, level, internalformat, width, height, border, format, type, pixels)
        gl.texImage2D(
          gl.TEXTURE_2D,
          level,
          internalFormat,
          result.width,
          result.height,
          0,
          gl.RGBA,  // format (always RGBA for source data)
          gl.UNSIGNED_BYTE,
          result.data
        );

        // Unbind
        gl.bindTexture(gl.TEXTURE_2D, null);
      }

      if (this.config.verbose) {
        console.log(
          `[KTX2] Uploaded level ${level} to GPU: ${result.width}x${result.height} ` +
          `(${(result.data.byteLength / 1024).toFixed(2)} KB)`
        );
      }
    } catch (error) {
      console.error(`[KTX2] Failed to upload level ${level}:`, error);
    }
  }

  private applyTextureToEntity(entity: pc.Entity, texture: pc.Texture): void {
    const model = entity.model;
    if (model && model.meshInstances && model.meshInstances.length > 0) {
      const material = model.meshInstances[0].material as pc.StandardMaterial;
      if (material) {
        material.diffuseMap = texture;
        material.update();
      }
    }
  }

  /**
   * Calculate which mipmap level to start loading from based on screen size
   *
   * Algorithm:
   * 1. Get entity's bounding box (AABB)
   * 2. Project to screen space using camera
   * 3. Calculate screen size in pixels
   * 4. Find mipmap level where resolution >= screen size * margin
   *
   * @param entity Entity with model component
   * @param baseW Base texture width (mip level 0)
   * @param baseH Base texture height (mip level 0)
   * @param levelCount Total number of mipmap levels
   * @returns Starting mipmap level index (0 = highest res, levelCount-1 = lowest res)
   */
  private calculateStartLevel(entity: pc.Entity, baseW: number, baseH: number, levelCount: number): number {
    try {
      // Get the camera
      const cameraSystem = this.app.systems.camera;
      if (!cameraSystem || !cameraSystem.cameras || cameraSystem.cameras.length === 0) {
        if (this.config.verbose) {
          console.warn('[KTX2] No camera found, starting from lowest res');
        }
        return levelCount - 1;
      }

      const camera = cameraSystem.cameras[0];
      if (!camera || !camera.camera) {
        return levelCount - 1;
      }

      // Get entity's bounding box
      const model = entity.model;
      if (!model || !model.meshInstances || model.meshInstances.length === 0) {
        if (this.config.verbose) {
          console.warn('[KTX2] Entity has no mesh instances, starting from lowest res');
        }
        return levelCount - 1;
      }

      const meshInstance = model.meshInstances[0];
      const aabb = meshInstance.aabb;

      if (!aabb) {
        if (this.config.verbose) {
          console.warn('[KTX2] No AABB found, starting from lowest res');
        }
        return levelCount - 1;
      }

      // Get AABB corners in world space
      const worldMin = aabb.getMin();
      const worldMax = aabb.getMax();

      // Calculate screen size in pixels
      const device = this.app.graphicsDevice;
      const screenWidth = device.width;
      const screenHeight = device.height;

      // Project AABB to screen space
      // worldToScreen(worldCoord, cameraWidth, cameraHeight) returns Vec3
      const screenMin = camera.camera.worldToScreen(worldMin, screenWidth, screenHeight);
      const screenMax = camera.camera.worldToScreen(worldMax, screenWidth, screenHeight);

      if (!screenMin || !screenMax) {
        if (this.config.verbose) {
          console.warn('[KTX2] Failed to project to screen space, starting from lowest res');
        }
        return levelCount - 1;
      }

      // Convert normalized coords to pixels and get bounds
      const minX = Math.min(screenMin.x, screenMax.x) * screenWidth;
      const maxX = Math.max(screenMin.x, screenMax.x) * screenWidth;
      const minY = Math.min(screenMin.y, screenMax.y) * screenHeight;
      const maxY = Math.max(screenMin.y, screenMax.y) * screenHeight;

      const screenSizeX = Math.abs(maxX - minX);
      const screenSizeY = Math.abs(maxY - minY);

      // Use the larger dimension
      const targetScreenSize = Math.max(screenSizeX, screenSizeY);

      if (this.config.verbose) {
        console.log('[KTX2] Adaptive calculation:', {
          screenSize: `${screenSizeX.toFixed(0)}x${screenSizeY.toFixed(0)} px`,
          targetSize: `${targetScreenSize.toFixed(0)} px`,
          baseTextureSize: `${baseW}x${baseH}`,
        });
      }

      // Find the appropriate mipmap level
      // Level 0 = full resolution (baseW × baseH)
      // Level 1 = baseW/2 × baseH/2
      // etc.

      // Start from lowest res and work up
      for (let level = levelCount - 1; level >= 0; level--) {
        const mipWidth = Math.max(1, baseW >> level);
        const mipHeight = Math.max(1, baseH >> level);
        const mipSize = Math.max(mipWidth, mipHeight);

        // If this mip is >= target size * margin, use it
        if (mipSize >= targetScreenSize * this.config.adaptiveMargin) {
          if (this.config.verbose) {
            console.log(`[KTX2] Starting from level ${level} (${mipWidth}x${mipHeight})`);
          }
          return level;
        }
      }

      // If we get here, even the highest res isn't enough, so start from level 0
      if (this.config.verbose) {
        console.log('[KTX2] Starting from highest res (level 0)');
      }
      return 0;

    } catch (error) {
      console.error('[KTX2] Error calculating start level:', error);
      return levelCount - 1;
    }
  }
}

export default Ktx2ProgressiveLoader;
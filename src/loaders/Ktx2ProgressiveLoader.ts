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
  Ktx2LevelInfo,
  OnProgressCallback,
  OnCompleteCallback,
  LoadStats,
  MipLoadInfo,
  KtxModule,
  KtxApi,
} from './ktx2-types';
import { KtxCacheManager } from './KtxCacheManager';
import { MemoryPool } from './MemoryPool';
import { GpuFormatDetector, TextureFormat } from './GpuFormatDetector';
import { alignValue, readU64asNumber, writeU64 } from './utils/alignment';
import { parseDFDColorSpace } from './utils/colorspace';
import { LibktxLoader } from '../libs/libktx/LibktxLoader';
import { FRAMEWORK_VERSION, LIBKTX_VERSION, MESHOPT_VERSION } from '../version';
import { WORKER_CODE } from './worker-inline';

export class Ktx2ProgressiveLoader {
  private app: pc.Application;
  private config: Required<Omit<Ktx2LoaderConfig, 'libktxModuleUrl' | 'libktxWasmUrl'>> &
    Pick<Ktx2LoaderConfig, 'libktxModuleUrl' | 'libktxWasmUrl'>;

  // Log levels: 0=silent, 1=errors, 2=important, 3=detailed
  private readonly LOG_ERROR = 1;
  private readonly LOG_INFO = 2;
  private readonly LOG_VERBOSE = 3;
  
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

  // KTX API (cwrap wrappers)
  private ktxApi: KtxApi | null = null;

  // Cache manager
  private cacheManager: KtxCacheManager | null = null;

  // Memory pool
  private memoryPool: MemoryPool | null = null;

  // GPU format detector
  private gpuFormatDetector: GpuFormatDetector | null = null;

  // Custom material for LOD control
  private customMaterial: pc.StandardMaterial | null = null;

  // FPS tracking and adaptive throttling
  private fpsHistory: number[] = [];
  private lastFpsCheckTime = 0;
  private currentStepDelay = 0;
  private rafId: number | null = null;

  // Pause/resume control
  private isPaused = false;
  private pauseResolve: (() => void) | null = null;

  // Adaptive loading state
  private lastUpdateCheck = 0;
  private currentTargetLod: number | undefined;
  private loadedEntity: pc.Entity | null = null;
  private probeData: Ktx2ProbeResult | null = null;
  private activeTexture: pc.Texture | null = null;
  private minLoadedLod: number = Infinity;
  private maxLoadedLod: number = -Infinity;

  constructor(app: pc.Application, config: Ktx2LoaderConfig) {
    this.app = app;
    
    // Set defaults
    this.config = {
      ktxUrl: config.ktxUrl,
      libktxModuleUrl: config.libktxModuleUrl,
      libktxWasmUrl: config.libktxWasmUrl,
      progressive: config.progressive ?? true,
      isSrgb: config.isSrgb ?? false,
      stepDelayMs: config.stepDelayMs ?? 150,
      verbose: config.verbose ?? true,
      maxRgbaBytes: config.maxRgbaBytes ?? 67108864, // 64MB
      enableAniso: config.enableAniso ?? true,
      adaptiveLoading: config.adaptiveLoading ?? false,
      adaptiveMargin: config.adaptiveMargin ?? 1.5,
      adaptiveUpdateInterval: config.adaptiveUpdateInterval ?? 0.5,
      useWorker: config.useWorker ?? true,
      minFrameInterval: config.minFrameInterval ?? 16, // 60fps
      enableCache: config.enableCache ?? true,
      cacheMaxAgeDays: config.cacheMaxAgeDays ?? 7,
      adaptiveThrottling: config.adaptiveThrottling ?? false,
      targetFps: config.targetFps ?? 60,
      maxStepDelayMs: config.maxStepDelayMs ?? 500,
      minStepDelayMs: config.minStepDelayMs ?? 0,
      logLevel: config.logLevel ?? (config.verbose ? 3 : 2),
      enableMemoryPool: config.enableMemoryPool ?? true,
      memoryPoolMaxSize: config.memoryPoolMaxSize ?? 128 * 1024 * 1024, // 128 MB
      assembleFullKtx: config.assembleFullKtx ?? false,
      cacheFullKtx: config.cacheFullKtx ?? false,
    };

    // Initialize current step delay
    this.currentStepDelay = this.config.stepDelayMs;

    // Initialize memory pool
    if (this.config.enableMemoryPool) {
      this.memoryPool = new MemoryPool(this.config.memoryPoolMaxSize);
    }
  }

  // ============================================================================
  // Logging Helpers
  // ============================================================================

  private log(level: number, ...args: any[]): void {
    if (this.config.logLevel >= level) {
      console.log(...args);
    }
  }

  private logError(...args: any[]): void {
    if (this.config.logLevel >= this.LOG_ERROR) {
      console.error(...args);
    }
  }

  private logWarn(...args: any[]): void {
    if (this.config.logLevel >= this.LOG_INFO) {
      console.warn(...args);
    }
  }

  /**
   * Map KtxTranscodeFormat (number) to GpuFormatDetector.TextureFormat (enum)
   */
  private getTextureFormatFromTranscodeFormat(transcodeFormat: number): TextureFormat {
    // Map transcode format number to TextureFormat enum
    switch (transcodeFormat) {
      case 0: return TextureFormat.ETC1_RGB;
      case 1: return TextureFormat.ETC2_RGBA;
      case 2: return TextureFormat.BC1_RGB;
      case 3: return TextureFormat.BC3_RGBA;
      case 6: return TextureFormat.BC7_RGBA;
      case 8: return TextureFormat.PVRTC1_4_RGB;
      case 9: return TextureFormat.PVRTC1_4_RGBA;
      case 10: return TextureFormat.ASTC_4x4;
      default: return TextureFormat.RGBA8;
    }
  }

  /**
   * Select best transcode format based on GPU capabilities
   * Maps GpuFormatDetector.TextureFormat to KtxTranscodeFormat
   */
  private selectTranscodeFormat(hasAlpha: boolean): { format: number; isCompressed: boolean } {
    if (!this.gpuFormatDetector) {
      // Fallback to RGBA if detector not initialized
      return { format: 13, isCompressed: false }; // RGBA32
    }

    const capabilities = this.gpuFormatDetector.getCapabilities();

    // Priority order: ASTC > BC7 > ETC2 > BC3 > ETC1 > PVRTC > RGBA

    // Modern mobile - ASTC (best quality/compression ratio)
    if (capabilities.astc) {
      this.log(this.LOG_VERBOSE, '[KTX2] Using ASTC_4x4_RGBA format');
      return { format: 10, isCompressed: true }; // ASTC_4x4_RGBA
    }

    // Modern desktop - BC7 (best quality)
    if (capabilities.bptc) {
      this.log(this.LOG_VERBOSE, '[KTX2] Using BC7_RGBA format');
      return { format: 6, isCompressed: true }; // BC7_RGBA
    }

    // Modern mobile/iOS - ETC2
    if (capabilities.etc) {
      if (hasAlpha) {
        this.log(this.LOG_VERBOSE, '[KTX2] Using ETC2_RGBA format');
        return { format: 1, isCompressed: true }; // ETC2_RGBA
      } else {
        this.log(this.LOG_VERBOSE, '[KTX2] Using ETC2_RGB format (no alpha)');
        return { format: 0, isCompressed: true }; // ETC1_RGB (libktx uses same value for ETC2_RGB)
      }
    }

    // Desktop - BC1/BC3 (DXT1/DXT5)
    if (capabilities.s3tc) {
      if (hasAlpha) {
        this.log(this.LOG_VERBOSE, '[KTX2] Using BC3_RGBA format');
        return { format: 3, isCompressed: true }; // BC3_RGBA
      } else {
        this.log(this.LOG_VERBOSE, '[KTX2] Using BC1_RGB format');
        return { format: 2, isCompressed: true }; // BC1_RGB
      }
    }

    // Legacy Android - ETC1 (no alpha support)
    if (capabilities.etc1 && !hasAlpha) {
      this.log(this.LOG_VERBOSE, '[KTX2] Using ETC1_RGB format');
      return { format: 0, isCompressed: true }; // ETC1_RGB
    }

    // Legacy iOS - PVRTC
    if (capabilities.pvrtc) {
      if (hasAlpha) {
        this.log(this.LOG_VERBOSE, '[KTX2] Using PVRTC1_4_RGBA format');
        return { format: 9, isCompressed: true }; // PVRTC1_4_RGBA
      } else {
        this.log(this.LOG_VERBOSE, '[KTX2] Using PVRTC1_4_RGB format');
        return { format: 8, isCompressed: true }; // PVRTC1_4_RGB
      }
    }

    // Fallback to uncompressed RGBA
    this.log(this.LOG_INFO, '[KTX2] No compressed formats supported, using RGBA32');
    return { format: 13, isCompressed: false }; // RGBA32
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Register custom shader chunk for progressive LOD clamping
   * This allows the shader to clamp LOD to the available mipmap range
   */
  private createShaderChunk(): void {
    const device = this.app.graphicsDevice;

    // ----------------------------------------------------------------
    // GLSL (WebGL2)
    // ----------------------------------------------------------------
    const glslChunks = (pc as any).ShaderChunks.get(device, 'glsl');
    glslChunks.set('diffusePS', `
// diffusePS — Progressive LOD with hardware anisotropic filtering
uniform sampler2D texture_diffuseMap;
uniform float material_minAvailableLod; // min LOD (best quality available)
uniform float material_maxAvailableLod; // max LOD (worst quality available)

void getAlbedo() {
    dAlbedo = vec3(1.0);
    #ifdef STD_DIFFUSE_TEXTURE
        vec2 uv = {STD_DIFFUSE_TEXTURE_UV};

        // Calculate derivatives in normalized UV space
        vec2 dudx = dFdx(uv);
        vec2 dudy = dFdy(uv);

        // Get texture size at the base (best available) level
        // This is critical for progressive loading - use minAvailableLod, not 0!
        int baseLod = int(material_minAvailableLod);
        vec2 texSize = vec2(textureSize(texture_diffuseMap, baseLod));

        // Convert UV derivatives to texel space
        vec2 duvdx = dudx * texSize;
        vec2 duvdy = dudy * texSize;

        // Calculate both major and minor axis for anisotropic filtering
        // This is important for sharp angles where one axis stretches more than the other
        float majorAxis2 = max(dot(duvdx, duvdx), dot(duvdy, duvdy));
        float minorAxis2 = min(dot(duvdx, duvdx), dot(duvdy, duvdy));

        // Use the minor axis for LOD calculation to prevent over-blurring
        // This is the key for sharp angles - we want the sharpest detail possible
        float autoLod = 0.5 * log2(max(minorAxis2, 1e-8));

        // Clamp LOD to available range [minAvailableLod, maxAvailableLod]
        // This prevents sampling from unavailable mip levels
        float targetLod = clamp(autoLod,
                                material_minAvailableLod,
                                material_maxAvailableLod);

        // Scale derivatives to match target LOD
        // This maintains correct filtering while staying within available mip range
        float scale = exp2(targetLod - autoLod);

        // Sample with hardware anisotropic filtering + trilinear
        // textureGrad respects BASE_LEVEL and MAX_LEVEL set via WebGL
        // Hardware aniso will handle the major/minor axis ratio automatically
        dAlbedo = textureGrad(texture_diffuseMap, uv,
                             dudx * scale, dudy * scale).rgb;
    #endif

    #ifdef STD_DIFFUSE_CONSTANT
        dAlbedo *= material_diffuse.rgb;
    #endif
}
`);

    this.log(this.LOG_INFO, '[KTX2] GLSL shader chunk registered');

    // ----------------------------------------------------------------
    // WGSL (WebGPU)
    // In PlayCanvas, ShaderChunks.useWGSL = true when wgsl.size > 0,
    // so registering here ensures WebGPU picks up our progressive LOD chunk.
    // Differences vs GLSL:
    //   - dFdx/dFdy  → dpdx/dpdy
    //   - textureSize(sampler, lod)  → textureDimensions(texture, u32(lod))
    //   - textureGrad(sampler, uv, dx, dy) → textureSampleGrad(tex, samp, uv, dx, dy)
    //   - float → f32, vec2 → vec2f, vec3 → vec3f
    //   - uniforms accessed via uniform.varname
    // ----------------------------------------------------------------
    try {
      const wgslChunks = (pc as any).ShaderChunks.get(device, 'wgsl');
      wgslChunks.set('diffusePS', `
uniform material_diffuse: vec3f;
uniform material_minAvailableLod: f32;
uniform material_maxAvailableLod: f32;

fn getAlbedo() {
    dAlbedo = vec3f(1.0);
    #ifdef STD_DIFFUSE_TEXTURE
        var uv: vec2f = {STD_DIFFUSE_TEXTURE_UV};

        // Partial derivatives in UV space
        let dudx: vec2f = dpdx(uv);
        let dudy: vec2f = dpdy(uv);

        // Texture size at the best available mip — critical for progressive loading
        let baseLod: u32 = u32(uniform.material_minAvailableLod);
        let texSize: vec2f = vec2f(textureDimensions({STD_DIFFUSE_TEXTURE_NAME}, baseLod));

        // Derivatives in texel space
        let duvdx: vec2f = dudx * texSize;
        let duvdy: vec2f = dudy * texSize;

        // Minor axis LOD — prevents over-blurring at sharp angles
        let minorAxis2: f32 = min(dot(duvdx, duvdx), dot(duvdy, duvdy));
        let autoLod: f32 = 0.5 * log2(max(minorAxis2, 1e-8));

        // Clamp to available mip range [minAvailableLod, maxAvailableLod]
        let targetLod: f32 = clamp(autoLod,
                                   uniform.material_minAvailableLod,
                                   uniform.material_maxAvailableLod);

        // Scale derivatives to stay within available mip range
        let scale: f32 = exp2(targetLod - autoLod);

        dAlbedo = textureSampleGrad(
            {STD_DIFFUSE_TEXTURE_NAME},
            {STD_DIFFUSE_TEXTURE_NAME}Sampler,
            uv, dudx * scale, dudy * scale).rgb;
    #endif

    #ifdef STD_DIFFUSE_VERTEX
        dAlbedo = dAlbedo * saturate3(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
    #endif
}
`);
      this.log(this.LOG_INFO, '[KTX2] WGSL shader chunk registered');
    } catch (e) {
      this.logWarn('[KTX2] Failed to register WGSL shader chunk (non-fatal):', e);
    }
  }

  /**
   * Initialize the loader (load libktx, setup worker, init cache)
   */
  async initialize(): Promise<void> {
    this.log(this.LOG_INFO, '[KTX2] Initializing loader...');
    console.log('[SYSTEM] pc-gameframework: ' + FRAMEWORK_VERSION);
    console.log('[SYSTEM] libktx: ' + LIBKTX_VERSION);
    console.log('[SYSTEM] meshopt: ' + MESHOPT_VERSION);

    // Validate required URLs
    if (!this.config.libktxModuleUrl || !this.config.libktxWasmUrl) {
      throw new Error(
        '[KTX2] libktxModuleUrl and libktxWasmUrl are REQUIRED in config!\n' +
        'Example:\n' +
        '  libktxModuleUrl: "https://raw.githubusercontent.com/user/repo/main/libktx.mjs"\n' +
        '  libktxWasmUrl: "https://raw.githubusercontent.com/user/repo/main/libktx.wasm"'
      );
    }

    // Initialize GPU format detector
    // Pass graphicsDevice — works for both WebGL2 and WebGPU.
    // GpuFormatDetector now reads device.ext* fields (same names on both backends).
    const device = this.app.graphicsDevice;
    this.gpuFormatDetector = new GpuFormatDetector(device);

    this.gpuFormatDetector.logCapabilities();

    // Register custom shader chunk for progressive LOD clamping
    this.createShaderChunk();

    // Initialize cache
    if (this.config.enableCache) {
      this.cacheManager = new KtxCacheManager('ktx2-cache', 2);
      await this.cacheManager.init();

      // Clean old entries
      await this.cacheManager.clearOld(this.config.cacheMaxAgeDays);

      this.log(this.LOG_INFO, '[KTX2] Cache initialized');
    }

    // Initialize worker
    if (this.config.useWorker) {
      const t0 = performance.now();
      const success = await this.initWorker();
      const dt = (performance.now() - t0).toFixed(0);
      if (success) {
        console.log(`[SYSTEM] libktx worker: ${dt}ms — ${this.config.libktxModuleUrl}`);
      } else {
        this.logWarn('[KTX2] Worker initialization failed, will use main thread');
      }
    }

    // Fallback: initialize main thread module
    if (!this.config.useWorker || !this.workerReady) {
      const t0 = performance.now();
      await this.initMainThreadModule();
      const dt = (performance.now() - t0).toFixed(0);
      console.log(`[SYSTEM] libktx main-thread: ${dt}ms — ${this.config.libktxModuleUrl}`);
    }

    this.log(this.LOG_INFO, '[KTX2] Loader ready');
  }

  /**
   * Pause progressive loading
   */
  pause(): void {
    this.isPaused = true;
    this.log(this.LOG_INFO, '[KTX2] Loading paused');
  }

  /**
   * Resume progressive loading
   */
  resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      if (this.pauseResolve) {
        this.pauseResolve();
        this.pauseResolve = null;
      }
      this.log(this.LOG_INFO, '[KTX2] Loading resumed');
    }
  }

  /**
   * Check if loading is paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Get current FPS estimate based on recent history
   */
  getCurrentFps(): number {
    if (this.fpsHistory.length === 0) return 60;
    const sum = this.fpsHistory.reduce((a, b) => a + b, 0);
    return sum / this.fpsHistory.length;
  }

  /**
   * Get current adaptive step delay
   */
  getCurrentStepDelay(): number {
    return this.currentStepDelay;
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    if (!this.cacheManager) {
      throw new Error('Cache not enabled');
    }
    return this.cacheManager.getCacheStats();
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    if (!this.cacheManager) {
      throw new Error('Cache not enabled');
    }
    await this.cacheManager.clear();
    this.log(this.LOG_INFO, '[KTX2] Cache cleared');
  }

  /**
   * Set cache size limit
   */
  setCacheMaxSize(megabytes: number): void {
    if (!this.cacheManager) {
      throw new Error('Cache not enabled');
    }
    this.cacheManager.setMaxSize(megabytes);
    this.log(this.LOG_INFO, `[KTX2] Cache max size set to ${megabytes}MB`);
  }

  /**
   * Get memory pool statistics
   */
  getMemoryPoolStats() {
    if (!this.memoryPool) {
      throw new Error('Memory pool not enabled');
    }
    return this.memoryPool.getStats();
  }

  /**
   * Cleanup: cancel pending RAF requests and terminate worker
   */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
    }
    if (this.cacheManager) {
      this.cacheManager.close();
    }
    if (this.memoryPool) {
      this.memoryPool.clear();
    }
    if (this.gpuFormatDetector) {
      this.gpuFormatDetector = null;
    }
    this.log(this.LOG_INFO, '[KTX2] Loader destroyed');
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

    // Store state for adaptive loading updates
    this.probeData = probe;
    this.loadedEntity = entity;

    this.log(this.LOG_INFO, '[KTX2] Probe complete:', {
      levels: probe.levelCount,
      size: `${probe.width}x${probe.height}`,
      totalSize: `${(probe.totalSize / 1024 / 1024).toFixed(2)} MB`,
    });

    // 2. Determine which levels to load
    const startLevel = this.config.adaptiveLoading
      ? this.calculateStartLevel(entity, probe.width, probe.height, probe.levelCount)
      : probe.levelCount - 1;

    // Store current target LOD for adaptive updates
    this.currentTargetLod = startLevel;

    if (this.config.adaptiveLoading) {
      this.log(this.LOG_VERBOSE, `[KTX2] Adaptive loading: starting from level ${startLevel}`);
    }

    // 3. Check cache for available levels
    const cachedLevels = this.config.enableCache && this.cacheManager
      ? await this.cacheManager.getMipList(this.config.ktxUrl)
      : [];

    if (cachedLevels.length > 0) {
      this.log(this.LOG_VERBOSE, `[KTX2] Found ${cachedLevels.length} cached levels:`, cachedLevels);
    }

    // 4. Select transcode format based on GPU capabilities (BEFORE creating texture)
    const transcodeConfig = this.selectTranscodeFormat(probe.colorSpace.hasAlpha);
    console.log(`[KTX2] Selected transcode format: ${transcodeConfig.format} (compressed=${transcodeConfig.isCompressed})`);

    // 5. Create texture with correct format
    const texture = this.createTexture(
      probe,
      transcodeConfig.isCompressed,
      this.getTextureFormatFromTranscodeFormat(transcodeConfig.format)
    );

    // 6. Progressive loading loop
    // Load from lowest quality (highest mip index) to highest quality (mip 0)
    let lastFrameTime = performance.now();

    // If adaptive loading is enabled, only load the starting level
    // Additional levels will be loaded by updateAdaptiveLoading() when camera moves closer
    const targetLevel = this.config.adaptiveLoading ? startLevel : 0;

    // Track LOD range: min = best quality (lowest number), max = worst quality (highest number)
    let minAvailableLod = startLevel;
    let maxAvailableLod = startLevel;

    for (let i = startLevel; i >= targetLevel; i--) {
      const levelInfo = probe.levels[i];
      if (!levelInfo) continue;

      let result: Ktx2TranscodeResult | undefined;
      let fromCache = false;

      // Try to load from cache first
      if (this.config.enableCache && cachedLevels.includes(i) && this.cacheManager) {
        const cached = await this.cacheManager.loadMip(this.config.ktxUrl, i, transcodeConfig.format);
        if (cached) {
          result = {
            width: cached.width,
            height: cached.height,
            data: cached.data,
          };
          fromCache = true;
          loadStats.levelsCached++;

          this.log(this.LOG_VERBOSE, `[KTX2] Level ${i} loaded from cache`);
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
        result = await this.transcode(miniKtx, transcodeConfig.format, transcodeConfig.isCompressed);

        const transcodeTime = performance.now() - transcodeStart;
        loadStats.bytesTranscoded += result.data.byteLength;

        // Diagnostic: verify transcoded data matches expected format
        if (transcodeConfig.isCompressed && result.data) {
          const rgbaSize = result.width * result.height * 4;
          if (result.data.byteLength === rgbaSize) {
            this.logWarn(
              `[KTX2] DIAGNOSTIC: Level ${i} (${result.width}x${result.height}) — ` +
              `requested format=${transcodeConfig.format} isCompressed=true, ` +
              `but data=${result.data.byteLength}B matches RGBA (${rgbaSize}B). ` +
              `Transcode may have silently fallen back to RGBA.`
            );
          }
        }

        // Save to cache
        if (this.config.enableCache && this.cacheManager) {
          await this.cacheManager.saveMip(this.config.ktxUrl, i, result.data, {
            width: result.width,
            height: result.height,
            timestamp: Date.now(),
            transcodeFormat: transcodeConfig.format,
          });
        }

        this.log(this.LOG_VERBOSE,
          `[KTX2] Level ${i}: ${result.width}x${result.height} ` +
          `(${(transcodeTime).toFixed(1)}ms)`
        );
      }

      // Check result exists
      if (!result) {
        this.logError(`[KTX2] Failed to load level ${i}`);
        continue;
      }

      // Update LOD range as we load each level
      if (i < minAvailableLod) minAvailableLod = i;
      if (i > maxAvailableLod) maxAvailableLod = i;

      // Track in class variables for adaptive loading
      this.minLoadedLod = minAvailableLod;
      this.maxLoadedLod = maxAvailableLod;

      // Get WebGL internal format for the selected transcode format
      const webglInternalFormat = transcodeConfig.isCompressed && this.gpuFormatDetector
        ? this.gpuFormatDetector.getInternalFormat(this.getTextureFormatFromTranscodeFormat(transcodeConfig.format))
        : 0; // 0 for RGBA (will use default in uploadMipLevel)

      // Upload to GPU with progressive LOD update
      this.uploadMipLevel(
        texture,
        i,
        result,
        minAvailableLod,
        maxAvailableLod,
        transcodeConfig.isCompressed,
        webglInternalFormat
      );
      loadStats.levelsLoaded++;

      // Apply texture to entity after first level is loaded
      // This makes the texture visible immediately with lowest quality
      if (i === startLevel) {
        this.applyTextureToEntity(entity, texture, probe.levelCount);
        this.log(this.LOG_INFO, '[KTX2] Texture applied to entity with initial quality');
      }

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
        // Calculate progress: going from startLevel down to targetLevel
        const currentStep = startLevel - i + 1;
        const totalSteps = startLevel - targetLevel + 1;
        callbacks.onProgress(currentStep, totalSteps, mipInfo);
      }

      // Adaptive FPS throttling - delay between mip levels (except after the last one)
      if (i > targetLevel) {
        // Check if paused
        if (this.isPaused) {
          await new Promise<void>(resolve => {
            this.pauseResolve = resolve;
          });
        }

        // Update FPS history using PlayCanvas app stats
        const now = performance.now();
        const elapsed = now - lastFrameTime;

        // Get real render FPS from PlayCanvas
        const appFps = (this.app as any).stats?.frame?.fps || 0;
        if (appFps > 0) {
          this.fpsHistory.push(appFps);
          if (this.fpsHistory.length > 10) {
            this.fpsHistory.shift();
          }
        }

        // Adaptive throttling: adjust delay based on actual FPS
        if (this.config.adaptiveThrottling && this.fpsHistory.length > 3) {
          const avgFps = this.getCurrentFps();
          const targetFps = this.config.targetFps;

          if (avgFps < targetFps * 0.9) {
            // FPS too low - increase delay to reduce load
            this.currentStepDelay = Math.min(
              this.currentStepDelay + 10,
              this.config.maxStepDelayMs
            );
            this.log(this.LOG_VERBOSE, `[KTX2] FPS low (${avgFps.toFixed(1)}), increasing delay to ${this.currentStepDelay}ms`);
          } else if (avgFps > targetFps * 1.1) {
            // FPS high - decrease delay to speed up loading
            this.currentStepDelay = Math.max(
              this.currentStepDelay - 10,
              this.config.minStepDelayMs
            );
            if (this.currentStepDelay > this.config.minStepDelayMs) {
              this.log(this.LOG_VERBOSE, `[KTX2] FPS high (${avgFps.toFixed(1)}), decreasing delay to ${this.currentStepDelay}ms`);
            }
          }
        } else {
          this.currentStepDelay = this.config.stepDelayMs;
        }

        // Calculate wait time with frame budget
        const minInterval = Math.max(this.config.minFrameInterval, 0);
        const waitTime = Math.max(minInterval - elapsed, 0) + this.currentStepDelay;

        if (waitTime > 0) {
          // Use RAF for frame-accurate timing
          await new Promise<void>(resolve => {
            const startWait = performance.now();
            const waitUntilRaf = () => {
              const waitElapsed = performance.now() - startWait;
              if (waitElapsed >= waitTime) {
                resolve();
              } else {
                this.rafId = requestAnimationFrame(waitUntilRaf);
              }
            };
            this.rafId = requestAnimationFrame(waitUntilRaf);
          });
        }

        lastFrameTime = performance.now();
      }
    }

    // Texture was already applied to entity after first level load
    // All subsequent levels improve the quality progressively

    // Completion stats
    loadStats.endTime = performance.now();
    loadStats.totalTime = loadStats.endTime - loadStats.startTime;
    loadStats.averageTimePerLevel = loadStats.totalTime / loadStats.levelsLoaded;

    if (callbacks?.onComplete) {
      callbacks.onComplete(loadStats);
    }

    this.log(this.LOG_INFO, '[KTX2] Loading complete:', {
      totalTime: `${(loadStats.totalTime! / 1000).toFixed(2)}s`,
      levelsLoaded: loadStats.levelsLoaded,
      levelsCached: loadStats.levelsCached,
      downloaded: `${(loadStats.bytesDownloaded / 1024 / 1024).toFixed(2)} MB`,
      transcoded: `${(loadStats.bytesTranscoded / 1024 / 1024).toFixed(2)} MB`,
    });

    // Store texture reference for adaptive loading
    this.activeTexture = texture;

    return texture;
  }

  /**
   * Cleanup resources (deprecated - use destroy() instead)
   */
  dispose(): void {
    this.destroy();
  }

  /**
   * Update adaptive loading - check if more detail is needed based on camera distance
   * Call this from PlayCanvas script update() method
   */
  updateAdaptiveLoading(dt: number): void {
    if (!this.config.adaptiveLoading) return;
    if (!this.probeData || this.currentTargetLod === undefined || !this.loadedEntity) return;

    this.lastUpdateCheck += dt;

    const checkInterval = this.config.adaptiveUpdateInterval;
    if (this.lastUpdateCheck < checkInterval) return;
    this.lastUpdateCheck = 0;

    // Temporarily reduce log level to avoid spam during adaptive updates
    const originalLogLevel = this.config.logLevel;
    this.config.logLevel = this.LOG_ERROR; // Only errors during update check

    const newTargetLod = this.calculateStartLevel(
      this.loadedEntity,
      this.probeData.width,
      this.probeData.height,
      this.probeData.levelCount
    );

    // Restore log level
    this.config.logLevel = originalLogLevel;

    // If camera moved closer (lower LOD number = higher detail), load more detail
    if (newTargetLod < this.currentTargetLod) {
      this.log(this.LOG_INFO, `[KTX2] Camera closer: LOD ${this.currentTargetLod} → ${newTargetLod}, loading more detail...`);

      this.loadAdditionalLevels(this.currentTargetLod - 1, newTargetLod);
      this.currentTargetLod = newTargetLod;
    }
  }

  /**
   * Load additional mip levels (from higher to lower LOD)
   * Used by adaptive loading when camera moves closer
   */
  private async loadAdditionalLevels(fromLod: number, toLod: number): Promise<void> {
    if (!this.probeData || !this.activeTexture) return;

    const probe = this.probeData;

    for (let level = fromLod; level >= toLod; level--) {
      const lvl = probe.levels[level];
      if (!lvl || lvl.byteLength === 0) continue;

      try {
        // Select transcode format based on texture alpha channel
        const transcodeConfig = this.selectTranscodeFormat(probe.colorSpace.hasAlpha);

        // Check cache first
        let result: Ktx2TranscodeResult | null = null;

        if (this.config.enableCache && this.cacheManager) {
          const cached = await this.cacheManager.loadMip(this.config.ktxUrl!, level, transcodeConfig.format);
          if (cached) {
            this.log(this.LOG_VERBOSE, `[KTX2] Level ${level} loaded from cache (adaptive)`);
            result = {
              width: cached.width,
              height: cached.height,
              data: cached.data,
            };
          }
        }

        // Download from server if not cached
        if (!result) {
          const payload = await this.fetchRange(
            this.config.ktxUrl!,
            lvl.byteOffset,
            lvl.byteOffset + lvl.byteLength - 1
          );

          const mini = this.repackSingleLevel(probe, level, payload);

          const transcodeStart = performance.now();
          result = await this.transcode(mini, transcodeConfig.format, transcodeConfig.isCompressed);
          const transcodeTime = performance.now() - transcodeStart;

          this.log(this.LOG_INFO, `[KTX2] Loaded additional Level ${level}: ${result.width}x${result.height} (${transcodeTime.toFixed(0)}ms)`);

          // Cache it
          if (this.config.enableCache && this.cacheManager) {
            await this.cacheManager.saveMip(this.config.ktxUrl!, level, result.data, {
              width: result.width,
              height: result.height,
              timestamp: Date.now(),
              transcodeFormat: transcodeConfig.format,
            });
          }
        }

        // Track loaded LOD range
        this.minLoadedLod = Math.min(this.minLoadedLod, level);
        this.maxLoadedLod = Math.max(this.maxLoadedLod, level);

        // Get WebGL internal format for the selected transcode format
        const webglInternalFormat = transcodeConfig.isCompressed && this.gpuFormatDetector
          ? this.gpuFormatDetector.getInternalFormat(this.getTextureFormatFromTranscodeFormat(transcodeConfig.format))
          : 0; // 0 for RGBA (will use default in uploadMipLevel)

        // Upload to GPU with correct LOD range
        this.uploadMipLevel(
          this.activeTexture,
          level,
          result,
          this.minLoadedLod,
          this.maxLoadedLod,
          transcodeConfig.isCompressed,
          webglInternalFormat
        );

      } catch (error) {
        this.log(this.LOG_ERROR, `[KTX2] Failed to load additional level ${level}:`, error);
      }
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get worker code (inline or from file)
   */
  private async getWorkerCode(): Promise<string> {
    return WORKER_CODE;
  }

  private async initWorker(): Promise<boolean> {
    this.log(this.LOG_INFO, '[KTX2] Initializing Web Worker...');

    try {
      // URLs are required
      const mjsUrl = this.config.libktxModuleUrl;
      const wasmUrl = this.config.libktxWasmUrl;

      if (!mjsUrl || !wasmUrl) {
        throw new Error('[KTX2] libktxModuleUrl and libktxWasmUrl are REQUIRED');
      }

      // Load worker code as text (inline for now, can be external in future)
      const workerCode = await this.getWorkerCode();

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(workerUrl);

      // Setup message handler
      this.worker.onmessage = (e: MessageEvent) => {
        const response = e.data;

        if (response.messageId !== undefined) {
          const callbacks = this.workerPendingCallbacks.get(response.messageId);
          if (callbacks) {
            this.workerPendingCallbacks.delete(response.messageId);

            if (response.success) {
              this.log(this.LOG_VERBOSE, `[KTX2] Worker response #${response.messageId}: ${response.width}x${response.height}`);
              callbacks.resolve(response);
            } else {
              this.logError(`[KTX2] Worker error #${response.messageId}:`, response.error);
              callbacks.reject(new Error(response.error || 'Worker error'));
            }
          }
        }
      };

      this.worker.onerror = (error: ErrorEvent) => {
        this.logError('[KTX2] Worker error:', error);
      };

      // Load libktx code
      const fetchStart = performance.now();
      const mjsResponse = await fetch(mjsUrl);
      if (!mjsResponse.ok) {
        throw new Error(`Failed to fetch libktx.mjs: ${mjsResponse.status}`);
      }
      const libktxCode = await mjsResponse.text();
      this.log(this.LOG_INFO, `[KTX2] Worker libktx.mjs fetched (${(performance.now() - fetchStart).toFixed(0)}ms, ${(libktxCode.length / 1024).toFixed(0)} KB)`);

      // Initialize worker
      const initPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker initialization timeout'));
        }, 10000); // 10s timeout

        const tempHandler = (e: MessageEvent) => {
          clearTimeout(timeout);
          this.worker!.removeEventListener('message', tempHandler);

          if (e.data.type === 'init') {
            if (e.data.success) {
              this.workerReady = true;
              resolve();
            } else {
              reject(new Error(e.data.error || 'Worker init failed'));
            }
          }
        };

        this.worker!.addEventListener('message', tempHandler);

        this.worker!.postMessage({
          type: 'init',
          data: {
            libktxCode: libktxCode,
            wasmUrl: wasmUrl,
          },
        });
      });

      const workerInitStart = performance.now();
      await initPromise;

      this.log(this.LOG_INFO, `[KTX2] Worker initialized (${(performance.now() - workerInitStart).toFixed(0)}ms)`);

      return true;

    } catch (error) {
      this.logWarn('[KTX2] Worker initialization failed:', error);
      if (error instanceof Error) {
        this.log(this.LOG_VERBOSE, '[KTX2] Worker error details:', error.message, error.stack);
      }

      // Cleanup on failure
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }

      return false;
    }
  }

  /**
   * Initialize libktx module on main thread (fallback when worker is disabled)
   */
  private async initMainThreadModule(): Promise<void> {
    this.log(this.LOG_INFO, '[KTX2] Loading libktx module on main thread...');

    try {
      // URLs are required
      const mjsUrl = this.config.libktxModuleUrl;
      const wasmUrl = this.config.libktxWasmUrl;

      if (!mjsUrl || !wasmUrl) {
        throw new Error('[KTX2] libktxModuleUrl and libktxWasmUrl are REQUIRED');
      }

      // Use LibktxLoader
      const loader = LibktxLoader.getInstance();
      this.ktxModule = await loader.initialize(
        this.app,
        this.config.logLevel >= this.LOG_VERBOSE,
        mjsUrl,
        wasmUrl
      );

      if (!this.ktxModule) {
        throw new Error('Failed to load KTX module');
      }

      this.log(this.LOG_VERBOSE, '[KTX2] Module loaded successfully');
      this.log(this.LOG_VERBOSE, '[KTX2] Module has ktxTexture:', typeof this.ktxModule.ktxTexture);
      this.log(this.LOG_VERBOSE, '[KTX2] Module has ErrorCode:', typeof this.ktxModule.ErrorCode);
      this.log(this.LOG_VERBOSE, '[KTX2] Module has TranscodeTarget:', typeof this.ktxModule.TranscodeTarget);
      this.log(this.LOG_VERBOSE, '[KTX2] Module has HEAPU8:', typeof this.ktxModule.HEAPU8);

      // Create cwrap API wrappers
      this.log(this.LOG_VERBOSE, '[KTX2] Creating cwrap API wrappers...');

      this.ktxApi = this.createKtxApi(this.ktxModule);

      this.log(this.LOG_INFO, '[KTX2] libktx module loaded successfully (cwrap C API)');
    } catch (error) {
      console.error('[KTX2] Failed to load libktx module:', error);
      throw error;
    }
  }

  /**
   * Probe KTX2 file: fetch header, parse metadata, determine range support
   */
  private async probe(url: string): Promise<Ktx2ProbeResult> {
    this.log(this.LOG_VERBOSE, '[KTX2] Probing:', url);

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

      this.log(this.LOG_VERBOSE, '[KTX2] HEAD response:', {
        fileSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
        supportsRanges,
      });
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
    let sgdOff = readU64asNumber(view, 64);
    const sgdLen = readU64asNumber(view, 72);

    // Workaround: Basis Universal 1.16 writes sgdByteOffset and sgdByteLength
    // as two uint32 values (8 bytes total) instead of two uint64 values (16 bytes).
    // readU64asNumber combines the low32 of sgdOff with the low32 of sgdLen as
    // the high word, producing a bogus offset. Detect and fix by falling back
    // to just the low 32 bits when the uint64 value exceeds known bounds.
    if (sgdOff > 0 && sgdLen > 0) {
      const sgdOffLow32 = view.getUint32(64, true);
      if (sgdOff !== sgdOffLow32 && sgdOffLow32 + sgdLen <= (totalSize || Infinity)) {
        this.logWarn(
          '[KTX2] sgdByteOffset uint64 looks bogus (' + sgdOff + ') — ' +
          'using low32 (' + sgdOffLow32 + '). ' +
          'File likely written by Basis Universal <= 1.16.'
        );
        sgdOff = sgdOffLow32;
      }
    }

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
    const colorSpace = parseDFDColorSpace(dfd, this.config.logLevel >= this.LOG_VERBOSE);

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

    this.log(this.LOG_VERBOSE, '[KTX2] Probe complete:', {
      size: `${pixelWidth}x${pixelHeight}`,
      levels: levelCount,
      fileSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
      colorSpace: colorSpace.isSrgb ? 'sRGB' : 'Linear',
      supportsRanges,
    });

    return result;
  }

  /**
   * Fetch a byte range from URL
   * Uses Range header if supported, falls back to full GET
   */
  private async fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
    const fileName = url.split('/').pop()?.split('?')[0] ?? url;

    // Helper: translate HTTP status to human-readable message
    const httpError = (status: number, phase: string): Error => {
      if (status === 404) {
        return new Error(`[KTX2] Texture not found (404): "${fileName}"\nURL: ${url}`);
      }
      if (status === 403) {
        return new Error(`[KTX2] Access denied (403): "${fileName}" — check bucket permissions\nURL: ${url}`);
      }
      return new Error(`[KTX2] ${phase} failed (${status}): "${fileName}"\nURL: ${url}`);
    };

    try {
      // Try range request first
      const response = await fetch(url, {
        headers: { 'Range': `bytes=${start}-${end}` },
      });

      if (!response.ok) {
        throw httpError(response.status, 'Range request');
      }

      if (response.status === 206) {
        return new Uint8Array(await response.arrayBuffer());
      }

      if (response.status === 200) {
        // Server returned full content — slice the needed range
        const fullData = new Uint8Array(await response.arrayBuffer());
        return fullData.slice(start, end + 1);
      }

      throw new Error(`[KTX2] Unexpected response status ${response.status} for "${fileName}"`);

    } catch (error) {
      // Only fallback for network errors (TypeError), not HTTP errors
      if (error instanceof TypeError) {
        this.logWarn(`[KTX2] Range request network error (${start}-${end}), falling back to full fetch:`, error);

        const response = await fetch(url);
        if (!response.ok) {
          throw httpError(response.status, 'Fallback fetch');
        }

        const fullData = new Uint8Array(await response.arrayBuffer());
        return fullData.slice(start, end + 1);
      }

      // HTTP errors (404, 403, etc.) — re-throw as-is, no fallback
      throw error;
    }
  }

  /**
   * Calculate number of images at a specific mipmap level
   * Used for SGD repacking in ETC1S format
   */
  private imagesPerLevel(levelIndex: number, pixelDepth: number, layerCount: number, faceCount: number): number {
    const depthAtLevel = Math.max(1, (pixelDepth | 0) >>> levelIndex);
    const layers = Math.max(1, layerCount | 0);
    return layers * Math.max(1, faceCount | 0) * depthAtLevel;
  }

  /**
   * Repack SGD (Supercompression Global Data) for a specific level
   *
   * For ETC1S (BasisLZ) format, SGD contains:
   * - Header (20 bytes)
   * - Image descriptors (20 bytes each) for ALL levels
   * - Codebooks (endpoints, selectors, tables, extended)
   *
   * We need to extract only the descriptors for the target level
   * while keeping all codebooks intact.
   */
  private repackSgdForLevel(
    sgdFull: Uint8Array,
    levelIndex: number,
    totalLevelCount: number,
    layerCount: number,
    faceCount: number,
    pixelDepth: number
  ): Uint8Array {
    if (!sgdFull || sgdFull.byteLength === 0) {
      return new Uint8Array(0);
    }

    const view = new DataView(sgdFull.buffer, sgdFull.byteOffset, sgdFull.byteLength);

    // Read SGD header (20 bytes total)
    const headerSize = 20;
    const endpointsByteLength = view.getUint32(4, true);
    const selectorsByteLength = view.getUint32(8, true);
    const tablesByteLength = view.getUint32(12, true);
    const extendedByteLength = view.getUint32(16, true);

    // Calculate total number of images across all levels
    let imageCountFull = 0;
    for (let i = 0; i < Math.max(1, totalLevelCount); i++) {
      imageCountFull += this.imagesPerLevel(i, pixelDepth, layerCount, faceCount);
    }

    // Each image descriptor is 20 bytes
    const imageDescSize = 20;
    const imageDescsStart = headerSize;
    const codebooksOffsetFull = imageDescsStart + imageCountFull * imageDescSize;

    // Find starting index for our target level
    let startIndex = 0;
    for (let i = 0; i < levelIndex; i++) {
      startIndex += this.imagesPerLevel(i, pixelDepth, layerCount, faceCount);
    }

    // Get image count for target level only
    const levelImageCount = this.imagesPerLevel(levelIndex, pixelDepth, layerCount, faceCount);

    // Extract descriptors for this level
    const srcDescStart = imageDescsStart + startIndex * imageDescSize;
    const srcDescEnd = srcDescStart + levelImageCount * imageDescSize;
    const singleLevelDescs = sgdFull.subarray(srcDescStart, srcDescEnd);

    // Codebooks are shared across all levels - copy them all
    const codebooksSize = endpointsByteLength + selectorsByteLength + tablesByteLength + extendedByteLength;

    // Build new SGD: header + single level descriptors + all codebooks
    const newSgdSize = headerSize + singleLevelDescs.byteLength + codebooksSize;
    const newSgd = new Uint8Array(newSgdSize);

    // Copy header (unchanged)
    newSgd.set(sgdFull.subarray(0, headerSize), 0);

    // Copy single level descriptors
    newSgd.set(singleLevelDescs, headerSize);

    // Copy codebooks
    const codebooksSrc = sgdFull.subarray(codebooksOffsetFull, codebooksOffsetFull + codebooksSize);
    newSgd.set(codebooksSrc, headerSize + singleLevelDescs.byteLength);

    this.log(this.LOG_VERBOSE, `[KTX2] SGD repacked for level ${levelIndex}: ${levelImageCount} images (of ${imageCountFull} total), ${sgdFull.byteLength}→${newSgdSize} bytes`);

    return newSgd;
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
   * 5. SGD (Supercompression Global Data) - repacked for ETC1S or copied for UASTC
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

    // Read original header to check supercompression scheme
    const origView = new DataView(probe.headerBytes.buffer, probe.headerBytes.byteOffset);
    const supercompressionScheme = origView.getUint32(44, true);
    const isETC1S = supercompressionScheme === 1; // 1 = BasisLZ (ETC1S)

    // Align sections according to KTX2 spec
    let offset = headerSize + levelIndexSize;

    // DFD offset (must be 4-byte aligned) - only if DFD has data
    let dfdOffset = 0;
    const dfdLength = probe.dfd.length;
    if (dfdLength > 0) {
      dfdOffset = alignValue(offset, 4);
      offset = dfdOffset + dfdLength;
    }

    // KVD offset (must be 4-byte aligned) - only if KVD has data
    let kvdOffset = 0;
    const kvdLength = probe.kvd.length;
    if (kvdLength > 0) {
      kvdOffset = alignValue(offset, 4);
      offset = kvdOffset + kvdLength;
    }

    // SGD: Repack for ETC1S, copy as-is for UASTC
    let sgdData = probe.sgd;
    if (isETC1S && probe.sgd.byteLength > 0) {
      sgdData = this.repackSgdForLevel(
        probe.sgd,
        level,
        probe.levelCount,
        probe.layerCount,
        probe.faceCount,
        probe.pixelDepth
      );
    }

    // SGD offset (must be 8-byte aligned) - only if SGD has data
    let sgdOffset = 0;
    const sgdLength = sgdData.length;
    if (sgdLength > 0) {
      sgdOffset = alignValue(offset, 8);
      offset = sgdOffset + sgdLength;
    }

    // Mipmap data offset (must be 8-byte aligned)
    const dataOffset = alignValue(offset, 8);
    const dataLength = payload.length;

    // Total mini-KTX2 size (must be 8-byte aligned per KTX2 spec)
    const totalSize = alignValue(dataOffset + dataLength, 8);

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

    // Calculate uncompressedByteLength based on supercompression scheme
    // - scheme 0 (no compression): use dataLength
    // - scheme 2 (UASTC): use original uncompressedByteLength
    // - scheme 1 (ETC1S): set to 0
    let uncompressedByteLength = 0;
    if (supercompressionScheme === 0) {
      uncompressedByteLength = dataLength;
    } else if (supercompressionScheme === 2) {
      uncompressedByteLength = levelInfo.uncompressedByteLength || 0;
    } else {
      uncompressedByteLength = 0;
    }

    const levelIndexOffset = 80;
    writeU64(view, levelIndexOffset, dataOffset);                         // byteOffset
    writeU64(view, levelIndexOffset + 8, dataLength);                     // byteLength
    writeU64(view, levelIndexOffset + 16, uncompressedByteLength);        // uncompressedByteLength

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
      miniKtx.set(sgdData, sgdOffset);
    }

    // ========================================================================
    // 6. Write Mipmap Data
    // ========================================================================

    miniKtx.set(payload, dataOffset);

    // Get header info for debugging
    const headerView = new DataView(miniKtx.buffer, 0, 80);
    const levelCount = headerView.getUint32(40, true);
    const vkFormat = headerView.getUint32(12, true);

    this.log(this.LOG_VERBOSE, `[KTX2] Repacked level ${level}:`, {
      originalSize: `${(levelInfo.byteLength / 1024).toFixed(2)} KB`,
      miniKtxSize: `${(totalSize / 1024).toFixed(2)} KB`,
      dimensions: `${mipWidth}x${mipHeight}`,
      overhead: `${((totalSize - dataLength) / 1024).toFixed(2)} KB`,
      dfdSize: `${probe.dfd.length} bytes`,
      dfdOffset,
      kvdSize: `${probe.kvd.length} bytes`,
      kvdOffset,
      sgdSize: `${sgdData.length} bytes`,
      sgdOffset,
      sgdOriginalSize: `${probe.sgd.length} bytes`,
      payloadSize: dataLength,
      payloadOffset: dataOffset,
      isETC1S,
      supercompressionScheme,
      uncompressedByteLength,
      vkFormat,
      levelCount,
      headerBytes: Array.from(miniKtx.slice(0, 48)).map(b => b.toString(16).padStart(2, '0')).join(' '),
    });

    return miniKtx;
  }

  /**
   * Create cwrap API wrappers for KTX C functions
   * Based on old working implementation from Ktx2ProgressiveVanilla.js
   */
  private createKtxApi(module: KtxModule): KtxApi {
    this.log(this.LOG_VERBOSE, '[KTX2] Creating direct C API wrappers (no cwrap)...');

    // Use direct exported C functions — works regardless of EXPORTED_RUNTIME_METHODS
    const api: KtxApi = {
      malloc: (size: number) => module._malloc(size),
      free: (ptr: number) => module._free(ptr),
      createFromMemory: (dataPtr: number, dataSize: number, flags: number, outPtr: number) =>
        module._ktxTexture2_CreateFromMemory(dataPtr, dataSize, flags, outPtr),
      destroy: (handle: number) => module._ktxTexture2_Destroy(handle),
      transcode: (handle: number, format: number, flags: number) =>
        module._ktxTexture2_TranscodeBasis(handle, format, flags),
      needsTranscoding: (handle: number) => module._ktxTexture2_NeedsTranscoding(handle),
      getData: (handle: number) => module._ktx_get_data(handle),
      getDataSize: (handle: number) => module._ktx_get_data_size(handle),
      getWidth: (handle: number) => module._ktx_get_base_width(handle),
      getHeight: (handle: number) => module._ktx_get_base_height(handle),
      getLevels: (handle: number) => module._ktx_get_num_levels(handle),
      getOffset: (handle: number, level: number, layer: number, face: number) =>
        module._ktx_get_image_offset(handle, level, layer, face),
      errorString: (code: number) => module.UTF8ToString(module._ktxErrorString(code)),
    };

    this.log(this.LOG_VERBOSE, '[KTX2] Direct C API created:', Object.keys(api));

    return api;
  }

  /**
   * Transcode mini-KTX2 to RGBA using libktx
   * Routes to worker if available, otherwise uses main thread
   */
  private async transcode(
    miniKtx: Uint8Array,
    targetFormat: number,
    isCompressed: boolean
  ): Promise<Ktx2TranscodeResult> {
    // Use worker if available and ready
    if (this.config.useWorker && this.workerReady && this.worker) {
      this.log(this.LOG_VERBOSE, '[KTX2] Transcoding via Worker');
      return this.transcodeWorker(miniKtx, targetFormat, isCompressed);
    }

    // Fallback to main thread
    this.log(this.LOG_VERBOSE, '[KTX2] Transcoding on Main Thread (worker not available)');

    if (!this.ktxModule) {
      throw new Error('libktx not initialized. Call initialize() first.');
    }

    return this.transcodeMainThread(miniKtx, targetFormat, isCompressed);
  }

  /**
   * Transcode using Web Worker
   */
  private async transcodeWorker(
    miniKtx: Uint8Array,
    targetFormat: number,
    isCompressed: boolean
  ): Promise<Ktx2TranscodeResult> {
    if (!this.worker || !this.workerReady) {
      throw new Error('Worker not ready');
    }

    const messageId = this.workerMessageId++;
    const startTime = performance.now();

    return new Promise((resolve, reject) => {
      // Store callbacks
      this.workerPendingCallbacks.set(messageId, { resolve, reject });

      this.log(this.LOG_VERBOSE, `[KTX2] Worker request #${messageId}: ${miniKtx.byteLength} bytes, format=${targetFormat}, compressed=${isCompressed}`);

      // Send transcode request
      this.worker!.postMessage(
        {
          type: 'transcode',
          messageId: messageId,
          data: {
            miniKtx: miniKtx.buffer,
            targetFormat: targetFormat,
            isCompressed: isCompressed,
          },
        },
        [miniKtx.buffer] // Transfer ownership for zero-copy
      );

      // Timeout after 30s
      setTimeout(() => {
        if (this.workerPendingCallbacks.has(messageId)) {
          this.workerPendingCallbacks.delete(messageId);
          const elapsed = performance.now() - startTime;
          this.logWarn(`[KTX2] Worker timeout after ${elapsed.toFixed(1)}ms`);
          reject(new Error('Worker transcode timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Transcode on main thread using libktx (cwrap C API)
   * Based on working implementation from Ktx2ProgressiveVanilla.js
   */
  private transcodeMainThread(
    miniKtx: Uint8Array,
    targetFormat: number,
    isCompressed: boolean
  ): Ktx2TranscodeResult {
    if (!this.ktxModule || !this.ktxApi) {
      throw new Error('libktx not initialized');
    }

    const heapBefore = this.ktxModule.HEAPU8.length;
    const api = this.ktxApi;
    const ktx = this.ktxModule;

    // Allocate memory for mini-KTX2 data
    const ptr = api.malloc(miniKtx.byteLength);
    if (!ptr) {
      throw new Error('Failed to allocate WASM memory');
    }

    try {
      // Copy miniKtx data to WASM heap
      ktx.HEAPU8.set(miniKtx, ptr);

      // Allocate pointer to receive texture pointer
      const outPtrPtr = api.malloc(4);
      if (!outPtrPtr) {
        api.free(ptr);
        throw new Error('Failed to allocate output pointer');
      }

      try {
        // Create texture from memory
        const rc = api.createFromMemory(ptr, miniKtx.byteLength, 0, outPtrPtr);

        if (rc !== 0) {
          const errorMsg = api.errorString ? api.errorString(rc) : `Error code ${rc}`;
          throw new Error(`ktxTexture2_CreateFromMemory failed: ${errorMsg}`);
        }

        // Read the texture pointer using getValue
        const texPtr = ktx.getValue(outPtrPtr, '*');
        api.free(outPtrPtr);

        if (!texPtr) {
          throw new Error('Texture pointer is null');
        }

        try {
          const baseW = api.getWidth(texPtr);
          const baseH = api.getHeight(texPtr);
          this.log(this.LOG_VERBOSE, '[KTX2] Texture created from mini-KTX');
          this.log(this.LOG_VERBOSE, '[KTX2] - Base dimensions:', baseW, 'x', baseH);

          // Check if transcoding is needed
          const needsTranscode = api.needsTranscoding(texPtr);

          if (needsTranscode) {
            const formatName = isCompressed ? 'compressed format' : 'RGBA32';
            this.log(this.LOG_VERBOSE, `[KTX2] Starting transcoding to ${formatName} (format=${targetFormat})...`);

            // Transcode to target format
            const rcT = api.transcode(texPtr, targetFormat, 0);

            if (rcT !== 0) {
              const errorMsg = api.errorString ? api.errorString(rcT) : `Error code ${rcT}`;
              api.destroy(texPtr);
              throw new Error(`Transcoding failed: ${errorMsg}`);
            }

            this.log(this.LOG_VERBOSE, '[KTX2] Transcoding succeeded');
          }

          // Get texture data
          const dataPtr = api.getData(texPtr);
          const dataSize = api.getDataSize(texPtr);

          this.log(this.LOG_VERBOSE, '[KTX2] Getting texture data...');
          this.log(this.LOG_VERBOSE, '[KTX2] - Dimensions:', baseW, 'x', baseH);
          this.log(this.LOG_VERBOSE, '[KTX2] - Data size:', dataSize, 'bytes');
          this.log(this.LOG_VERBOSE, '[KTX2] - Data pointer:', dataPtr);
          this.log(this.LOG_VERBOSE, '[KTX2] - Format:', isCompressed ? 'compressed' : 'RGBA');

          // Calculate expected size
          let total: number;
          if (isCompressed) {
            // For compressed formats, use the actual data size from libktx
            total = dataSize;
            this.log(this.LOG_VERBOSE, '[KTX2] - Using compressed data size:', total, 'bytes');
          } else {
            // For RGBA, calculate expected size
            const expected = baseW * baseH * 4; // RGBA
            total = Math.min(expected, dataSize);
            this.log(this.LOG_VERBOSE, '[KTX2] - Expected RGBA size:', expected, 'bytes');
          }

          this.log(this.LOG_VERBOSE, '[KTX2] - Copying', total, 'bytes from WASM heap');

          // Copy data from WASM heap
          const textureData = new Uint8Array(ktx.HEAPU8.buffer, dataPtr, total);
          const dataCopy = new Uint8Array(textureData); // Make a copy to persist after destroy

          this.log(this.LOG_VERBOSE, '[KTX2] - Data copied successfully');

          // Cleanup texture
          api.destroy(texPtr);

          const heapAfter = ktx.HEAPU8.length;
          const heapFreed = Math.max(0, heapBefore - heapAfter);

          return {
            width: baseW,
            height: baseH,
            data: dataCopy,
            heapStats: {
              before: heapBefore,
              after: heapAfter,
              freed: heapFreed,
            },
          };

        } catch (innerError) {
          // Cleanup texture on error
          api.destroy(texPtr);
          throw innerError;
        }

      } catch (outPtrError) {
        // outPtrPtr already freed or never allocated
        throw outPtrError;
      }

    } catch (error) {
      // Cleanup input data on error
      api.free(ptr);
      throw error;
    } finally {
      // Always free input data
      api.free(ptr);
    }
  }

  /**
   * Assemble full KTX2 file from probe data and level payloads
   */
  private async assembleFullKtx2(probe: Ktx2ProbeResult, levelPayloads: Map<number, Uint8Array>): Promise<Uint8Array> {
    // Calculate total size
    const headerSize = probe.headerSize;
    const dfdSize = probe.dfd.length;
    const kvdSize = probe.kvd.length;
    const sgdSize = probe.sgd.length;

    let dataSize = 0;
    for (const payload of levelPayloads.values()) {
      dataSize += alignValue(payload.length, 8);
    }

    const totalSize = alignValue(headerSize + dfdSize + kvdSize + sgdSize + dataSize, 8);

    // Allocate buffer (from pool if available)
    const buffer = this.memoryPool
      ? this.memoryPool.acquire(totalSize)
      : new ArrayBuffer(totalSize);

    const fullKtx = new Uint8Array(buffer, 0, totalSize);
    const view = new DataView(buffer);

    let offset = 0;

    // 1. Copy header with updated level offsets
    fullKtx.set(probe.headerBytes, 0);
    offset += probe.headerBytes.length;

    // 2. Copy DFD
    if (dfdSize > 0) {
      offset = alignValue(offset, 4);
      fullKtx.set(probe.dfd, offset);
      // Update DFD offset in header
      view.setUint32(48, offset, true);
      offset += dfdSize;
    }

    // 3. Copy KVD
    if (kvdSize > 0) {
      offset = alignValue(offset, 4);
      fullKtx.set(probe.kvd, offset);
      // Update KVD offset in header
      view.setUint32(56, offset, true);
      offset += kvdSize;
    }

    // 4. Copy SGD
    if (sgdSize > 0) {
      offset = alignValue(offset, 8);
      fullKtx.set(probe.sgd, offset);
      // Update SGD offset in header
      writeU64(view, 64, offset);
      offset += sgdSize;
    }

    // 5. Copy level payloads and update level index
    const levelIndexOffset = 80;
    for (let i = 0; i < probe.levelCount; i++) {
      const payload = levelPayloads.get(i);
      if (!payload) continue;

      // Align data offset
      offset = alignValue(offset, 8);

      // Write payload
      fullKtx.set(payload, offset);

      // Update level index entry
      const indexEntryOffset = levelIndexOffset + i * 24;
      writeU64(view, indexEntryOffset, offset);                   // byteOffset
      writeU64(view, indexEntryOffset + 8, payload.length);      // byteLength
      writeU64(view, indexEntryOffset + 16, probe.levels[i].uncompressedByteLength); // uncompressedByteLength

      offset += payload.length;
    }

    this.log(this.LOG_INFO, `[KTX2] Assembled full KTX2: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

    return fullKtx;
  }

  /**
   * Map TextureFormat → pc PIXELFORMAT numeric constant.
   * Used on WebGPU where the texture must be created with the correct
   * compressed format from the start (cannot switch format post-creation).
   *
   * PIXELFORMAT_* numeric values (from PlayCanvas constants.js):
   *   DXT1=8, DXT5=10, ASTC_4x4=28, ETC1=21, ETC2_RGB=22, ETC2_RGBA=23
   *   PVRTC_4BPP_RGB=26, PVRTC_4BPP_RGBA=27, BC7=67, BC7_SRGBA=68
   *   DXT1_SRGB=54, DXT5_SRGBA=56, ASTC_4x4_SRGB=63, ETC2_SRGB=61, ETC2_SRGBA=62
   *   RGBA8=7, SRGBA8=20
   */
  private textureFormatToPixelFormat(format: TextureFormat, isSrgb: boolean): number {
    switch (format) {
      case TextureFormat.BC1_RGB:
      case TextureFormat.BC1_RGBA:   return isSrgb ? 54 : 8;   // DXT1 / DXT1_SRGB
      case TextureFormat.BC3_RGBA:   return isSrgb ? 56 : 10;  // DXT5 / DXT5_SRGBA
      case TextureFormat.BC7_RGBA:   return isSrgb ? 68 : 67;  // BC7 / BC7_SRGBA
      case TextureFormat.ETC1_RGB:   return 21;                  // ETC1 (no sRGB variant)
      case TextureFormat.ETC2_RGB:   return isSrgb ? 61 : 22;  // ETC2_RGB / ETC2_SRGB
      case TextureFormat.ETC2_RGBA:
      case TextureFormat.ETC2_RGBA1: return isSrgb ? 62 : 23;  // ETC2_RGBA / ETC2_SRGBA
      case TextureFormat.ASTC_4x4:   return isSrgb ? 63 : 28;  // ASTC_4x4 / ASTC_4x4_SRGB
      case TextureFormat.PVRTC1_4_RGB:  return 26;
      case TextureFormat.PVRTC1_4_RGBA: return 27;
      case TextureFormat.SRGB8_ALPHA8:  return 20;              // SRGBA8
      default:                          return isSrgb ? 20 : 7; // RGBA8 / SRGBA8
    }
  }

  private createTexture(probe: Ktx2ProbeResult, isCompressed: boolean, textureFormat?: TextureFormat): pc.Texture {
    // Determine pixel format based on colorspace
    // In PlayCanvas 2.x, color textures (diffuse, albedo, etc) should use sRGB formats
    // Linear formats are used for data textures (normal maps, roughness, etc)
    const useSrgb = this.config.isSrgb || probe.colorSpace?.isSrgb;

    const device = this.app.graphicsDevice;

    // Create texture with the correct PIXELFORMAT from the start.
    // For compressed textures this must match the transcode target (BC7, ASTC, etc.)
    // on ALL backends — not just WebGPU. Using RGBA then uploading compressed data
    // via compressedTexImage2D causes "texture not renderable" on mobile GPUs.
    let format: number;
    if (isCompressed && textureFormat) {
      format = this.textureFormatToPixelFormat(textureFormat, !!useSrgb);
    } else {
      // PIXELFORMAT_RGBA8 = 7, PIXELFORMAT_SRGBA8 = 20
      format = useSrgb ? 20 : 7;
    }

    const texture = new pc.Texture(this.app.graphicsDevice, {
      width: probe.width,
      height: probe.height,
      format: format,
      mipmaps: true,
      numLevels: probe.levelCount,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_REPEAT,
    });

    texture.name = `ktx2_${probe.url.split('/').pop()}`;

    const gl = (device as any).gl as WebGL2RenderingContext | null;

    if (device.isWebGPU) {
      // WebGPU path: initialize _levels as array of nulls (length = levelCount).
      // PlayCanvas WebGPU uploader skips null slots — exactly what we need for
      // progressive loading where levels arrive one by one.
      // DO NOT call lock()/unlock() — that writes RGBA8 data which conflicts
      // with the compressed format we set above.
      (texture as any)._levels = new Array(probe.levelCount).fill(null);
      this.log(this.LOG_VERBOSE,
        `[KTX2] WebGPU: created texture format=${format} levels=${probe.levelCount} ` +
        `(compressed=${isCompressed})`
      );
    } else if (isCompressed) {
      // WebGL compressed path: DO NOT lock()/unlock() — that creates an RGBA
      // internal format which conflicts with compressedTexImage2D uploads.
      // Initialize _levels with nulls like WebGPU; GL texture will be created
      // on first uploadMipLevel call.
      (texture as any)._levels = new Array(probe.levelCount).fill(null);
    } else {
      // WebGL RGBA path: lock/unlock to trigger GL texture creation with RGBA format
      const initData = new Uint8Array([128, 128, 128, 255]); // 1x1 gray pixel
      const pixels = texture.lock();
      pixels.set(initData);
      texture.unlock();
    }

    if (!isCompressed && !device.isWebGPU) {
      // RGBA path: Initialize all mipmap levels with full-size placeholder data
      // WebGPU: skip — PlayCanvas manages mip init via its own texture abstraction.
      const glTexture = (texture as any).impl?._glTexture;
      if (gl && glTexture) {
        const prevBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
        gl.bindTexture(gl.TEXTURE_2D, glTexture);

        // Re-initialize level 0 with correct size
        const initSize = probe.width * probe.height * 4;
        const fullInitData = new Uint8Array(initSize);
        for (let i = 0; i < initSize; i += 4) {
          fullInitData[i] = 128;
          fullInitData[i + 1] = 128;
          fullInitData[i + 2] = 128;
          fullInitData[i + 3] = 255;
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, probe.width, probe.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, fullInitData);

        // Initialize all mip levels > 0
        for (let i = 1; i < probe.levelCount; i++) {
          const mipWidth = Math.max(1, probe.width >> i);
          const mipHeight = Math.max(1, probe.height >> i);
          const mipSize = mipWidth * mipHeight * 4;
          const mipData = new Uint8Array(mipSize);
          for (let j = 0; j < mipSize; j += 4) {
            mipData[j] = 128;
            mipData[j + 1] = 128;
            mipData[j + 2] = 128;
            mipData[j + 3] = 255;
          }
          gl.texImage2D(gl.TEXTURE_2D, i, gl.RGBA, mipWidth, mipHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, mipData);
        }

        gl.bindTexture(gl.TEXTURE_2D, prevBinding);
      }

      this.log(this.LOG_VERBOSE, `[KTX2] Initialized ${probe.levelCount} RGBA mip levels with placeholder data`);
    } else {
      // Compressed path: WebGL texture already created by texture.lock/unlock
      // We'll replace the 1x1 RGBA data with compressed data during upload
      this.log(this.LOG_VERBOSE, `[KTX2] Compressed texture initialized (GL texture deferred to first upload)`);
    }

    // Set WebGL parameters for mipmapping and filtering
    // On WebGPU: skip direct gl API — PlayCanvas manages mip params via its own abstraction.
    const glTexture = device.isWebGPU ? null : (texture as any).impl?._glTexture;

    if (!device.isWebGPU && gl && glTexture) {
      const prevBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, glTexture);

      // Set base and max levels for progressive loading
      // Start with the lowest quality mip (highest index)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, probe.levelCount - 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, probe.levelCount - 1);

      // Enable anisotropic filtering if available
      if (this.config.enableAniso) {
        const ext = gl.getExtension('EXT_texture_filter_anisotropic') ||
                    (gl as any).getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
                    (gl as any).getExtension('MOZ_EXT_texture_filter_anisotropic');
        if (ext) {
          const maxAniso = gl.getParameter((ext as any).MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 8;
          gl.texParameterf(gl.TEXTURE_2D, (ext as any).TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
          this.log(this.LOG_VERBOSE, `[KTX2] Anisotropy enabled: ${Math.min(8, maxAniso)}x`);
        }
      }

      gl.bindTexture(gl.TEXTURE_2D, prevBinding);
    }

    this.log(this.LOG_INFO,
      `[KTX2] Created texture: format=${format} srgb=${!!useSrgb} compressed=${isCompressed} ` +
      `levels=${probe.levelCount} ${probe.width}x${probe.height}`);

    return texture;
  }

  /**
   * Upload RGBA mipmap data to GPU texture
   *
   * Note: This uses WebGL2 API directly for mipmap levels > 0
   * PlayCanvas 2.x supports WebGL2 only (WebGL1 support was removed in v2.0)
   *
   * @param minAvailableLod - Best quality level available (lowest number)
   * @param maxAvailableLod - Worst quality level available (highest number)
   */
  private uploadMipLevel(
    texture: pc.Texture,
    level: number,
    result: Ktx2TranscodeResult,
    minAvailableLod: number,
    maxAvailableLod: number,
    isCompressed: boolean,
    internalFormat: number
  ): void {
    if (!result.data || result.data.length === 0) {
      console.error(`[KTX2] Cannot upload level ${level}: empty data`);
      return;
    }

    try {
      // Get graphics device
      const device = this.app.graphicsDevice;

      // ----------------------------------------------------------------
      // WebGPU path
      // ----------------------------------------------------------------
      // PlayCanvas WebGPU backend (webgpu-texture.js uploadTypedArrayData)
      // reads texture._levels[] and calls wgpu.queue.writeTexture() for each
      // non-null TypedArray slot. LOD window is controlled via TextureView
      // (baseMipLevel + mipLevelCount) passed to setParameter — the WebGPU
      // bind group handles it transparently (webgpu-bind-group.js line 92+).
      //
      // Constraints from engine source:
      //   • texture must have been created with the correct compressed PIXELFORMAT
      //     (done in createTexture above — textureFormatToPixelFormat)
      //   • _levels[] must have length == numLevels, null slots are skipped
      //   • texture.upload() must NOT be called inside a render pass
      //     (engine asserts this in webgpu-texture.js uploadImmediate)
      //   • TextureView is only honoured on WebGPU, ignored on WebGL
      if (device.isWebGPU) {
        const levels = (texture as any)._levels as (Uint8Array | null)[];

        if (!levels || level >= levels.length) {
          this.logError(`[KTX2] WebGPU: _levels not initialised or level ${level} out of range`);
          return;
        }

        // Write data into the slot — engine will pick it up on next upload()
        levels[level] = result.data;

        // Push to GPU via PlayCanvas abstraction (calls wgpu.queue.writeTexture)
        // upload() only sends non-null slots so partial-level state is safe.
        texture.upload();

        // LOD window: expose only levels [minAvailableLod .. maxAvailableLod].
        // TextureView with baseMipLevel + mipLevelCount replaces gl.TEXTURE_BASE_LEVEL / MAX_LEVEL.
        const customMaterial = (this as any)._customMaterial;
        if (customMaterial && typeof (texture as any).getView === 'function') {
          const mipCount = maxAvailableLod - minAvailableLod + 1;
          const view = (texture as any).getView(minAvailableLod, mipCount);
          customMaterial.setParameter('texture_diffuseMap', view);
          customMaterial.setParameter('material_minAvailableLod', minAvailableLod);
          customMaterial.setParameter('material_maxAvailableLod', maxAvailableLod);
          this.log(this.LOG_VERBOSE,
            `[KTX2] WebGPU: uploaded level ${level} via TextureView ` +
            `[${minAvailableLod}..${maxAvailableLod}] ${result.width}x${result.height} ` +
            `(${(result.data.byteLength / 1024).toFixed(2)} KB)`
          );
        } else {
          // Material not yet bound — just log, uniforms will sync later
          this.log(this.LOG_VERBOSE,
            `[KTX2] WebGPU: uploaded level ${level} ${result.width}x${result.height} ` +
            `(${(result.data.byteLength / 1024).toFixed(2)} KB)`
          );
        }
        return;
      }

      const gl = (device as any).gl as WebGL2RenderingContext | null;
      if (!gl) {
        this.logError('[KTX2] WebGL2 context not available');
        return;
      }

      // Get or create WebGL texture
      // For compressed textures we skip lock()/unlock() to avoid RGBA format override,
      // so _glTexture may not exist yet — create it manually via GL API.
      let webglTexture = (texture as any).impl?._glTexture;
      if (!webglTexture) {
        webglTexture = gl.createTexture();
        if ((texture as any).impl) {
          (texture as any).impl._glTexture = webglTexture;
          // Set impl properties that PlayCanvas expects for rendering.
          // Without _glTarget, bindTexture() passes undefined → INVALID_ENUM.
          // Without _glInternalFormat, upload() uses wrong format for compressed data.
          (texture as any).impl._glTarget = gl.TEXTURE_2D;
          (texture as any).impl._glFormat = gl.RGBA;
          (texture as any).impl._glInternalFormat = internalFormat;
          (texture as any).impl._glPixelType = gl.UNSIGNED_BYTE;
        }
        if (!webglTexture) {
          this.logError('[KTX2] Failed to create WebGL texture');
          return;
        }
        this.log(this.LOG_VERBOSE, '[KTX2] Created GL texture manually (compressed path)');
      }

      // Save previous binding to restore it later
      const prevBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, webglTexture);

      // Upload the mipmap level using appropriate method
      if (isCompressed) {
        // For compressed textures, use compressedTexImage2D
        // BC7: each 4x4 block = 16 bytes
        const expectedSize = Math.ceil(result.width / 4) * Math.ceil(result.height / 4) * 16;

        this.log(this.LOG_VERBOSE,
          `[KTX2] Uploading compressed texture level ${level} (format=${internalFormat})\n` +
          `       Size: ${result.width}x${result.height}\n` +
          `       Data: ${result.data.byteLength} bytes (expected: ${expectedSize} bytes)`
        );

        // Validate data size
        if (result.data.byteLength !== expectedSize) {
          this.logError(
            `[KTX2] Data size mismatch for level ${level}!\n` +
            `       Expected: ${expectedSize} bytes for ${result.width}x${result.height}\n` +
            `       Got: ${result.data.byteLength} bytes\n` +
            `       Difference: ${result.data.byteLength - expectedSize} bytes`
          );
          // Try to use the available data anyway
        }

        gl.compressedTexImage2D(
          gl.TEXTURE_2D,
          level,
          internalFormat,
          result.width,
          result.height,
          0,
          result.data
        );

        // Store data in _levels so PlayCanvas upload() won't crash with null mipObject.
        // The engine's upload loop enters mipLevel=0 unconditionally and calls
        // compressedTexImage2D(... mipObject) — null there causes TypeError.
        const levels = (texture as any)._levels;
        if (levels && level < levels.length) {
          levels[level] = result.data;
        }
      } else {
        // For uncompressed RGBA, use texImage2D
        const useSrgb = this.config.isSrgb;
        const rgbaFormat = useSrgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;

        this.log(this.LOG_VERBOSE, `[KTX2] Uploading RGBA texture level ${level}`);
        gl.texImage2D(
          gl.TEXTURE_2D,
          level,
          rgbaFormat,
          result.width,
          result.height,
          0,
          gl.RGBA,  // format (always RGBA for source data)
          gl.UNSIGNED_BYTE,
          result.data
        );
      }

      // Flush GPU commands to ensure texture data is uploaded before changing BASE_LEVEL
      // This fixes artifacts on mobile GPUs (Mali, Adreno) where race conditions can occur
      gl.flush();

      // Update LOD range to show progressively better quality
      // We load from level 13 (1x1) down to level 0 (8192x8192)
      // BASE_LEVEL = best quality available (minAvailableLod)
      // MAX_LEVEL = worst quality available (maxAvailableLod)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, minAvailableLod);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, maxAvailableLod);

      // Restore previous binding
      gl.bindTexture(gl.TEXTURE_2D, prevBinding);

      // Clear PlayCanvas dirty flags to prevent redundant re-upload.
      // We manage GL uploads directly; engine re-upload on compressed path
      // would call compressedTexImage2D with potentially incomplete _levels data.
      (texture as any)._needsUpload = false;
      (texture as any)._needsMipmapsUpload = false;

      // Update shader uniform for LOD clamping
      const customMaterial = (this as any)._customMaterial;
      if (customMaterial) {
        customMaterial.setParameter('material_minAvailableLod', minAvailableLod);
        customMaterial.setParameter('material_maxAvailableLod', maxAvailableLod);
        customMaterial.update(); // Force shader update
        this.log(this.LOG_VERBOSE, `[KTX2] Updated LOD window: [${minAvailableLod}, ${maxAvailableLod}]`);
      }

      this.log(this.LOG_VERBOSE,
        `[KTX2] Uploaded level ${level} to GPU: ${result.width}x${result.height} ` +
        `(${(result.data.byteLength / 1024).toFixed(2)} KB)`
      );
    } catch (error) {
      console.error(`[KTX2] Failed to upload level ${level}:`, error);
    }
  }

  private applyTextureToEntity(entity: pc.Entity, texture: pc.Texture, totalLevels: number): void {
    // Support both model and render components
    const comp = entity.model || (entity as any).render;
    if (!comp) {
      console.error('[KTX2] Entity has neither model nor render component');
      return;
    }

    if (!comp.meshInstances || comp.meshInstances.length === 0) {
      console.error('[KTX2] Component has no mesh instances');
      return;
    }

    const meshInstance = comp.meshInstances[0];
    const originalMaterial = meshInstance.material as pc.StandardMaterial;
    if (!originalMaterial) {
      console.error('[KTX2] Mesh instance has no material');
      return;
    }

    // Clone material to avoid modifying the original
    const customMaterial = originalMaterial.clone();
    customMaterial.diffuseMap = texture;

    // Set initial LOD range uniforms (will be updated as levels load)
    const minLod = totalLevels - 1; // Start with lowest quality
    const maxLod = totalLevels - 1;

    customMaterial.setParameter('material_minAvailableLod', minLod);
    customMaterial.setParameter('material_maxAvailableLod', maxLod);
    customMaterial.update();

    // Apply custom material to mesh instance
    meshInstance.material = customMaterial;

    // Store reference for later updates
    (this as any)._customMaterial = customMaterial;
    (this as any)._activeTexture = texture;

    this.log(this.LOG_INFO, `[KTX2] Texture applied to material with LOD uniforms [${minLod}, ${maxLod}]`);
  }

  /**
   * Calculate which mipmap level to start loading from based on screen size
   *
   * Algorithm:
   * 1. Get entity's bounding box (AABB) from model or render component
   * 2. Project to screen space using camera
   * 3. Calculate screen size in pixels
   * 4. Find mipmap level where resolution >= screen size * margin
   *
   * @param entity Entity with model or render component
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
        this.log(this.LOG_VERBOSE, '[KTX2] No camera found, starting from lowest res');
        return levelCount - 1;
      }

      const camera = cameraSystem.cameras[0];
      if (!camera || !camera.camera) {
        return levelCount - 1;
      }

      // Get entity's bounding box from either model or render component
      let meshInstances: any[] = [];
      let componentType = '';

      if (entity.model && entity.model.meshInstances && entity.model.meshInstances.length > 0) {
        meshInstances = entity.model.meshInstances;
        componentType = 'model';
      } else if (entity.render && entity.render.meshInstances && entity.render.meshInstances.length > 0) {
        meshInstances = entity.render.meshInstances;
        componentType = 'render';
      } else {
        this.log(this.LOG_VERBOSE, '[KTX2] Entity has no mesh instances (checked model and render), starting from lowest res');
        return levelCount - 1;
      }

      this.log(this.LOG_VERBOSE, `[KTX2] Using ${componentType} component for adaptive calculation`);

      const meshInstance = meshInstances[0];
      const aabb = meshInstance.aabb;

      if (!aabb) {
        this.log(this.LOG_VERBOSE, '[KTX2] No AABB found, starting from lowest res');
        return levelCount - 1;
      }

      // Get AABB corners in world space
      const worldMin = aabb.getMin();
      const worldMax = aabb.getMax();

      // Calculate screen size in pixels
      const device = this.app.graphicsDevice;
      const screenWidth = device.width;
      const screenHeight = device.height;

      // Project all 8 corners of AABB to screen space to get accurate bounds
      const corners = [
        new (pc as any).Vec3(worldMin.x, worldMin.y, worldMin.z),
        new (pc as any).Vec3(worldMin.x, worldMin.y, worldMax.z),
        new (pc as any).Vec3(worldMin.x, worldMax.y, worldMin.z),
        new (pc as any).Vec3(worldMin.x, worldMax.y, worldMax.z),
        new (pc as any).Vec3(worldMax.x, worldMin.y, worldMin.z),
        new (pc as any).Vec3(worldMax.x, worldMin.y, worldMax.z),
        new (pc as any).Vec3(worldMax.x, worldMax.y, worldMin.z),
        new (pc as any).Vec3(worldMax.x, worldMax.y, worldMax.z),
      ];

      let minScreenX = Infinity;
      let maxScreenX = -Infinity;
      let minScreenY = Infinity;
      let maxScreenY = -Infinity;

      for (const corner of corners) {
        const screenPos = camera.camera.worldToScreen(corner, screenWidth, screenHeight);
        if (screenPos) {
          // worldToScreen returns pixel coordinates, not normalized
          minScreenX = Math.min(minScreenX, screenPos.x);
          maxScreenX = Math.max(maxScreenX, screenPos.x);
          minScreenY = Math.min(minScreenY, screenPos.y);
          maxScreenY = Math.max(maxScreenY, screenPos.y);
        }
      }

      if (!isFinite(minScreenX) || !isFinite(maxScreenX)) {
        this.log(this.LOG_VERBOSE, '[KTX2] Failed to project to screen space, starting from lowest res');
        return levelCount - 1;
      }

      const screenSizeX = Math.abs(maxScreenX - minScreenX);
      const screenSizeY = Math.abs(maxScreenY - minScreenY);

      // Use the larger dimension
      const targetScreenSize = Math.max(screenSizeX, screenSizeY);

      this.log(this.LOG_VERBOSE, '[KTX2] Adaptive calculation:', {
        screenSize: `${screenSizeX.toFixed(0)}x${screenSizeY.toFixed(0)} px`,
        targetSize: `${targetScreenSize.toFixed(0)} px`,
        baseTextureSize: `${baseW}x${baseH}`,
      });

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
          this.log(this.LOG_VERBOSE, `[KTX2] Starting from level ${level} (${mipWidth}x${mipHeight})`);
          return level;
        }
      }

      // If we get here, even the highest res isn't enough, so start from level 0
      this.log(this.LOG_VERBOSE, '[KTX2] Starting from highest res (level 0)');
      return 0;

    } catch (error) {
      this.logError('[KTX2] Error calculating start level:', error);
      return levelCount - 1;
    }
  }
}

export default Ktx2ProgressiveLoader;
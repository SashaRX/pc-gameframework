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
} from './types';
import { KtxCacheManager } from './KtxCacheManager';
import { alignValue, readU64asNumber, writeU64 } from './utils/alignment';
import { parseDFDColorSpace } from './utils/colorspace';
import { normalizePlayCanvasAssetUrl } from '../utils/url';

type LibktxFactory = (moduleConfig?: Record<string, unknown>) => Promise<KtxModule>;

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

  // KTX API (cwrap wrappers)
  private ktxApi: KtxApi | null = null;

  // Cache manager
  private cacheManager: KtxCacheManager | null = null;

  // Custom material for LOD control
  private customMaterial: pc.StandardMaterial | null = null;

  // Initialization guard
  private initializationPromise: Promise<void> | null = null;

  // Cached libktx factory import
  private libktxFactoryCache = new Map<string, Promise<LibktxFactory>>();

  private libktxModuleUrls: string[] = [];
  private libktxWasmUrls: string[] = [];

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
   * Register custom shader chunk for progressive LOD clamping
   * This allows the shader to clamp LOD to the available mipmap range
   */
  private createShaderChunk(): void {
    const device = this.app.graphicsDevice;
    const chunks = (pc as any).ShaderChunks.get(device, (pc as any).SHADERLANGUAGE_GLSL);

    chunks.set('diffusePS', `
// diffusePS — анизотропия сохраняется, LOD клампится в [min,max]
uniform sampler2D texture_diffuseMap;
uniform float material_minAvailableLod; // min LOD, = BASE_LEVEL
uniform float material_maxAvailableLod; // max LOD, = MAX_LEVEL

void getAlbedo() {
    dAlbedo = vec3(1.0);
    #ifdef STD_DIFFUSE_TEXTURE
        vec2 uv = {STD_DIFFUSE_TEXTURE_UV};

        // Производные в нормализованных UV
        vec2 dudx = dFdx(uv);
        vec2 dudy = dFdy(uv);

        // Оценка auto-LOD
        vec2 texSize = vec2(textureSize(texture_diffuseMap, 0));
        float rho2 = max(dot(dudx * texSize, dudx * texSize),
                         dot(dudy * texSize, dudy * texSize));
        float autoLod = 0.5 * log2(rho2);

        // Клампим в доступное окно
        float targetLod = clamp(autoLod,
                                material_minAvailableLod,
                                material_maxAvailableLod);

        // Масштабируем производные
        float scale = exp2(targetLod - autoLod);

        // Аппаратная анизотропия + трилинеар
        dAlbedo = textureGrad(texture_diffuseMap, uv,
                             dudx * scale, dudy * scale).rgb;
    #endif

    #ifdef STD_DIFFUSE_CONSTANT
        dAlbedo *= material_diffuse.rgb;
    #endif
}
`);

    if (this.config.verbose) {
      console.log('[KTX2] Custom shader chunk registered');
    }
  }

  /**
   * Initialize the loader (load libktx, setup worker, init cache)
   */
  async initialize(
    libktxModuleUrl?: string | string[],
    libktxWasmUrl?: string | string[],
  ): Promise<void> {
    if (this.initializationPromise) {
      if (this.config.verbose) {
        console.log('[KTX2] initialize() called again, waiting for existing initialization');
      }

      return this.initializationPromise;
    }

    const promise = this.performInitialization(libktxModuleUrl, libktxWasmUrl);

    this.initializationPromise = promise
      .then(() => {
        return;
      })
      .catch((error) => {
        this.initializationPromise = null;
        throw error;
      });

    return this.initializationPromise;
  }

  private async performInitialization(
    libktxModuleUrl?: string | string[],
    libktxWasmUrl?: string | string[],
  ): Promise<void> {
    if (this.config.verbose) {
      console.log('[KTX2] Initializing loader...');
    }

    this.libktxModuleUrls = this.resolveAbsoluteUrls(libktxModuleUrl);
    this.libktxWasmUrls = this.resolveAbsoluteUrls(libktxWasmUrl);

    if (this.config.verbose) {
      console.log('[KTX2] Resolved module URLs:', this.libktxModuleUrls.length ? this.libktxModuleUrls : ['(not provided)']);
      console.log('[KTX2] Resolved WASM URLs:', this.libktxWasmUrls.length ? this.libktxWasmUrls : ['(not provided)']);
    }

    // Register custom shader chunk for progressive LOD clamping
    this.createShaderChunk();

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
      const success = await this.initWorker(this.libktxModuleUrls[0], this.libktxWasmUrls[0]);
      if (!success && this.config.verbose) {
        console.warn('[KTX2] Worker initialization failed, will use main thread');
      }
    }

    // Fallback: initialize main thread module
    if (!this.config.useWorker || !this.workerReady) {
      await this.initMainThreadModule(this.libktxModuleUrls, this.libktxWasmUrls);
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
    // Load from lowest quality (highest mip index) to highest quality (mip 0)
    let lastFrameTime = performance.now();
    const targetLevel = 0; // Always load up to the highest quality (level 0)

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

      // Update LOD range as we load each level
      if (i < minAvailableLod) minAvailableLod = i;
      if (i > maxAvailableLod) maxAvailableLod = i;

      // Upload to GPU with progressive LOD update
      this.uploadMipLevel(texture, i, result, minAvailableLod, maxAvailableLod);
      loadStats.levelsLoaded++;

      // Apply texture to entity after first level is loaded
      // This makes the texture visible immediately with lowest quality
      if (i === startLevel) {
        this.applyTextureToEntity(entity, texture, probe.levelCount);
        if (this.config.verbose) {
          console.log('[KTX2] Texture applied to entity with initial quality');
        }
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

      // FPS limiter - delay between mip levels (except after the last one)
      if (i > targetLevel) {
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

    // Texture was already applied to entity after first level load
    // All subsequent levels improve the quality progressively

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
  private async initMainThreadModule(
    libktxModuleUrl?: string | string[],
    libktxWasmUrl?: string | string[],
  ): Promise<void> {
    if (this.ktxModule) {
      if (this.config.verbose) {
        console.log('[KTX2] libktx module already initialized on main thread, skipping re-import');
      }
      return;
    }

    const scriptCandidates = this.libktxModuleUrls.length
      ? this.libktxModuleUrls
      : this.resolveAbsoluteUrls(libktxModuleUrl);
    const wasmCandidates = this.libktxWasmUrls.length
      ? this.libktxWasmUrls
      : this.resolveAbsoluteUrls(libktxWasmUrl);

    const scriptUrl = scriptCandidates[0];
    const wasmUrl = wasmCandidates[0];

    if (this.config.verbose) {
      console.log('[KTX2] Loading libktx module on main thread...');
      console.log('[KTX2] Module URL candidates:', scriptCandidates.length ? scriptCandidates : ['(not provided)']);
      console.log('[KTX2] WASM URL candidates:', wasmCandidates.length ? wasmCandidates : ['(not provided)']);
    }

    try {
      // Fetch and evaluate libktx.mjs as a script
      // This works in AMD/PlayCanvas environment
      if (!scriptCandidates.length) {
        throw new Error('libktxModuleUrl is required. Pass app.assets.find("libktx.mjs").getFileUrl()');
      }

      const createKtxModule = await this.loadLibktxScript(scriptCandidates);

      if (this.config.verbose) {
        console.log('[KTX2] Script loaded, creating module instance...');
      }

      // Initialize the module
      const moduleConfig: any = {};

      // Track runtime initialization
      let runtimeInitialized = false;
      const verbose = this.config.verbose;

      if (wasmUrl) {
        moduleConfig.locateFile = (filename: string) => {
          if (this.config.verbose) {
            console.log('[KTX2] locateFile called for:', filename);
          }
          if (filename.endsWith('.wasm')) {
            if (this.config.verbose) {
              console.log('[KTX2] Returning WASM URL:', wasmUrl);
            }
            return wasmUrl;
          }
          return filename;
        };
      } else if (this.config.verbose) {
        console.warn('[KTX2] WASM URL not provided, locateFile fallback will not redirect requests');
      }

      if (this.config.verbose) {
        console.log('[KTX2] Initializing WASM module...');
      }

      // CRITICAL: We need to wrap onRuntimeInitialized BEFORE the module fully initializes
      // createKtxModule returns a promise, but the module object is available synchronously
      // We need to get the module object and wrap its callback before awaiting
      const modulePromise = createKtxModule(moduleConfig);

      // The promise resolves to the module, but we need to intercept during initialization
      // Use .then() to get the module object before it's fully initialized
      this.ktxModule = await new Promise<KtxModule>((resolve, reject) => {
        modulePromise.then((module: any) => {
          if (verbose) {
            console.log('[KTX2] Module promise resolved, checking initialization...');
            console.log('[KTX2] Module has Ih:', typeof module.Ih);
            console.log('[KTX2] Module has onRuntimeInitialized:', typeof module.onRuntimeInitialized);

            // Debug: List ALL properties of the module
            console.log('[KTX2] === MODULE PROPERTIES START ===');
            const allKeys = Object.keys(module);
            console.log('[KTX2] Total properties:', allKeys.length);
            console.log('[KTX2] First 50 properties:', allKeys.slice(0, 50));

            // Check for embind-related properties
            const embindKeys = allKeys.filter(k => k.includes('ktx') || k.includes('Ktx') || k.includes('texture') || k.includes('Texture'));
            console.log('[KTX2] Properties with "ktx/texture":', embindKeys);

            // Check for potential C++ exports
            const exportKeys = allKeys.filter(k => k.length === 2 || (k.length === 2 && k.match(/^[A-Z][a-z]$/)));
            console.log('[KTX2] Short 2-letter properties (might be minified exports):', exportKeys);

            // Check cwrap and embind
            console.log('[KTX2] Has cwrap:', typeof module.cwrap);
            console.log('[KTX2] Has ccall:', typeof module.ccall);
            console.log('[KTX2] Has _malloc:', typeof module._malloc);
            console.log('[KTX2] Has _free:', typeof module._free);
            console.log('[KTX2] === MODULE PROPERTIES END ===');
          }

          // At this point, onRuntimeInitialized might have already fired
          // Check if module is already initialized
          if (module.ktxTexture) {
            if (verbose) {
              console.log('[KTX2] Module already initialized (ktxTexture exists)');
            }
            runtimeInitialized = true;
            resolve(module);
            return;
          }

          // If not initialized yet, we need to wait
          // But since we're here after the promise resolved, it's likely already done
          // Let's try calling Ih manually if it exists
          if (module.Ih && typeof module.Ih === 'function') {
            if (verbose) {
              console.log('[KTX2] Calling Module.Ih() manually to create bindings...');
              console.log('[KTX2] Before Ih() - Lh:', typeof module.Lh, 'Dh:', typeof module.Dh);
            }

            try {
              module.Ih();

              if (verbose) {
                console.log('[KTX2] After Ih() - ktxTexture:', typeof module.ktxTexture);
                console.log('[KTX2] After Ih() - ErrorCode:', typeof module.ErrorCode);
                console.log('[KTX2] After Ih() - TranscodeTarget:', typeof module.TranscodeTarget);
              }
            } catch (e) {
              if (verbose) {
                console.log('[KTX2] Error calling Ih():', e);
              }
            }
          }

          // Manual fallback if Ih didn't work
          if (!module.ktxTexture && module.Lh) {
            if (verbose) {
              console.log('[KTX2] Manual fallback: creating bindings from internal properties');
            }
            module.ktxTexture = module.Lh;
            module.ErrorCode = module.Dh;
            module.TranscodeTarget = module.Oh;
            module.TranscodeFlags = module.Nh;
          }

          runtimeInitialized = true;
          resolve(module);
        }).catch(reject);
      });

      if (this.config.verbose) {
        console.log('[KTX2] Module created successfully');
      }

      if (!this.ktxModule) {
        throw new Error('Failed to create KTX module');
      }

      // Wait for module to be fully ready (if it's a promise)
      if (typeof (this.ktxModule as any).then === 'function') {
        if (this.config.verbose) {
          console.log('[KTX2] Module is a promise, waiting for initialization...');
        }
        this.ktxModule = await (this.ktxModule as any);
      }

      // Wait for WASM runtime initialization
      // The ktxTexture constructor is created in onRuntimeInitialized callback
      if (!runtimeInitialized) {
        if (this.config.verbose) {
          console.log('[KTX2] Waiting for WASM runtime initialization...');
        }

        // Create a promise that resolves when runtime is initialized
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('WASM runtime initialization timeout after 10 seconds'));
          }, 10000);

          const checkInterval = setInterval(() => {
            if (runtimeInitialized && this.ktxModule && this.ktxModule.ktxTexture) {
              clearInterval(checkInterval);
              clearTimeout(timeout);
              if (this.config.verbose) {
                console.log('[KTX2] WASM runtime initialized successfully');
              }
              resolve();
            }
          }, 50);
        });
      }

      if (!this.ktxModule) {
        throw new Error('Module lost during initialization');
      }

      if (this.config.verbose) {
        console.log('[KTX2] === MODULE INSPECTION START ===');
        console.log('[KTX2] Module has ktxTexture:', typeof this.ktxModule.ktxTexture);
        console.log('[KTX2] Module has ErrorCode:', typeof this.ktxModule.ErrorCode);
        console.log('[KTX2] Module has TranscodeTarget:', typeof this.ktxModule.TranscodeTarget);
        console.log('[KTX2] Module has HEAPU8:', typeof this.ktxModule.HEAPU8);

        // Inspect TranscodeTarget structure
        if (this.ktxModule.TranscodeTarget) {
          const tt: any = this.ktxModule.TranscodeTarget;
          console.log('[KTX2] TranscodeTarget analysis:');
          console.log('[KTX2]   - Type:', typeof tt);
          console.log('[KTX2]   - Is function:', typeof tt === 'function');
          console.log('[KTX2]   - Keys:', Object.keys(tt).length > 0 ? Object.keys(tt).slice(0, 15) : '(no keys)');
          console.log('[KTX2]   - .values property:', typeof tt.values, tt.values ? '(exists)' : '(undefined)');

          // Try different access patterns
          console.log('[KTX2]   - Trying tt.RGBA32:', tt.RGBA32);
          console.log('[KTX2]   - Trying tt["RGBA32"]:', tt["RGBA32"]);
          console.log('[KTX2]   - Trying tt.values?.RGBA32:', tt.values?.RGBA32);

          // If it's a function, try calling it
          if (typeof tt === 'function') {
            console.log('[KTX2]   - Is constructor-like function');
            try {
              console.log('[KTX2]   - Function.name:', tt.name);
              console.log('[KTX2]   - Function.length:', tt.length);
            } catch (e) {
              console.log('[KTX2]   - Error inspecting function:', e);
            }
          }
        }

        // Inspect ErrorCode structure
        if (this.ktxModule.ErrorCode) {
          const ec: any = this.ktxModule.ErrorCode;
          console.log('[KTX2] ErrorCode analysis:');
          console.log('[KTX2]   - Type:', typeof ec);
          console.log('[KTX2]   - Is function:', typeof ec === 'function');
          console.log('[KTX2]   - Keys:', Object.keys(ec).length > 0 ? Object.keys(ec).slice(0, 15) : '(no keys)');
          console.log('[KTX2]   - .values property:', typeof ec.values, ec.values ? '(exists)' : '(undefined)');

          // Try different access patterns
          console.log('[KTX2]   - Trying ec.SUCCESS:', ec.SUCCESS);
          console.log('[KTX2]   - Trying ec["SUCCESS"]:', ec["SUCCESS"]);
          console.log('[KTX2]   - Trying ec.values?.SUCCESS:', ec.values?.SUCCESS);
        }

        console.log('[KTX2] === MODULE INSPECTION END ===');
      }

      if (!this.ktxModule) {
        throw new Error('Module not initialized properly');
      }

      // Create cwrap API wrappers
      if (this.config.verbose) {
        console.log('[KTX2] Creating cwrap API wrappers...');
      }

      this.ktxApi = this.createKtxApi(this.ktxModule);

      if (this.config.verbose) {
        console.log('[KTX2] libktx module loaded successfully (cwrap C API)');
      }
    } catch (error) {
      console.error('[KTX2] Failed to load libktx module:', error);
      throw error;
    }
  }

  /**
   * Load libktx.mjs script dynamically using ES module import
   * Works in PlayCanvas 2.x ESM environment
   */
  private async loadLibktxScript(urls: string[]): Promise<LibktxFactory> {
    if (!urls.length) {
      throw new Error('libktx module URL is empty');
    }

    for (const candidate of urls) {
      if (!candidate) {
        continue;
      }

      const resolvedUrl = this.resolveAbsoluteUrl(candidate);

      if (!resolvedUrl) {
        continue;
      }

      if (this.libktxFactoryCache.has(resolvedUrl)) {
        if (this.config.verbose) {
          console.log('[KTX2] Reusing cached libktx module factory for:', resolvedUrl);
        }
        return this.libktxFactoryCache.get(resolvedUrl)!;
      }

      if (this.config.verbose) {
        console.log('[KTX2] Importing libktx module via dynamic import...');
        console.log('[KTX2] Dynamic import URL:', resolvedUrl);
      }

      const importPromise: Promise<LibktxFactory> = (async () => {
        try {
          const module = await import(/* webpackIgnore: true */ resolvedUrl);

          if (this.config.verbose) {
            console.log('[KTX2] Module imported successfully');
            console.log('[KTX2] Module exports:', Object.keys(module));
          }

          const exportsToCheck: Array<unknown> = [
            (module as { default?: unknown }).default,
            (module as { createKtxModule?: unknown }).createKtxModule,
            module,
          ];

          const createModule = exportsToCheck.find((candidateExport) => typeof candidateExport === 'function') as
            | LibktxFactory
            | undefined;

          if (!createModule) {
            throw new Error('No default export found in libktx module');
          }

          if (this.config.verbose) {
            console.log('[KTX2] Got module factory function');
          }

          return createModule;
        } catch (error) {
          await this.logLibktxImportFailure(resolvedUrl, error);
          throw error;
        }
      })();

      this.libktxFactoryCache.set(resolvedUrl, importPromise);

      try {
        return await importPromise;
      } catch (error) {
        if (this.config.verbose) {
          console.warn('[KTX2] Failed to import libktx module from candidate:', resolvedUrl, error);
        }
        this.libktxFactoryCache.delete(resolvedUrl);
      }
    }

    throw new Error('Failed to import libktx module from provided URLs');
  }

  private async logLibktxImportFailure(url: string, error: unknown): Promise<void> {
    console.error('[KTX2] Error importing libktx module:', error);
    console.error('[KTX2] Import URL:', url);

    if (typeof fetch !== 'function') {
      return;
    }

    try {
      const response = await fetch(url, { method: 'HEAD' });
      console.error('[KTX2] HEAD status:', response.status, response.statusText);

      if (!response.ok) {
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        console.error('[KTX2] HEAD response headers:', headers);
      }
    } catch (diagnosticError) {
      console.error('[KTX2] Failed to collect diagnostics for libktx import:', diagnosticError);
    }
  }

  private resolveAbsoluteUrl(url?: string): string | undefined {
    const normalized = normalizePlayCanvasAssetUrl(url);

    if (!normalized) {
      return undefined;
    }

    // Already absolute (starts with a scheme)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
      return normalized;
    }

    const base = (() => {
      if (typeof window !== 'undefined' && window.location) {
        return window.location.href;
      }
      if (typeof globalThis !== 'undefined') {
        const scoped = globalThis as { location?: { href?: string } };
        if (scoped.location?.href) {
          return scoped.location.href;
        }
      }
      return undefined;
    })();

    if (!base) {
      return normalized;
    }

    try {
      return new URL(normalized, base).href;
    } catch (error) {
      if (this.config.verbose) {
        console.warn('[KTX2] Failed to resolve absolute URL, using raw value:', normalized, error);
      }
      return normalized;
    }
  }

  private resolveAbsoluteUrls(url?: string | string[]): string[] {
    const values = Array.isArray(url) ? url : url ? [url] : [];
    const resolved: string[] = [];

    for (const value of values) {
      const absolute = this.resolveAbsoluteUrl(value);

      if (absolute && !resolved.includes(absolute)) {
        resolved.push(absolute);
      }
    }

    return resolved;
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

    if (this.config.verbose) {
      console.log(`[KTX2] SGD repacked for level ${levelIndex}: ${levelImageCount} images (of ${imageCountFull} total), ${sgdFull.byteLength}→${newSgdSize} bytes`);
    }

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

    if (this.config.verbose) {
      // Get header info for debugging
      const headerView = new DataView(miniKtx.buffer, 0, 80);
      const levelCount = headerView.getUint32(40, true);
      const vkFormat = headerView.getUint32(12, true);

      console.log(`[KTX2] Repacked level ${level}:`, {
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
    }

    return miniKtx;
  }

  /**
   * Create cwrap API wrappers for KTX C functions
   * Based on old working implementation from Ktx2ProgressiveVanilla.js
   */
  private createKtxApi(module: KtxModule): KtxApi {
    if (this.config.verbose) {
      console.log('[KTX2] Creating cwrap wrappers for C API...');
    }

    const api: KtxApi = {
      malloc: module.cwrap('malloc', 'number', ['number']),
      free: module.cwrap('free', null, ['number']),
      createFromMemory: module.cwrap('ktxTexture2_CreateFromMemory', 'number', ['number', 'number', 'number', 'number']),
      destroy: module.cwrap('ktxTexture2_Destroy', null, ['number']),
      transcode: module.cwrap('ktxTexture2_TranscodeBasis', 'number', ['number', 'number', 'number']),
      needsTranscoding: module.cwrap('ktxTexture2_NeedsTranscoding', 'number', ['number']),
      getData: module.cwrap('ktx_get_data', 'number', ['number']),
      getDataSize: module.cwrap('ktx_get_data_size', 'number', ['number']),
      getWidth: module.cwrap('ktx_get_base_width', 'number', ['number']),
      getHeight: module.cwrap('ktx_get_base_height', 'number', ['number']),
      getLevels: module.cwrap('ktx_get_num_levels', 'number', ['number']),
      getOffset: module.cwrap('ktx_get_image_offset', 'number', ['number', 'number', 'number', 'number']),
      errorString: module.cwrap('ktxErrorString', 'string', ['number']),
    };

    if (this.config.verbose) {
      console.log('[KTX2] cwrap API created:', Object.keys(api));
    }

    return api;
  }

  /**
   * Transcode mini-KTX2 to RGBA using libktx
   * Routes to worker if available, otherwise uses main thread
   */
  private async transcode(miniKtx: Uint8Array): Promise<Ktx2TranscodeResult> {
    // For now, use main thread (worker implementation is TODO)
    if (!this.ktxModule) {
      throw new Error('libktx not initialized. Call initialize() first.');
    }

    return this.transcodeMainThread(miniKtx);
  }

  /**
   * Transcode on main thread using libktx (cwrap C API)
   * Based on working implementation from Ktx2ProgressiveVanilla.js
   */
  private transcodeMainThread(miniKtx: Uint8Array): Ktx2TranscodeResult {
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
          if (this.config.verbose) {
            const baseW = api.getWidth(texPtr);
            const baseH = api.getHeight(texPtr);
            console.log('[KTX2] Texture created from mini-KTX');
            console.log('[KTX2] - Base dimensions:', baseW, 'x', baseH);
          }

          // Check if transcoding is needed
          const needsTranscode = api.needsTranscoding(texPtr);

          if (needsTranscode) {
            if (this.config.verbose) {
              console.log('[KTX2] Starting transcoding to RGBA32...');
            }

            // Get RGBA32 format constant (value: 13)
            const RGBA32_FORMAT = typeof this.ktxModule.TranscodeTarget === 'function'
              ? 13
              : (this.ktxModule.TranscodeTarget.RGBA32?.value ?? 13);

            // Transcode to RGBA32
            const rcT = api.transcode(texPtr, RGBA32_FORMAT, 0);

            if (rcT !== 0) {
              const errorMsg = api.errorString ? api.errorString(rcT) : `Error code ${rcT}`;
              api.destroy(texPtr);
              throw new Error(`Transcoding failed: ${errorMsg}`);
            }

            if (this.config.verbose) {
              console.log('[KTX2] Transcoding succeeded');
            }
          }

          // Get texture data
          const dataPtr = api.getData(texPtr);
          const baseW = api.getWidth(texPtr);
          const baseH = api.getHeight(texPtr);
          const dataSize = api.getDataSize(texPtr);

          if (this.config.verbose) {
            console.log('[KTX2] Getting texture data...');
            console.log('[KTX2] - Dimensions:', baseW, 'x', baseH);
            console.log('[KTX2] - Data size:', dataSize, 'bytes');
            console.log('[KTX2] - Data pointer:', dataPtr);
          }

          // Calculate expected size
          const expected = baseW * baseH * 4; // RGBA
          const total = Math.min(expected, dataSize);

          if (this.config.verbose) {
            console.log('[KTX2] - Expected size:', expected, 'bytes');
            console.log('[KTX2] - Copying', total, 'bytes from WASM heap');
          }

          // Copy data from WASM heap
          const rgbaData = new Uint8Array(ktx.HEAPU8.buffer, dataPtr, total);
          const dataCopy = new Uint8Array(rgbaData); // Make a copy to persist after destroy

          if (this.config.verbose) {
            console.log('[KTX2] - Data copied successfully');
          }

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

  private createTexture(probe: Ktx2ProbeResult): pc.Texture {
    // Determine pixel format based on colorspace
    // In PlayCanvas 2.x, color textures (diffuse, albedo, etc) should use sRGB formats
    // Linear formats are used for data textures (normal maps, roughness, etc)
    const useSrgb = this.config.isSrgb || probe.colorSpace?.isSrgb;
    // Note: Using numeric constants directly as the named exports may not be available
    // PIXELFORMAT_RGBA8 = 7, PIXELFORMAT_SRGBA8 = 20
    const format = useSrgb ? 20 : 7;

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

    // Initialize base mip level with placeholder data
    // This is REQUIRED to create the WebGL texture object
    // Without this, texture.impl._glTexture will be undefined
    {
      const initSize = probe.width * probe.height * 4;
      const initData = new Uint8Array(initSize);
      // Fill with gray color (128, 128, 128, 255)
      for (let i = 0; i < initSize; i += 4) {
        initData[i] = 128;     // R
        initData[i + 1] = 128; // G
        initData[i + 2] = 128; // B
        initData[i + 3] = 255; // A
      }
      const pixels = texture.lock();
      pixels.set(initData);
      texture.unlock();
    }

    // Initialize all mipmap levels with placeholder data
    // This ensures the WebGL texture is fully allocated
    const device = this.app.graphicsDevice;
    const gl = (device as any).gl as WebGL2RenderingContext | null;
    const glTexture = (texture as any).impl?._glTexture;

    if (gl && glTexture) {
      const prevBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, glTexture);

      // Initialize all mip levels > 0
      for (let i = 1; i < probe.levelCount; i++) {
        const mipWidth = Math.max(1, probe.width >> i);
        const mipHeight = Math.max(1, probe.height >> i);
        const mipSize = mipWidth * mipHeight * 4;
        const mipData = new Uint8Array(mipSize);
        // Fill with gray
        for (let j = 0; j < mipSize; j += 4) {
          mipData[j] = 128;
          mipData[j + 1] = 128;
          mipData[j + 2] = 128;
          mipData[j + 3] = 255;
        }
        gl.texImage2D(gl.TEXTURE_2D, i, gl.RGBA, mipWidth, mipHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, mipData);
      }

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
          if (this.config.verbose) {
            console.log(`[KTX2] Anisotropy enabled: ${Math.min(8, maxAniso)}x`);
          }
        }
      }

      gl.bindTexture(gl.TEXTURE_2D, prevBinding);
    }

    if (this.config.verbose) {
      console.log(`[KTX2] Created texture with format: ${useSrgb ? 'SRGBA8' : 'RGBA8'}`);
      console.log(`[KTX2] Initialized ${probe.levelCount} mip levels with placeholder data`);
    }

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
  private uploadMipLevel(texture: pc.Texture, level: number, result: Ktx2TranscodeResult, minAvailableLod: number, maxAvailableLod: number): void {
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

        // Even for level 0, we need to update WebGL LOD parameters and shader uniforms
        const device = this.app.graphicsDevice;
        const gl = (device as any).gl as WebGL2RenderingContext | null;
        if (gl) {
          const webglTexture = (texture as any).impl?._glTexture;
          if (webglTexture) {
            const prevBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
            gl.bindTexture(gl.TEXTURE_2D, webglTexture);

            // Update WebGL LOD range
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, minAvailableLod);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, maxAvailableLod);

            gl.bindTexture(gl.TEXTURE_2D, prevBinding);
          }
        }

        // Update shader uniforms
        const customMaterial = (this as any)._customMaterial;
        if (customMaterial) {
          customMaterial.setParameter('material_minAvailableLod', minAvailableLod);
          customMaterial.setParameter('material_maxAvailableLod', maxAvailableLod);
          customMaterial.update(); // Force shader update
          if (this.config.verbose) {
            console.log(`[KTX2] Updated LOD window: [${minAvailableLod}, ${maxAvailableLod}]`);
          }
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

        // Bind the texture - use impl._glTexture for PlayCanvas 2.12.4+
        const webglTexture = (texture as any).impl?._glTexture;
        if (!webglTexture) {
          console.error('[KTX2] WebGL texture not found - texture.impl may not be initialized');
          return;
        }

        // Save previous binding to restore it later
        const prevBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
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

        // Update LOD range to show progressively better quality
        // We load from level 13 (1x1) down to level 0 (8192x8192)
        // BASE_LEVEL = best quality available (minAvailableLod)
        // MAX_LEVEL = worst quality available (maxAvailableLod)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, minAvailableLod);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, maxAvailableLod);

        // Restore previous binding
        gl.bindTexture(gl.TEXTURE_2D, prevBinding);

        // Update shader uniform for LOD clamping
        const customMaterial = (this as any)._customMaterial;
        if (customMaterial) {
          customMaterial.setParameter('material_minAvailableLod', minAvailableLod);
          customMaterial.setParameter('material_maxAvailableLod', maxAvailableLod);
          customMaterial.update(); // Force shader update
          if (this.config.verbose) {
            console.log(`[KTX2] Updated LOD window: [${minAvailableLod}, ${maxAvailableLod}]`);
          }
        }
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

    if (this.config.verbose) {
      console.log(`[KTX2] Texture applied to material with LOD uniforms [${minLod}, ${maxLod}]`);
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
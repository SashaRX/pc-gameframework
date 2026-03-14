/**
 * MeshoptLoader - Singleton for loading meshoptimizer decoder in PlayCanvas
 *
 * Handles loading meshopt_decoder.mjs from PlayCanvas Asset Registry
 * without using dynamic import() which fails in published builds.
 *
 * The decoder includes embedded WASM and supports SIMD auto-detection.
 */

import type * as pc from 'playcanvas';

/**
 * MeshoptDecoder interface - decoder API from meshoptimizer library
 */
export interface MeshoptDecoder {
  /** Promise that resolves when WASM is initialized */
  ready: Promise<void>;
  /** Whether WASM/SIMD is supported in this browser */
  supported: boolean;

  /**
   * Decode vertex buffer with optional filter
   * @param target Output buffer (must be pre-allocated: count * size bytes)
   * @param count Number of vertices
   * @param size Byte stride per vertex
   * @param source Compressed data
   * @param filter Optional filter: 'NONE', 'OCTAHEDRAL', 'QUATERNION', 'EXPONENTIAL'
   */
  decodeVertexBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array,
    filter?: string
  ): void;

  /**
   * Decode index buffer (triangles)
   * @param target Output buffer (must be pre-allocated: count * size bytes)
   * @param count Number of indices
   * @param size Index size in bytes (2 or 4)
   * @param source Compressed data
   */
  decodeIndexBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array
  ): void;

  /**
   * Decode index sequence
   * @param target Output buffer (must be pre-allocated: count * size bytes)
   * @param count Number of indices
   * @param size Index size in bytes (2 or 4)
   * @param source Compressed data
   */
  decodeIndexSequence(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array
  ): void;

  /**
   * Decode glTF buffer (unified API for EXT_meshopt_compression)
   * @param target Output buffer
   * @param count Element count
   * @param size Element size in bytes
   * @param source Compressed data
   * @param mode Decode mode: 'ATTRIBUTES', 'TRIANGLES', 'INDICES'
   * @param filter Optional filter for vertex data
   */
  decodeGltfBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array,
    mode: string,
    filter?: string
  ): void;

  /**
   * Initialize worker pool for async decoding
   * @param count Number of workers
   */
  useWorkers(count: number): void;

  /**
   * Async decode glTF buffer using workers
   * @param count Element count
   * @param size Element size in bytes
   * @param source Compressed data
   * @param mode Decode mode: 'ATTRIBUTES', 'TRIANGLES', 'INDICES'
   * @param filter Optional filter for vertex data
   * @returns Promise resolving to decoded Uint8Array
   */
  decodeGltfBufferAsync(
    count: number,
    size: number,
    source: Uint8Array,
    mode: string,
    filter?: string
  ): Promise<Uint8Array>;
}

/**
 * Meshopt decode modes for EXT_meshopt_compression
 */
export const MeshoptMode = {
  ATTRIBUTES: 'ATTRIBUTES',
  TRIANGLES: 'TRIANGLES',
  INDICES: 'INDICES'
} as const;

/**
 * Meshopt filters for vertex data
 */
export const MeshoptFilter = {
  NONE: 'NONE',
  OCTAHEDRAL: 'OCTAHEDRAL',   // For normals/tangents
  QUATERNION: 'QUATERNION',    // For rotations
  EXPONENTIAL: 'EXPONENTIAL'   // For HDR data
} as const;

export type MeshoptModeType = typeof MeshoptMode[keyof typeof MeshoptMode];
export type MeshoptFilterType = typeof MeshoptFilter[keyof typeof MeshoptFilter];

export class MeshoptLoader {
  private static instance: MeshoptLoader | null = null;
  private decoder: MeshoptDecoder | null = null;
  private initPromise: Promise<MeshoptDecoder> | null = null;
  private verbose = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): MeshoptLoader {
    if (!MeshoptLoader.instance) {
      MeshoptLoader.instance = new MeshoptLoader();
    }
    return MeshoptLoader.instance;
  }

  /**
   * Initialize meshopt decoder from external URL or PlayCanvas Asset Registry
   * @param app PlayCanvas application
   * @param verbose Enable verbose logging
   * @param meshoptUrl Optional external URL for meshopt_decoder.mjs
   * @returns Initialized MeshoptDecoder
   */
  public async initialize(
    app: pc.Application,
    verbose = false,
    meshoptUrl?: string
  ): Promise<MeshoptDecoder> {
    this.verbose = verbose;

    // Return cached decoder if already initialized
    if (this.decoder) {
      if (this.verbose) {
        console.log('[MeshoptLoader] Using cached meshopt decoder');
      }
      return this.decoder;
    }

    // Return pending promise if initialization is in progress
    if (this.initPromise) {
      if (this.verbose) {
        console.log('[MeshoptLoader] Initialization already in progress...');
      }
      return this.initPromise;
    }

    // Start initialization
    this.initPromise = this._initializeInternal(app, meshoptUrl);
    return this.initPromise;
  }

  private async _initializeInternal(
    app: pc.Application,
    meshoptUrl?: string
  ): Promise<MeshoptDecoder> {
    try {
      if (this.verbose) {
        console.log('[MeshoptLoader] Starting initialization...');
      }

      let mjsUrl: string;

      // Step 1: Get URL - use external URL if provided, otherwise use Asset Registry
      if (meshoptUrl) {
        // Use external URL
        if (this.verbose) {
          console.log('[MeshoptLoader] Using external URL');
        }
        mjsUrl = meshoptUrl;
      } else {
        // Find asset in PlayCanvas Asset Registry
        const mjsAsset = this._findAsset(app);

        // Get asset URL
        const mjsUrlNullable = mjsAsset.getFileUrl();

        if (!mjsUrlNullable) {
          throw new Error(
            '[MeshoptLoader] Asset URL not available. Make sure asset is loaded and has valid URL.'
          );
        }

        mjsUrl = mjsUrlNullable;
      }

      if (this.verbose) {
        console.log('[MeshoptLoader] Asset URL:', mjsUrl);
      }

      // Step 2: Load JS code as text (NOT via import)
      const jsCode = await this._loadJsAsText(mjsUrl);

      // Parse version from file comment: "Built from meshoptimizer 0.21"
      const verMatch = jsCode.match(/meshoptimizer\s+([\d.]+)/);
      if (verMatch) {
        console.log('[SYSTEM] meshopt: ' + verMatch[1]);
      }

      // Step 3: Execute JS code to get MeshoptDecoder
      const decoder = this._executeJsCode(jsCode, mjsUrl);

      // Step 4: Wait for WASM initialization
      if (this.verbose) {
        console.log('[MeshoptLoader] Waiting for WASM initialization...');
      }
      await decoder.ready;

      if (this.verbose) {
        console.log('[MeshoptLoader] WASM initialized, SIMD supported:', decoder.supported);
      }

      this.decoder = decoder;

      if (this.verbose) {
        console.log('[MeshoptLoader] Initialization complete');
      }

      return decoder;

    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  /**
   * Find meshopt_decoder asset in PlayCanvas Asset Registry
   */
  private _findAsset(app: pc.Application): pc.Asset {
    if (this.verbose) {
      console.log('[MeshoptLoader] Searching for meshopt_decoder asset in Asset Registry...');
    }

    // Find meshopt_decoder.mjs - MUST be uploaded as Binary type (NOT Script)
    // In published builds, Script-type assets get inaccessible /js/esm-scripts/ URLs (403)
    // Binary-type assets get accessible /files/assets/ URLs
    let mjsAsset = app.assets.find('meshopt_decoder.mjs', 'binary');
    if (!mjsAsset) {
      // Fallback: try script type (works in editor, fails in published builds)
      mjsAsset = app.assets.find('meshopt_decoder.mjs', 'script');
    }

    // Validate
    if (!mjsAsset) {
      const availableAssets = app.assets.list().map(a => ({
        name: a.name,
        type: a.type
      }));

      console.error('[MeshoptLoader] Asset search failed');
      console.error('[MeshoptLoader] Available assets:', availableAssets);

      throw new Error(
        `[MeshoptLoader] Required asset not found in Asset Registry!\n\n` +
        `Please ensure the following:\n` +
        `1. Upload meshopt_decoder.mjs to PlayCanvas Assets\n` +
        `   - Import as type: Binary (NOT Script or ESM Module!)\n` +
        `   - Why Binary? Script-type assets get 403 errors in published builds\n` +
        `   - Enable Preload\n` +
        `   - Name must be exactly: meshopt_decoder.mjs`
      );
    }

    if (this.verbose) {
      console.log('[MeshoptLoader] Asset found:', mjsAsset.name, `(type: ${mjsAsset.type})`);
    }

    // Warn if uploaded as script type (will fail in published builds)
    if (mjsAsset.type === 'script') {
      console.warn(
        '[MeshoptLoader] WARNING: meshopt_decoder.mjs is uploaded as Script type.\n' +
        'This will cause 403 errors in published builds!\n' +
        'Please re-upload meshopt_decoder.mjs as Binary type for production use.'
      );
    }

    return mjsAsset;
  }

  /**
   * Load JavaScript code as text via fetch
   */
  private async _loadJsAsText(url: string): Promise<string> {
    if (this.verbose) {
      console.log('[MeshoptLoader] Fetching JS code from:', url);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `[MeshoptLoader] Failed to fetch meshopt_decoder.mjs: ${response.status} ${response.statusText}`
      );
    }

    const code = await response.text();

    if (this.verbose) {
      console.log('[MeshoptLoader] JS code loaded:', code.length, 'bytes');
    }

    return code;
  }

  /**
   * Execute JS code and extract the MeshoptDecoder object
   * meshopt_decoder.mjs exports { MeshoptDecoder } as ES module
   */
  private _executeJsCode(code: string, moduleUrl: string): MeshoptDecoder {
    if (this.verbose) {
      console.log('[MeshoptLoader] Executing meshopt_decoder.mjs code...');
    }

    try {
      // Step 1: Replace import.meta.url with actual URL
      // The module uses import.meta.url for worker blob creation
      let modifiedCode = code.replace(/import\.meta\.url/g, `"${moduleUrl}"`);

      // Step 2: Replace import.meta (without .url) if it exists
      modifiedCode = modifiedCode.replace(/import\.meta/g, `{url: "${moduleUrl}"}`);

      // Step 3: Remove export statements (can cause SyntaxError in eval)
      // The module has: export { MeshoptDecoder };
      modifiedCode = modifiedCode.replace(/\bexport\s*\{[^}]*\}/g, '');
      modifiedCode = modifiedCode.replace(/\bexport\s+default\s+/g, '');
      modifiedCode = modifiedCode.replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ');

      if (this.verbose) {
        console.log('[MeshoptLoader] Code modified: removed import.meta and export statements');
      }

      // Step 4: Execute the code - it defines MeshoptDecoder as IIFE result
      // Wrap in a function to create a local scope and return the decoder
      const wrappedCode = `
        (function() {
          ${modifiedCode}
          // Return the MeshoptDecoder object
          return typeof MeshoptDecoder !== 'undefined' ? MeshoptDecoder : null;
        })();
      `;

      // Step 5: Execute and get the decoder object
      const decoder = (0, eval)(wrappedCode);

      if (!decoder || typeof decoder !== 'object') {
        if (this.verbose) {
          console.error('[MeshoptLoader] Decoder type:', typeof decoder);
          console.error('[MeshoptLoader] Decoder value:', decoder);
        }
        throw new Error('[MeshoptLoader] Could not extract MeshoptDecoder from meshopt_decoder.mjs');
      }

      // Verify decoder has expected methods
      if (typeof decoder.ready !== 'object' || typeof decoder.decodeVertexBuffer !== 'function') {
        throw new Error('[MeshoptLoader] MeshoptDecoder is missing expected methods');
      }

      if (this.verbose) {
        console.log('[MeshoptLoader] MeshoptDecoder extracted successfully');
        console.log('[MeshoptLoader] Decoder supported:', decoder.supported);
      }

      return decoder;

    } catch (error) {
      console.error('[MeshoptLoader] Failed to execute JS code:', error);
      throw new Error(
        `[MeshoptLoader] Failed to execute meshopt_decoder.mjs code. Error: ${error}`
      );
    }
  }

  /**
   * Get the initialized decoder (returns null if not initialized)
   */
  public getDecoder(): MeshoptDecoder | null {
    return this.decoder;
  }

  /**
   * Check if decoder is initialized
   */
  public isInitialized(): boolean {
    return this.decoder !== null;
  }

  /**
   * Check if SIMD is supported (must be initialized first)
   */
  public isSimdSupported(): boolean {
    return this.decoder?.supported ?? false;
  }

  /**
   * Initialize worker pool for async decoding
   * @param count Number of workers (default: navigator.hardwareConcurrency or 4)
   */
  public useWorkers(count?: number): void {
    if (!this.decoder) {
      throw new Error('[MeshoptLoader] Decoder not initialized. Call initialize() first.');
    }
    const workerCount = count ?? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) ?? 4;
    this.decoder.useWorkers(workerCount);
    if (this.verbose) {
      console.log(`[MeshoptLoader] Initialized ${workerCount} workers for async decoding`);
    }
  }

  /**
   * Decode vertex buffer synchronously
   */
  public decodeVertexBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array,
    filter?: MeshoptFilterType
  ): void {
    if (!this.decoder) {
      throw new Error('[MeshoptLoader] Decoder not initialized. Call initialize() first.');
    }
    const startTime = this.verbose ? performance.now() : 0;
    this.decoder.decodeVertexBuffer(target, count, size, source, filter);
    if (this.verbose) {
      const elapsed = performance.now() - startTime;
      console.log(`[MeshoptLoader] decodeVertexBuffer: ${count} vertices, ${size} stride, ${elapsed.toFixed(2)}ms`);
    }
  }

  /**
   * Decode index buffer synchronously
   */
  public decodeIndexBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array
  ): void {
    if (!this.decoder) {
      throw new Error('[MeshoptLoader] Decoder not initialized. Call initialize() first.');
    }
    const startTime = this.verbose ? performance.now() : 0;
    this.decoder.decodeIndexBuffer(target, count, size, source);
    if (this.verbose) {
      const elapsed = performance.now() - startTime;
      console.log(`[MeshoptLoader] decodeIndexBuffer: ${count} indices, ${size} bytes, ${elapsed.toFixed(2)}ms`);
    }
  }

  /**
   * Decode glTF buffer (EXT_meshopt_compression) synchronously
   */
  public decodeGltfBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array,
    mode: MeshoptModeType,
    filter?: MeshoptFilterType
  ): void {
    if (!this.decoder) {
      throw new Error('[MeshoptLoader] Decoder not initialized. Call initialize() first.');
    }
    const startTime = this.verbose ? performance.now() : 0;
    this.decoder.decodeGltfBuffer(target, count, size, source, mode, filter);
    if (this.verbose) {
      const elapsed = performance.now() - startTime;
      console.log(`[MeshoptLoader] decodeGltfBuffer (${mode}): ${count} elements, ${elapsed.toFixed(2)}ms`);
    }
  }

  /**
   * Decode glTF buffer asynchronously using workers
   */
  public async decodeGltfBufferAsync(
    count: number,
    size: number,
    source: Uint8Array,
    mode: MeshoptModeType,
    filter?: MeshoptFilterType
  ): Promise<Uint8Array> {
    if (!this.decoder) {
      throw new Error('[MeshoptLoader] Decoder not initialized. Call initialize() first.');
    }
    const startTime = this.verbose ? performance.now() : 0;
    const result = await this.decoder.decodeGltfBufferAsync(count, size, source, mode, filter);
    if (this.verbose) {
      const elapsed = performance.now() - startTime;
      console.log(`[MeshoptLoader] decodeGltfBufferAsync (${mode}): ${count} elements, ${elapsed.toFixed(2)}ms`);
    }
    return result;
  }

  /**
   * Reset the loader (useful for testing)
   */
  public reset(): void {
    this.decoder = null;
    this.initPromise = null;
    if (this.verbose) {
      console.log('[MeshoptLoader] Reset complete');
    }
  }
}

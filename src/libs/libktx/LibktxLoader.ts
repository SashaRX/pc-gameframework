/**
 * LibktxLoader - Singleton for loading libktx module in PlayCanvas
 *
 * Handles loading libktx.mjs and libktx.wasm from PlayCanvas Asset Registry
 * without using dynamic import() which fails in published builds.
 */

import type * as pc from 'playcanvas';
import type { KtxModule } from '../../loaders/ktx2-types';

export class LibktxLoader {
  private static instance: LibktxLoader | null = null;
  private ktxModule: KtxModule | null = null;
  private initPromise: Promise<KtxModule> | null = null;
  private verbose = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): LibktxLoader {
    if (!LibktxLoader.instance) {
      LibktxLoader.instance = new LibktxLoader();
    }
    return LibktxLoader.instance;
  }

  /**
   * Initialize libktx module from external URLs or PlayCanvas Asset Registry
   * @param app PlayCanvas application
   * @param verbose Enable verbose logging
   * @param libktxMjsUrl Optional external URL for libktx.mjs
   * @param libktxWasmUrl Optional external URL for libktx.wasm
   * @returns Initialized KTX module
   */
  public async initialize(
    app: pc.Application,
    verbose = false,
    libktxMjsUrl?: string,
    libktxWasmUrl?: string
  ): Promise<KtxModule> {
    this.verbose = verbose;

    // Return cached module if already initialized
    if (this.ktxModule) {
      if (this.verbose) {
        console.log('[LibktxLoader] Using cached KTX module');
      }
      return this.ktxModule;
    }

    // Return pending promise if initialization is in progress
    if (this.initPromise) {
      if (this.verbose) {
        console.log('[LibktxLoader] Initialization already in progress...');
      }
      return this.initPromise;
    }

    // Start initialization
    this.initPromise = this._initializeInternal(app, libktxMjsUrl, libktxWasmUrl);
    return this.initPromise;
  }

  private async _initializeInternal(
    app: pc.Application,
    libktxMjsUrl?: string,
    libktxWasmUrl?: string
  ): Promise<KtxModule> {
    try {
      if (this.verbose) {
        console.log('[LibktxLoader] Starting initialization...');
      }

      let mjsUrl: string;
      let wasmUrl: string;

      // Step 1: Get URLs - use external URLs if provided, otherwise use Asset Registry
      if (libktxMjsUrl && libktxWasmUrl) {
        // Use external URLs
        if (this.verbose) {
          console.log('[LibktxLoader] Using external URLs');
        }
        mjsUrl = libktxMjsUrl;
        wasmUrl = libktxWasmUrl;
      } else {
        // Find assets in PlayCanvas Asset Registry
        const { mjsAsset, wasmAsset } = this._findAssets(app);

        // Get asset URLs
        const mjsUrlNullable = mjsAsset.getFileUrl();
        const wasmUrlNullable = wasmAsset.getFileUrl();

        if (!mjsUrlNullable || !wasmUrlNullable) {
          throw new Error(
            '[LibktxLoader] Asset URLs not available. Make sure assets are loaded and have valid URLs.'
          );
        }

        mjsUrl = mjsUrlNullable;
        wasmUrl = wasmUrlNullable;
      }

      if (this.verbose) {
        console.log('[LibktxLoader] Asset URLs:');
        console.log('  - libktx.mjs:', mjsUrl);
        console.log('  - libktx.wasm:', wasmUrl);
      }

      // Step 3: Load JS code as text (NOT via import)
      const jsCode = await this._loadJsAsText(mjsUrl);

      // Step 4: Execute JS code to get factory function
      const factory = this._executeJsCode(jsCode, mjsUrl);

      // Step 5: Load WASM binary
      const wasmBinary = await this._loadWasmBinary(wasmUrl);

      // Step 6: Initialize WASM module
      const module = await this._initializeWasmModule(factory, wasmBinary, wasmUrl);

      this.ktxModule = module;

      if (this.verbose) {
        console.log('[LibktxLoader] Initialization complete');
      }

      return module;

    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  /**
   * Find libktx assets in PlayCanvas Asset Registry
   */
  private _findAssets(app: pc.Application): {
    mjsAsset: pc.Asset;
    wasmAsset: pc.Asset;
  } {
    if (this.verbose) {
      console.log('[LibktxLoader] Searching for libktx assets in Asset Registry...');
    }

    // Find libktx.mjs - MUST be uploaded as Binary type (NOT Script)
    // In published builds, Script-type assets get inaccessible /js/esm-scripts/ URLs (403)
    // Binary-type assets get accessible /files/assets/ URLs
    let mjsAsset = app.assets.find('libktx.mjs', 'binary');
    if (!mjsAsset) {
      // Fallback: try script type (works in editor, fails in published builds)
      mjsAsset = app.assets.find('libktx.mjs', 'script');
    }

    // Find libktx.wasm - search for both 'wasm' and 'binary' types
    let wasmAsset = app.assets.find('libktx.wasm', 'wasm');
    if (!wasmAsset) {
      wasmAsset = app.assets.find('libktx.wasm', 'binary');
    }

    // Validate
    if (!mjsAsset || !wasmAsset) {
      const availableAssets = app.assets.list().map(a => ({
        name: a.name,
        type: a.type
      }));

      console.error('[LibktxLoader] Asset search failed:');
      console.error('  - libktx.mjs found:', !!mjsAsset);
      console.error('  - libktx.wasm found:', !!wasmAsset);
      console.error('[LibktxLoader] Available assets:', availableAssets);

      throw new Error(
        `[LibktxLoader] Required assets not found in Asset Registry!\n\n` +
        `Please ensure the following:\n` +
        `1. Upload libktx.mjs to PlayCanvas Assets\n` +
        `   - Import as type: Binary (NOT Script or ESM Module!)\n` +
        `   - Why Binary? Script-type assets get 403 errors in published builds\n` +
        `   - Enable Preload\n` +
        `   - Name must be exactly: libktx.mjs\n\n` +
        `2. Upload libktx.wasm to PlayCanvas Assets\n` +
        `   - Import as type: Binary or WASM\n` +
        `   - Enable Preload\n` +
        `   - Name must be exactly: libktx.wasm\n\n` +
        `Current status:\n` +
        `  - libktx.mjs: ${mjsAsset ? ' Found' : ' Not found'}\n` +
        `  - libktx.wasm: ${wasmAsset ? ' Found' : ' Not found'}`
      );
    }

    if (this.verbose) {
      console.log('[LibktxLoader] Assets found:');
      console.log('  - libktx.mjs:', mjsAsset.name, `(type: ${mjsAsset.type})`);
      console.log('  - libktx.wasm:', wasmAsset.name, `(type: ${wasmAsset.type})`);
    }

    // Warn if libktx.mjs is uploaded as script type (will fail in published builds)
    if (mjsAsset.type === 'script') {
      console.warn(
        '[LibktxLoader] WARNING: libktx.mjs is uploaded as Script type.\n' +
        'This will cause 403 errors in published builds!\n' +
        'Please re-upload libktx.mjs as Binary type for production use.'
      );
    }

    return { mjsAsset, wasmAsset };
  }

  /**
   * Load JavaScript code as text via fetch
   */
  private async _loadJsAsText(url: string): Promise<string> {
    if (this.verbose) {
      console.log('[LibktxLoader] Fetching JS code from:', url);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `[LibktxLoader] Failed to fetch libktx.mjs: ${response.status} ${response.statusText}`
      );
    }

    const code = await response.text();

    if (this.verbose) {
      console.log('[LibktxLoader] JS code loaded:', code.length, 'bytes');
    }

    return code;
  }

  /**
   * Execute JS code and extract the createKtxModule factory function
   * libktx.mjs is NOT an ES module with export default
   * It defines async function createKtxModule() {...} and var LIBKTX
   */
  private _executeJsCode(code: string, moduleUrl: string): (config?: any) => Promise<KtxModule> {
    if (this.verbose) {
      console.log('[LibktxLoader] Executing libktx.mjs code...');
    }

    try {
      // Step 1: Replace import.meta.url with actual URL
      let modifiedCode = code.replace(/import\.meta\.url/g, `"${moduleUrl}"`);

      // Step 2: Replace import.meta (without .url) if it exists
      modifiedCode = modifiedCode.replace(/import\.meta/g, `{url: "${moduleUrl}"}`);

      // Step 3: Remove any export statements (can cause SyntaxError in eval)
      // Remove "export default", "export {", "export const", etc.
      modifiedCode = modifiedCode.replace(/\bexport\s+default\s+/g, '');
      modifiedCode = modifiedCode.replace(/\bexport\s+\{[^}]*\}/g, '');
      modifiedCode = modifiedCode.replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ');

      if (this.verbose) {
        console.log('[LibktxLoader] Code modified: removed import.meta and export statements');
      }

      // Step 4: Execute the code - it will define createKtxModule and LIBKTX in global/local scope
      // Wrap in a function to create a local scope and return the factory
      const wrappedCode = `
        (function() {
          ${modifiedCode}
          // Return the factory function (createKtxModule or LIBKTX)
          return typeof LIBKTX !== 'undefined' ? LIBKTX : (typeof createKtxModule !== 'undefined' ? createKtxModule : null);
        })();
      `;

      // Step 5: Execute and get the factory function
      const factory = (0, eval)(wrappedCode);

      if (!factory || typeof factory !== 'function') {
        if (this.verbose) {
          console.error('[LibktxLoader] Factory type:', typeof factory);
          console.error('[LibktxLoader] Factory value:', factory);
        }
        throw new Error('[LibktxLoader] Could not extract createKtxModule factory from libktx.mjs');
      }

      if (this.verbose) {
        console.log('[LibktxLoader] Factory function extracted successfully');
      }

      return factory;

    } catch (error) {
      console.error('[LibktxLoader] Failed to execute JS code:', error);
      throw new Error(
        `[LibktxLoader] Failed to execute libktx.mjs code. Error: ${error}`
      );
    }
  }

  /**
   * Load WASM binary via fetch
   */
  private async _loadWasmBinary(url: string): Promise<ArrayBuffer> {
    if (this.verbose) {
      console.log('[LibktxLoader] Fetching WASM binary from:', url);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `[LibktxLoader] Failed to fetch libktx.wasm: ${response.status} ${response.statusText}`
      );
    }

    const binary = await response.arrayBuffer();

    if (this.verbose) {
      console.log('[LibktxLoader] WASM binary loaded:', binary.byteLength, 'bytes');
    }

    return binary;
  }

  /**
   * Initialize WASM module with factory and binary
   */
  private async _initializeWasmModule(
    factory: (config?: any) => Promise<KtxModule>,
    wasmBinary: ArrayBuffer,
    wasmUrl: string
  ): Promise<KtxModule> {
    if (this.verbose) {
      console.log('[LibktxLoader] Initializing WASM module...');
    }

    try {
      // Initialize the module with WASM binary
      const module = await factory({
        wasmBinary: wasmBinary,
        locateFile: (path: string) => {
          // Return the WASM URL if requested
          if (path.endsWith('.wasm')) {
            return wasmUrl;
          }
          return path;
        }
      });

      if (this.verbose) {
        console.log('[LibktxLoader] WASM module initialized successfully');
      }

      return module;

    } catch (error) {
      console.error('[LibktxLoader] WASM initialization failed:', error);
      throw new Error(
        `[LibktxLoader] Failed to initialize WASM module. ` +
        `Make sure libktx.wasm is valid and compatible with libktx.mjs.`
      );
    }
  }

  /**
   * Get the initialized module (returns null if not initialized)
   */
  public getModule(): KtxModule | null {
    return this.ktxModule;
  }

  /**
   * Check if module is initialized
   */
  public isInitialized(): boolean {
    return this.ktxModule !== null;
  }

  /**
   * Reset the loader (useful for testing)
   */
  public reset(): void {
    this.ktxModule = null;
    this.initPromise = null;
    if (this.verbose) {
      console.log('[LibktxLoader] Reset complete');
    }
  }
}

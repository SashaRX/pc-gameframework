/**
 * KTX2 Progressive Loader Script (ESM Version)
 *
 * Usage:
 * 1. Upload this script to PlayCanvas Editor
 * 2. Add Script Component to an Entity with a model
 * 3. Add this script from the Script dropdown
 * 4. Configure ktxUrl in Inspector
 */

import { Script } from 'playcanvas';

export class Ktx2LoaderScriptESM extends Script {
  /**
   * @attribute
   * @type {string}
   * @title KTX2 URL
   * @description URL to the KTX2 file to load
   */
  ktxUrl = '';

  /**
   * @attribute
   * @type {boolean}
   * @title Progressive Loading
   * @description Load mipmaps sequentially from low to high resolution
   */
  progressive = true;

  /**
   * @attribute
   * @type {boolean}
   * @title sRGB Color Space
   * @description Treat texture as sRGB (enable for albedo/diffuse maps)
   */
  isSrgb = false;

  /**
   * @attribute
   * @type {boolean}
   * @title Verbose Logging
   * @description Enable detailed console logging
   */
  verbose = true;

  /**
   * @attribute
   * @type {boolean}
   * @title Enable Cache
   * @description Cache transcoded mipmaps in IndexedDB
   */
  enableCache = true;

  /**
   * @attribute
   * @type {boolean}
   * @title Use Web Worker
   * @description Offload transcoding to background thread (TODO)
   */
  useWorker = false;

  /**
   * @attribute
   * @type {boolean}
   * @title Adaptive Loading
   * @description Stop loading at screen resolution
   */
  adaptiveLoading = false;

  /**
   * @attribute
   * @type {number}
   * @title Step Delay (ms)
   * @description Delay between loading steps in milliseconds
   * @range [0, 1000]
   */
  stepDelayMs = 150;

  /** @type {import('../ktx2-loader/Ktx2ProgressiveLoader').Ktx2ProgressiveLoader | null} */
  loader = null;

  /** @type {import('playcanvas').Texture | null} */
  texture = null;

  async initialize() {
    if (this.verbose) {
      console.log('[Ktx2LoaderScriptESM] Initializing...');
    }

    // Dynamic import of the loader (will be bundled separately)
    const { Ktx2ProgressiveLoader } = await import('../ktx2-loader/Ktx2ProgressiveLoader.js');

    // Create loader instance
    this.loader = new Ktx2ProgressiveLoader(this.app, {
      ktxUrl: this.ktxUrl,
      progressive: this.progressive,
      isSrgb: this.isSrgb,
      verbose: this.verbose,
      enableCache: this.enableCache,
      useWorker: this.useWorker,
      adaptiveLoading: this.adaptiveLoading,
      stepDelayMs: this.stepDelayMs,
    });

    try {
      // Find libktx assets
      const libktxMjsAsset = this.app.assets.find('libktx.mjs', 'script');
      const libktxWasmAsset = this.app.assets.find('libktx.wasm', 'binary');

      if (!libktxMjsAsset || !libktxWasmAsset) {
        throw new Error(
          'libktx assets not found! Please upload libktx.mjs and libktx.wasm to PlayCanvas Assets.'
        );
      }

      const libktxMjsUrl = libktxMjsAsset.getFileUrl();
      const libktxWasmUrl = libktxWasmAsset.getFileUrl();

      // Initialize loader
      await this.loader.initialize(libktxMjsUrl, libktxWasmUrl);

      if (this.verbose) {
        console.log('[Ktx2LoaderScriptESM] Loader initialized');
      }

      // Load texture progressively
      this.texture = await this.loader.loadToEntity(this.entity, {
        onProgress: (level, total, info) => {
          if (this.verbose) {
            console.log(
              `[Ktx2LoaderScriptESM] Progress: ${level}/${total} ` +
              `(${info.width}x${info.height}, ${info.cached ? 'cached' : 'network'})`
            );
          }

          // Fire event for UI updates
          this.app.fire('ktx2:progress', {
            level,
            total,
            percent: (level / total) * 100,
            info,
          });
        },

        onComplete: (stats) => {
          if (this.verbose) {
            console.log('[Ktx2LoaderScriptESM] Loading complete!', stats);
          }

          this.app.fire('ktx2:complete', stats);
        },
      });

      if (this.verbose) {
        console.log('[Ktx2LoaderScriptESM] Texture loaded successfully');
      }
    } catch (error) {
      console.error('[Ktx2LoaderScriptESM] Error:', error);
      this.app.fire('ktx2:error', error);
    }
  }

  update(dt) {
    // Optional: Add runtime logic here
  }

  onDestroy() {
    // Cleanup resources
    if (this.loader) {
      this.loader.dispose();
      this.loader = null;
    }

    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }

    if (this.verbose) {
      console.log('[Ktx2LoaderScriptESM] Destroyed');
    }
  }
}

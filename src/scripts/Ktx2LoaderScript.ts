/**
 * PlayCanvas Script для KTX2 Progressive Loader
 * Использует официальный TypeScript template
 * 
 * @example
 * // Добавь этот скрипт к Entity в PlayCanvas Editor
 * // Укажи ktxUrl в инспекторе
 */

import * as pc from 'playcanvas';
import {
  Ktx2ProgressiveLoader,
  DEFAULT_LIBKTX_MODULE_URL,
  DEFAULT_LIBKTX_WASM_URL,
} from '../ktx2-loader/Ktx2ProgressiveLoader';

interface Ktx2LoaderScriptAttributes {
  ktxUrl: string;
  progressive: boolean;
  isSrgb: boolean;
  verbose: boolean;
  enableCache: boolean;
  useWorker: boolean;
  adaptiveLoading: boolean;
  stepDelayMs: number;
}

class Ktx2LoaderScript extends pc.ScriptType {
  private loader: Ktx2ProgressiveLoader | null = null;
  private texture: pc.Texture | null = null;

  // Атрибуты (отображаются в Inspector)
  ktxUrl!: string;
  progressive!: boolean;
  isSrgb!: boolean;
  verbose!: boolean;
  enableCache!: boolean;
  useWorker!: boolean;
  adaptiveLoading!: boolean;
  stepDelayMs!: number;

  async initialize() {
    if (this.verbose) {
      console.log('[KTX2] Script initializing...');
    }

    const createLoader = () =>
      new Ktx2ProgressiveLoader(this.app as any, {
        ktxUrl: this.ktxUrl,
        progressive: this.progressive,
        isSrgb: this.isSrgb,
        verbose: this.verbose,
        enableCache: this.enableCache,
        useWorker: this.useWorker,
        adaptiveLoading: this.adaptiveLoading,
        stepDelayMs: this.stepDelayMs,
      });

    const initializeLoader = async (moduleUrl?: string, wasmUrl?: string) => {
      if (this.loader) {
        this.loader.dispose();
      }

      const loaderInstance = createLoader();
      this.loader = loaderInstance;

      try {
        await loaderInstance.initialize(moduleUrl, wasmUrl);
      } catch (error) {
        this.loader = null;
        throw error;
      }
    };

    try {
      if (this.verbose) {
        console.log('[KTX2] Searching for libktx assets...');
      }

      const libktxMjsAsset = this.app.assets.find('libktx.mjs', 'script');
      let libktxWasmAsset = this.app.assets.find('libktx.wasm', 'wasm');

      if (!libktxWasmAsset) {
        libktxWasmAsset = this.app.assets.find('libktx.wasm', 'binary');
      }

      const hasPlaycanvasAssets = !!libktxMjsAsset && !!libktxWasmAsset;
      let initialized = false;
      let primaryError: unknown = null;

      if (hasPlaycanvasAssets) {
        const libktxMjsUrl = libktxMjsAsset!.getFileUrl() || undefined;
        const libktxWasmUrl = libktxWasmAsset!.getFileUrl() || undefined;

        if (this.verbose) {
          console.log('[KTX2] Asset URLs:');
          console.log('  - libktx.mjs:', libktxMjsUrl);
          console.log('  - libktx.wasm:', libktxWasmUrl);
          console.log('[KTX2] Initializing loader using PlayCanvas assets...');
        }

        try {
          await initializeLoader(libktxMjsUrl, libktxWasmUrl);
          initialized = true;
        } catch (error) {
          primaryError = error;

          if (this.verbose) {
            console.warn(
              '[KTX2] Не удалось загрузить libktx из ассетов PlayCanvas, переключаемся на резервный источник...',
              error
            );
          }
        }
      } else if (this.verbose) {
        console.warn('[KTX2] libktx ассеты не найдены, используем резервные URL.');
      }

      if (!initialized) {
        if (this.verbose) {
          console.log('[KTX2] Используем резервные URL libktx:');
          console.log('  - libktx.mjs:', DEFAULT_LIBKTX_MODULE_URL);
          console.log('  - libktx.wasm:', DEFAULT_LIBKTX_WASM_URL);
        }

        try {
          await initializeLoader(DEFAULT_LIBKTX_MODULE_URL, DEFAULT_LIBKTX_WASM_URL);
          initialized = true;
        } catch (fallbackError) {
          if (primaryError && this.verbose) {
            console.error('[KTX2] Ошибка первичной инициализации libktx:', primaryError);
          }

          throw fallbackError;
        }
      }

      if (this.verbose) {
        console.log('[KTX2] Loader initialized successfully');
      }

      this.texture = await this.loader!.loadToEntity(this.entity, {
        onProgress: (level, total, info) => {
          if (this.verbose) {
            console.log(`[Ktx2LoaderScript] Progress: ${level}/${total}`, info);
          }

          this.app.fire('ktx2:progress', {
            level,
            total,
            percent: (level / total) * 100,
            info,
          });
        },

        onComplete: (stats) => {
          if (this.verbose) {
            console.log('[Ktx2LoaderScript] Complete!', stats);
          }

          this.app.fire('ktx2:complete', stats);
        },
      });

      if (this.verbose) {
        console.log('[Ktx2LoaderScript] Texture loaded successfully');
      }
    } catch (error) {
      console.error('[Ktx2LoaderScript] Error:', error);
      this.app.fire('ktx2:error', error);
    }
  }
  update(dt: number) {
    // Можно добавить runtime logic здесь
  }

  onDestroy() {
    // Очистка ресурсов
    if (this.loader) {
      this.loader.dispose();
      this.loader = null;
    }

    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }

    if (this.verbose) {
      console.log('[Ktx2LoaderScript] Destroyed');
    }
  }
}

// Регистрация атрибутов
pc.registerScript(Ktx2LoaderScript, 'ktx2Loader');

Ktx2LoaderScript.attributes.add('ktxUrl', {
  type: 'string',
  default: '',
  title: 'KTX2 URL',
  description: 'URL to the KTX2 file',
});

Ktx2LoaderScript.attributes.add('progressive', {
  type: 'boolean',
  default: true,
  title: 'Progressive Loading',
  description: 'Load mipmaps sequentially',
});

Ktx2LoaderScript.attributes.add('isSrgb', {
  type: 'boolean',
  default: false,
  title: 'sRGB',
  description: 'Treat texture as sRGB (for albedo/diffuse)',
});

Ktx2LoaderScript.attributes.add('verbose', {
  type: 'boolean',
  default: true,
  title: 'Verbose Logging',
});

Ktx2LoaderScript.attributes.add('enableCache', {
  type: 'boolean',
  default: true,
  title: 'Enable Cache',
  description: 'Use IndexedDB cache for loaded mipmaps',
});

Ktx2LoaderScript.attributes.add('useWorker', {
  type: 'boolean',
  default: true,
  title: 'Use Web Worker',
  description: 'Offload transcoding to background thread',
});

Ktx2LoaderScript.attributes.add('adaptiveLoading', {
  type: 'boolean',
  default: false,
  title: 'Adaptive Loading',
  description: 'Stop at screen resolution',
});

Ktx2LoaderScript.attributes.add('stepDelayMs', {
  type: 'number',
  default: 150,
  title: 'Step Delay (ms)',
  description: 'Delay between loading steps',
});

export { Ktx2LoaderScript };
export default Ktx2LoaderScript;
/**
 * PlayCanvas ESM Script for KTX2 Progressive Loader
 */

import type * as pc from 'playcanvas';
import * as pcRuntime from 'playcanvas';
import { Ktx2ProgressiveLoader } from '../ktx2-loader/Ktx2ProgressiveLoader';

// Script class exists at runtime but not exported in types
const Script = (pcRuntime as any).Script;

export class Ktx2LoaderScript extends Script {
  static scriptName = 'ktx2Loader';

  declare app: pc.Application;
  declare entity: pc.Entity;

  /**
   * @attribute
   */
  ktxUrl = '';

  /**
   * @attribute
   */
  libktxMjsUrl = '';

  /**
   * @attribute
   */
  libktxWasmUrl = '';

  /**
   * @attribute
   */
  progressive = true;

  /**
   * @attribute
   */
  isSrgb = false;

  /**
   * @attribute
   * @deprecated Use logLevel instead
   */
  verbose = true;

  /**
   * @attribute
   * @range [0, 3]
   * @description Log verbosity: 0=silent, 1=errors, 2=important, 3=detailed
   */
  logLevel = 2;

  /**
   * @attribute
   */
  enableCache = true;

  /**
   * @attribute
   */
  useWorker = false;

  /**
   * @attribute
   */
  adaptiveLoading = false;

  /**
   * @attribute
   * @range [0, 1000]
   */
  stepDelayMs = 150;

  /**
   * @attribute
   */
  adaptiveThrottling = false;

  /**
   * @attribute
   * @range [30, 120]
   */
  targetFps = 60;

  /**
   * @attribute
   * @range [0, 1000]
   */
  minStepDelayMs = 0;

  /**
   * @attribute
   * @range [0, 2000]
   */
  maxStepDelayMs = 500;

  private loader: Ktx2ProgressiveLoader | null = null;
  private texture: any = null;

  async initialize() {
    console.log('[KTX2] Script initializing...');

    try {
      // Создаём loader с внешними URL для libktx файлов
      this.loader = new Ktx2ProgressiveLoader(this.app as any, {
        ktxUrl: this.ktxUrl,
        libktxModuleUrl: this.libktxMjsUrl || undefined,
        libktxWasmUrl: this.libktxWasmUrl || undefined,
        progressive: this.progressive,
        isSrgb: this.isSrgb,
        verbose: this.verbose,
        logLevel: this.logLevel,
        enableCache: this.enableCache,
        useWorker: this.useWorker,
        adaptiveLoading: this.adaptiveLoading,
        stepDelayMs: this.stepDelayMs,
        adaptiveThrottling: this.adaptiveThrottling,
        targetFps: this.targetFps,
        minStepDelayMs: this.minStepDelayMs,
        maxStepDelayMs: this.maxStepDelayMs,
      });

      // Initialize loader
      await this.loader.initialize();

      // Загрузка текстуры
      this.texture = await this.loader.loadToEntity(this.entity, {
        onProgress: (level: number, total: number, info: any) => {
          // Fire event for UI
          this.app.fire('ktx2:progress', {
            level,
            total,
            percent: (level / total) * 100,
            info,
          });
        },

        onComplete: (stats: any) => {
          console.log('[KTX2] Loading complete:', {
            time: `${(stats.totalTime! / 1000).toFixed(2)}s`,
            levels: stats.levelsLoaded,
            cached: stats.levelsCached,
          });
          this.app.fire('ktx2:complete', stats);
        },
      });

    } catch (error) {
      console.error('[KTX2] Error:', error);
      this.app.fire('ktx2:error', error);
    }
  }

  update(dt: number) {
    // Можно добавить runtime logic здесь
  }

  onDestroy() {
    // Очистка ресурсов
    if (this.loader) {
      this.loader.destroy();
      this.loader = null;
    }

    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }
  }
}

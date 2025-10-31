/**
 * PlayCanvas Script для KTX2 Progressive Loader
 * Использует официальный TypeScript template
 * 
 * @example
 * // Добавь этот скрипт к Entity в PlayCanvas Editor
 * // Укажи ktxUrl в инспекторе
 */

import * as pc from 'playcanvas';
import { Ktx2ProgressiveLoader } from '../ktx2-loader/Ktx2ProgressiveLoader';

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
		console.log('[Ktx2LoaderScript] Initializing...');
	  }

	  // Создаём loader
	  this.loader = new Ktx2ProgressiveLoader(this.app as any, {
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
		// Инициализация (загрузка libktx)
		const libktxMjsUrl = this.app.assets.find('libktx.mjs')?.getFileUrl() || undefined;
		const libktxWasmUrl = this.app.assets.find('libktx.wasm')?.getFileUrl() || undefined;
		
		await this.loader.initialize(libktxMjsUrl, libktxWasmUrl);

		if (this.verbose) {
		  console.log('[Ktx2LoaderScript] Loader initialized');
		}

		// Загрузка текстуры
		this.texture = await this.loader.loadToEntity(this.entity, {
		  onProgress: (level, total, info) => {
			if (this.verbose) {
			  console.log(`[Ktx2LoaderScript] Progress: ${level}/${total}`, info);
			}
			
			// Можно отправить event для UI
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
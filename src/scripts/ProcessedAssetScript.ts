/**
 * ProcessedAssetScript - PlayCanvas Script Component for ProcessedAssetManager
 *
 * Attach to a single entity in your scene (e.g., Root or a Manager entity).
 * Initializes the streaming system and auto-processes all templates.
 *
 * Setup in Editor:
 * 1. Create empty entity "AssetManager"
 * 2. Add this script
 * 3. Configure URLs in attributes
 * 4. Models/Materials/Textures load automatically from templates
 */

import type * as pc from 'playcanvas';
import * as pcRuntime from 'playcanvas';
import { ProcessedAssetManager, ProcessedAssetManagerConfig } from '../streaming/ProcessedAssetManager';
import { MappingLoader } from '../streaming/MappingLoader';

const Script = (pcRuntime as any).Script;

export class ProcessedAssetScript extends Script {
  static scriptName = 'processedAssetManager';

  declare app: pc.Application;
  declare entity: pc.Entity;

  // Attributes for Editor
  /**
   * @attribute
   * @description URL to mapping.json on B2/CDN
   */
  mappingUrl = '';

  /**
   * @attribute
   * @description URL to libktx.mjs
   */
  libktxModuleUrl = '';

  /**
   * @attribute
   * @description URL to libktx.wasm
   */
  libktxWasmUrl = '';

  /**
   * @attribute
   * @description Prefix for master materials (e.g., "Master_")
   */
  masterMaterialPrefix = 'Master_';

  /**
   * @attribute
   * @range [1, 8]
   * @description Maximum parallel texture loads
   */
  maxConcurrentTextures = 4;

  /**
   * @attribute
   * @description Cache assets in IndexedDB
   */
  useIndexedDB = true;

  /**
   * @attribute
   * @description Enable debug logging
   */
  debug = false;

  /**
   * @attribute
   * @description Auto-process all templates on scene load
   */
  autoProcessTemplates = true;

  private manager: ProcessedAssetManager | null = null;
  private initialized = false;
  private processing = false;

  async initialize() {
    // Validate required URLs
    if (!this.mappingUrl) {
      console.error('[ProcessedAssetScript] ERROR: mappingUrl is REQUIRED');
      return;
    }

    if (!this.libktxModuleUrl || !this.libktxWasmUrl) {
      console.error('[ProcessedAssetScript] ERROR: libktx URLs are REQUIRED');
      return;
    }

    try {
      const config: ProcessedAssetManagerConfig = {
        mappingUrl: this.mappingUrl,
        libktxModuleUrl: this.libktxModuleUrl,
        libktxWasmUrl: this.libktxWasmUrl,
        masterMaterialPrefix: this.masterMaterialPrefix,
        maxConcurrentTextures: this.maxConcurrentTextures,
        useIndexedDB: this.useIndexedDB,
        debug: this.debug,
      };

      this.manager = new ProcessedAssetManager(this.app, config);
      await this.manager.initialize();

      this.initialized = true;

      // Make globally accessible
      (this.app as any).processedAssetManager = this.manager;

      // Fire ready event
      this.app.fire('processedAssets:ready', this.manager);

      if (this.debug) {
        console.log('[ProcessedAssetScript] Initialized');
        this.printStats();
      }

      // Auto-process templates if enabled
      if (this.autoProcessTemplates) {
        this.processAllTemplates();
      }

    } catch (error) {
      console.error('[ProcessedAssetScript] Init error:', error);
      this.app.fire('processedAssets:error', error);
    }
  }

  /**
   * Process all instantiated templates in scene
   */
  async processAllTemplates(): Promise<void> {
    if (!this.manager || this.processing) return;

    this.processing = true;

    try {
      // Find all entities with render components
      const entities = this.findRenderEntities(this.app.root);

      if (this.debug) {
        console.log(`[ProcessedAssetScript] Found ${entities.length} render entities`);
      }

      // Process each
      for (const entity of entities) {
        await this.processEntity(entity);
      }

      this.app.fire('processedAssets:complete');

      if (this.debug) {
        console.log('[ProcessedAssetScript] All templates processed');
        this.printStats();
      }

    } catch (error) {
      console.error('[ProcessedAssetScript] Process error:', error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Find all entities with render components
   */
  private findRenderEntities(root: pc.Entity): pc.Entity[] {
    const result: pc.Entity[] = [];

    const scan = (entity: pc.Entity) => {
      if (entity.render && (entity.render as any).asset) {
        result.push(entity);
      }
      for (const child of entity.children as pc.Entity[]) {
        scan(child);
      }
    };

    scan(root);
    return result;
  }

  /**
   * Process single entity
   */
  private async processEntity(entity: pc.Entity): Promise<void> {
    const render = entity.render;
    if (!render) return;

    const modelAssetId = (render as any).asset;
    if (!modelAssetId) return;

    const mapping = MappingLoader.getInstance();

    // Check if in mapping
    if (!mapping.hasModel(String(modelAssetId))) {
      if (this.debug) {
        console.log(`[ProcessedAssetScript] Model ${modelAssetId} not in mapping, skipping`);
      }
      return;
    }

    // Process via manager
    if (this.manager) {
      // Create a fake template root for single entity processing
      const tempRoot = new pcRuntime.Entity('temp');
      tempRoot.addChild(entity.clone());
      await this.manager.processTemplate(tempRoot);
      tempRoot.destroy();
    }
  }

  /**
   * Process a specific template instance
   */
  async processTemplate(templateInstance: pc.Entity): Promise<void> {
    if (!this.manager) {
      console.warn('[ProcessedAssetScript] Not initialized');
      return;
    }

    await this.manager.processTemplate(templateInstance);
  }

  /**
   * Print statistics
   */
  printStats(): void {
    if (!this.manager) return;

    const stats = this.manager.getStats();
    console.log('[ProcessedAssetScript] Stats:', stats);
  }

  /**
   * Get manager instance
   */
  getManager(): ProcessedAssetManager | null {
    return this.manager;
  }

  /**
   * Get mapping instance
   */
  getMapping(): MappingLoader {
    return MappingLoader.getInstance();
  }

  /**
   * Check if ready
   */
  isReady(): boolean {
    return this.initialized;
  }

  onDestroy() {
    if (this.manager) {
      this.manager.destroy();
      this.manager = null;
    }
    delete (this.app as any).processedAssetManager;
  }
}

export default ProcessedAssetScript;

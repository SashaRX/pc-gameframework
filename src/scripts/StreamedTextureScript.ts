/**
 * StreamedTexture Script - Register single texture with streaming manager
 *
 * Usage:
 * 1. Add this script to any entity with render component
 * 2. Set ktxUrl to your KTX2 file
 * 3. Configure category and quality
 * 4. Texture loads automatically based on priority
 */

import type * as pc from 'playcanvas';
import * as pcRuntime from 'playcanvas';

const Script = (pcRuntime as any).Script;

export class StreamedTextureScript extends Script {
  static scriptName = 'streamedTexture';

  declare app: pc.Application;
  declare entity: pc.Entity;

  /**
   * @attribute
   * @description KTX2 texture URL
   */
  ktxUrl = '';

  /**
   * @attribute
   * @description Unique ID (auto-generated from entity name if empty)
   */
  textureId = '';

  /**
   * @attribute
   * @description Category: persistent (always loaded), level (loaded with level), dynamic (distance-based)
   */
  category: 'persistent' | 'level' | 'dynamic' = 'dynamic';

  /**
   * @attribute
   * @range [0, 10]
   * @description Target LOD (0=full quality, 10=lowest quality)
   */
  targetLod = 5;

  /**
   * @attribute
   * @range [0, 2]
   * @description User priority (0=low, 1=normal, 2=high)
   */
  userPriority = 1.0;

  /**
   * @attribute
   * @description Load immediately on initialize (overrides category setting)
   */
  loadImmediately = false;

  private textureHandle: any = null;

  initialize() {
    // Get streaming manager
    const streaming = (this.app as any).streamingManager;

    if (!streaming) {
      console.error('[StreamedTexture] StreamingManager not found! Add StreamingManagerScript to scene first.');
      return;
    }

    if (!this.ktxUrl) {
      console.error('[StreamedTexture] ktxUrl is empty!');
      return;
    }

    // Generate ID if not provided
    const id = this.textureId || `${this.entity.name}-${this.entity.getGuid()}`;

    console.log(`[StreamedTexture] Registering "${id}" (${this.category})`);

    try {
      // Register with streaming manager
      this.textureHandle = streaming.register({
        id: id,
        url: this.ktxUrl,
        category: this.category,
        entity: this.entity,
        targetLod: this.targetLod,
        userPriority: this.userPriority,
      });

      // Force load immediately if requested
      if (this.loadImmediately) {
        streaming.requestLoad(id, 1000); // High priority
      }

      console.log(`[StreamedTexture] Registered "${id}" successfully`);
    } catch (error) {
      console.error('[StreamedTexture] Registration failed:', error);
    }
  }

  /**
   * Manually trigger load
   */
  load() {
    const streaming = (this.app as any).streamingManager;
    if (streaming && this.textureHandle) {
      const id = this.textureId || `${this.entity.name}-${this.entity.getGuid()}`;
      streaming.requestLoad(id, 1000);
    }
  }

  /**
   * Manually trigger unload
   */
  unload() {
    const streaming = (this.app as any).streamingManager;
    if (streaming && this.textureHandle) {
      const id = this.textureId || `${this.entity.name}-${this.entity.getGuid()}`;
      streaming.requestUnload(id);
    }
  }

  /**
   * Change priority at runtime
   */
  setPriority(priority: number) {
    const streaming = (this.app as any).streamingManager;
    if (streaming && this.textureHandle) {
      const id = this.textureId || `${this.entity.name}-${this.entity.getGuid()}`;
      streaming.setUserPriority(id, priority);
    }
  }

  onDestroy() {
    // Unregister from streaming manager
    const streaming = (this.app as any).streamingManager;
    if (streaming && this.textureHandle) {
      const id = this.textureId || `${this.entity.name}-${this.entity.getGuid()}`;
      streaming.unregister(id);
      console.log(`[StreamedTexture] Unregistered "${id}"`);
    }
  }
}

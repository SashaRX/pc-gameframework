/**
 * OrmTextureHandler - Handle ORM (Occlusion/Roughness/Metalness) packed textures
 *
 * PlayCanvas StandardMaterial expects separate textures for AO, gloss, metalness.
 * When these are packed into one texture (ORM), we need to:
 * 1. Set the packed texture to appropriate slots
 * 2. Configure material to read correct channels
 *
 * Standard ORM packing:
 * - R: Ambient Occlusion
 * - G: Roughness (need to invert for glossiness)
 * - B: Metalness
 *
 * But processor can use custom packing, so we read from JSON.
 */

import type * as pc from 'playcanvas';
import { PackedTextureRef } from './MappingTypes';

type Channel = 'r' | 'g' | 'b' | 'a';

export class OrmTextureHandler {
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[OrmTextureHandler]', ...args);
    }
  }

  /**
   * Apply ORM packed texture to material
   *
   * @param material Target material
   * @param texture The packed ORM texture
   * @param ref Packed texture reference with channel mappings
   */
  applyOrmTexture(
    material: pc.StandardMaterial,
    texture: pc.Texture,
    ref: PackedTextureRef
  ): void {
    this.log('Applying ORM texture:', {
      ao: ref.ao || ref.occlusion,
      roughness: ref.roughness,
      metalness: ref.metalness,
      gloss: ref.gloss,
    });

    // AO (Ambient Occlusion)
    const aoChannel = ref.ao || ref.occlusion;
    if (aoChannel) {
      material.aoMap = texture;
      material.aoMapChannel = aoChannel;
      this.log(`Set aoMap, channel: ${aoChannel}`);
    }

    // Metalness
    if (ref.metalness) {
      material.metalnessMap = texture;
      material.metalnessMapChannel = ref.metalness;
      material.useMetalness = true;
      this.log(`Set metalnessMap, channel: ${ref.metalness}`);
    }

    // Roughness or Gloss
    if (ref.roughness) {
      // PlayCanvas uses glossiness (inverted roughness)
      material.glossMap = texture;
      material.glossMapChannel = ref.roughness;
      // Enable gloss invert since source is roughness
      material.glossInvert = true;
      this.log(`Set glossMap from roughness, channel: ${ref.roughness}, inverted`);
    } else if (ref.gloss) {
      material.glossMap = texture;
      material.glossMapChannel = ref.gloss;
      material.glossInvert = false;
      this.log(`Set glossMap, channel: ${ref.gloss}`);
    }

    // Height (if packed)
    if (ref.height) {
      material.heightMap = texture;
      material.heightMapChannel = ref.height;
      this.log(`Set heightMap, channel: ${ref.height}`);
    }

    material.update();
  }

  /**
   * Check if texture reference is ORM packed
   */
  isOrmTexture(ref: PackedTextureRef): boolean {
    return !!(ref.ao || ref.occlusion || ref.roughness || ref.metalness);
  }

  /**
   * Get all channels used in packed texture
   */
  getUsedChannels(ref: PackedTextureRef): Channel[] {
    const channels: Channel[] = [];

    if (ref.ao) channels.push(ref.ao);
    if (ref.occlusion) channels.push(ref.occlusion);
    if (ref.roughness) channels.push(ref.roughness);
    if (ref.metalness) channels.push(ref.metalness);
    if (ref.gloss) channels.push(ref.gloss);
    if (ref.height) channels.push(ref.height);

    return [...new Set(channels)]; // Remove duplicates
  }

  /**
   * Create shader chunks for custom channel reading
   * Use this if default material properties don't work
   */
  createCustomChunks(ref: PackedTextureRef): Record<string, string> {
    const chunks: Record<string, string> = {};

    // Custom AO chunk
    if (ref.ao || ref.occlusion) {
      const channel = ref.ao || ref.occlusion;
      chunks['aoPS'] = `
        uniform sampler2D texture_aoMap;
        void getAO() {
          dAo = texture2D(texture_aoMap, $UV).${ channel };
        }
      `;
    }

    // Custom metalness chunk
    if (ref.metalness) {
      chunks['metalnessPS'] = `
        uniform sampler2D texture_metalnessMap;
        void getMetalness() {
          dMetalness = texture2D(texture_metalnessMap, $UV).${ref.metalness};
        }
      `;
    }

    // Custom glossiness from roughness
    if (ref.roughness) {
      chunks['glossPS'] = `
        uniform sampler2D texture_glossMap;
        void getGlossiness() {
          dGlossiness = 1.0 - texture2D(texture_glossMap, $UV).${ref.roughness};
        }
      `;
    } else if (ref.gloss) {
      chunks['glossPS'] = `
        uniform sampler2D texture_glossMap;
        void getGlossiness() {
          dGlossiness = texture2D(texture_glossMap, $UV).${ref.gloss};
        }
      `;
    }

    return chunks;
  }

  /**
   * Apply custom chunks to material
   */
  applyCustomChunks(material: pc.StandardMaterial, chunks: Record<string, string>): void {
    for (const [name, code] of Object.entries(chunks)) {
      (material as any).chunks[name] = code;
    }
    material.update();
  }
}

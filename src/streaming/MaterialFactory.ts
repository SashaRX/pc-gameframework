/**
 * Material factory for instancing and caching materials
 * Implements master material pattern with property overrides
 */

import type * as pc from 'playcanvas';
import type { MaterialDefinition } from './types';

export class MaterialFactory {
  private app: pc.Application;
  private masterMaterials: Map<string, pc.Material> = new Map();
  private instanceCache: Map<string, pc.Material> = new Map();
  private verbose: boolean;

  constructor(app: pc.Application, verbose: boolean = false) {
    this.app = app;
    this.verbose = verbose;
  }

  /**
   * Register a master material that can be instanced
   */
  registerMaster(id: string, material: pc.Material): void {
    if (this.masterMaterials.has(id)) {
      if (this.verbose) {
        console.warn(`[MaterialFactory] Master material "${id}" already registered, replacing`);
      }
    }

    this.masterMaterials.set(id, material);

    if (this.verbose) {
      console.log(`[MaterialFactory] Registered master material: ${id}`);
    }
  }

  /**
   * Create a material instance with overrides
   * Uses caching to avoid duplicate instances
   */
  createInstance(masterId: string, overrides: Record<string, any> = {}): pc.Material | null {
    const master = this.masterMaterials.get(masterId);
    if (!master) {
      console.error(`[MaterialFactory] Master material "${masterId}" not found`);
      return null;
    }

    // Generate cache key from master ID and overrides
    const cacheKey = this.getCacheKey(masterId, overrides);

    // Return cached instance if exists
    if (this.instanceCache.has(cacheKey)) {
      if (this.verbose) {
        console.log(`[MaterialFactory] Using cached material instance: ${cacheKey}`);
      }
      return this.instanceCache.get(cacheKey)!;
    }

    // Create new instance
    const instance = master.clone();

    // Apply overrides
    this.applyOverrides(instance, overrides);

    // Cache the instance
    this.instanceCache.set(cacheKey, instance);

    if (this.verbose) {
      console.log(`[MaterialFactory] Created material instance: ${cacheKey}`);
    }

    return instance;
  }

  /**
   * Create material from definition
   */
  createFromDefinition(definition: MaterialDefinition): pc.Material | null {
    return this.createInstance(definition.masterId, definition.overrides);
  }

  /**
   * Apply property overrides to a material
   */
  private applyOverrides(material: pc.Material, overrides: Record<string, any>): void {
    const mat = material as any;

    for (const [key, value] of Object.entries(overrides)) {
      try {
        // Handle different property types
        if (key === 'diffuse' || key === 'emissive' || key === 'ambient') {
          // Color properties
          if (Array.isArray(value) && value.length >= 3) {
            mat[key] = new (this.app.graphicsDevice as any).Color(value[0], value[1], value[2]);
          }
        } else if (key.endsWith('Map')) {
          // Texture properties - will be set later by texture streaming
          // Skip for now, textures are handled separately
          continue;
        } else if (typeof value === 'number') {
          // Numeric properties
          mat[key] = value;
        } else if (typeof value === 'boolean') {
          // Boolean properties
          mat[key] = value;
        } else {
          // Try direct assignment
          mat[key] = value;
        }
      } catch (err) {
        console.warn(`[MaterialFactory] Failed to set property "${key}":`, err);
      }
    }

    // Update material
    material.update();
  }

  /**
   * Generate cache key from master ID and overrides
   */
  private getCacheKey(masterId: string, overrides: Record<string, any>): string {
    // Create deterministic string from overrides
    const overrideKeys = Object.keys(overrides).sort();
    const overrideString = overrideKeys
      .map((key) => {
        const value = overrides[key];
        if (Array.isArray(value)) {
          return `${key}:[${value.join(',')}]`;
        }
        return `${key}:${value}`;
      })
      .join('|');

    return `${masterId}#${overrideString}`;
  }

  /**
   * Clear instance cache
   */
  clearCache(): void {
    this.instanceCache.clear();
    if (this.verbose) {
      console.log('[MaterialFactory] Cleared instance cache');
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { masters: number; instances: number } {
    return {
      masters: this.masterMaterials.size,
      instances: this.instanceCache.size,
    };
  }

  /**
   * Remove master material
   */
  removeMaster(id: string): void {
    this.masterMaterials.delete(id);

    // Also remove cached instances that use this master
    const keysToRemove: string[] = [];
    for (const key of this.instanceCache.keys()) {
      if (key.startsWith(`${id}#`)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.instanceCache.delete(key);
    }

    if (this.verbose) {
      console.log(`[MaterialFactory] Removed master "${id}" and ${keysToRemove.length} instances`);
    }
  }

  /**
   * Check if master material exists
   */
  hasMaster(id: string): boolean {
    return this.masterMaterials.has(id);
  }

  /**
   * Get master material
   */
  getMaster(id: string): pc.Material | undefined {
    return this.masterMaterials.get(id);
  }

  /**
   * List all registered master IDs
   */
  listMasters(): string[] {
    return Array.from(this.masterMaterials.keys());
  }
}

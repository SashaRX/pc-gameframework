/**
 * Sector loader - loads and manages individual sectors
 */

import type * as pc from 'playcanvas';
import type {
  SectorManifest,
  LoadedSector,
  StreamingContext,
} from './types';
import { SectorStatus } from './types';
import { AssetSource } from './AssetSource';
import { MaterialFactory } from './MaterialFactory';
import { TextureStreaming } from './TextureStreaming';

export class SectorLoader {
  private app: pc.Application;
  private sectorId: string;
  private assetSource: AssetSource;
  private materialFactory: MaterialFactory;
  private textureStreaming: TextureStreaming;
  private manifest: SectorManifest | null = null;
  private loadedSector: LoadedSector | null = null;
  private verbose: boolean;

  constructor(
    app: pc.Application,
    sectorId: string,
    assetSource: AssetSource,
    materialFactory: MaterialFactory,
    textureStreaming: TextureStreaming,
    verbose: boolean = false
  ) {
    this.app = app;
    this.sectorId = sectorId;
    this.assetSource = assetSource;
    this.materialFactory = materialFactory;
    this.textureStreaming = textureStreaming;
    this.verbose = verbose;
  }

  /**
   * Load sector manifest from URL
   */
  async loadManifest(manifestUrl?: string): Promise<SectorManifest> {
    const url = manifestUrl || `/assets/sectors/${this.sectorId}/manifest.json`;

    if (this.verbose) {
      console.log(`[SectorLoader] Loading manifest: ${url}`);
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const manifest: SectorManifest = await response.json();
      this.manifest = manifest;

      if (this.verbose) {
        console.log(`[SectorLoader] Manifest loaded:`, {
          sectorId: manifest.sectorId,
          meshes: manifest.meshes.length,
          materials: manifest.materials.length,
          textures: manifest.textures.length,
        });
      }

      return manifest;
    } catch (err) {
      console.error(`[SectorLoader] Failed to load manifest ${url}:`, err);
      throw err;
    }
  }

  /**
   * Load sector with specified LOD level
   */
  async load(lodLevel: number = 2, priority: number = 5): Promise<LoadedSector> {
    if (!this.manifest) {
      throw new Error('Manifest not loaded. Call loadManifest() first.');
    }

    if (this.verbose) {
      console.log(`[SectorLoader] Loading sector ${this.sectorId}, LOD: ${lodLevel}`);
    }

    const startTime = performance.now();

    try {
      // 1. Instantiate template
      const entity = this.instantiateTemplate();
      if (!entity) {
        throw new Error(`Failed to instantiate template: ${this.manifest.templateId}`);
      }

      // 2. Load meshes for the specified LOD level
      await this.loadMeshes(entity, lodLevel);

      // 3. Create and apply materials
      await this.applyMaterials(entity);

      // 4. Start progressive texture loading
      await this.startTextureLoading(entity, priority);

      // Calculate memory usage (rough estimate)
      const memoryUsage = this.estimateMemoryUsage(lodLevel);

      // Create loaded sector data
      this.loadedSector = {
        manifest: this.manifest,
        entity,
        currentLod: lodLevel,
        status: SectorStatus.LoadedLow,
        memoryUsage,
        lastAccessed: Date.now(),
        distance: 0,
        priority,
      };

      const loadTime = performance.now() - startTime;

      if (this.verbose) {
        console.log(`[SectorLoader] Sector loaded in ${loadTime.toFixed(2)}ms:`, {
          sectorId: this.sectorId,
          lod: lodLevel,
          memory: `${(memoryUsage / 1024 / 1024).toFixed(2)}MB`,
        });
      }

      return this.loadedSector;
    } catch (err) {
      console.error(`[SectorLoader] Failed to load sector ${this.sectorId}:`, err);
      throw err;
    }
  }

  /**
   * Instantiate the sector template
   */
  private instantiateTemplate(): pc.Entity | null {
    if (!this.manifest) return null;

    const entity = this.assetSource.instantiateTemplate(this.manifest.templateId);
    if (!entity) {
      console.error(`[SectorLoader] Failed to instantiate template: ${this.manifest.templateId}`);
      return null;
    }

    // Set position based on sector coordinates
    entity.setPosition(
      this.manifest.coordinates.x,
      0,
      this.manifest.coordinates.z
    );

    return entity;
  }

  /**
   * Load meshes for the specified LOD level
   */
  private async loadMeshes(entity: pc.Entity, lodLevel: number): Promise<void> {
    if (!this.manifest) return;

    const meshPromises = this.manifest.meshes.map(async (meshDef) => {
      // Find the LOD level (fallback to lowest if requested level not available)
      let lod = meshDef.lods.find((l) => l.level === lodLevel);
      if (!lod) {
        lod = meshDef.lods[meshDef.lods.length - 1]; // Use lowest quality
      }

      // Find target entity
      const targetEntity = entity.findByName(meshDef.targetEntity) as pc.Entity;
      if (!targetEntity) {
        console.warn(`[SectorLoader] Target entity not found: ${meshDef.targetEntity}`);
        return;
      }

      // Load mesh
      try {
        const mesh = await this.assetSource.loadMesh(lod.url);

        // Apply mesh to entity's model component
        if ((targetEntity as any).model) {
          (targetEntity as any).model.meshInstances[0].mesh = mesh;
        }
      } catch (err) {
        console.error(`[SectorLoader] Failed to load mesh ${lod.url}:`, err);
      }
    });

    await Promise.all(meshPromises);
  }

  /**
   * Apply materials to entities
   */
  private async applyMaterials(entity: pc.Entity): Promise<void> {
    if (!this.manifest) return;

    for (const matDef of this.manifest.materials) {
      // Create material instance
      const material = this.materialFactory.createFromDefinition(matDef);
      if (!material) {
        console.warn(`[SectorLoader] Failed to create material: ${matDef.id}`);
        continue;
      }

      // Apply to target entities
      for (const targetName of matDef.targetEntities) {
        const targetEntity = entity.findByName(targetName) as pc.Entity;
        if (!targetEntity || !(targetEntity as any).model) {
          console.warn(`[SectorLoader] Target entity not found: ${targetName}`);
          continue;
        }

        // Apply material to all mesh instances
        for (const meshInstance of (targetEntity as any).model.meshInstances) {
          meshInstance.material = material;
        }
      }
    }
  }

  /**
   * Start progressive texture loading
   */
  private async startTextureLoading(entity: pc.Entity, priority: number): Promise<void> {
    if (!this.manifest) return;

    const streamingContext: StreamingContext = {
      sectorId: this.sectorId,
      priority,
      stopAtScreenRes: true,
    };

    // Start all textures loading in parallel (progressive)
    const texturePromises = this.manifest.textures.map(async (texDef) => {
      const targetEntity = entity.findByName(texDef.targetEntity) as pc.Entity;
      if (!targetEntity) {
        console.warn(`[SectorLoader] Texture target entity not found: ${texDef.targetEntity}`);
        return;
      }

      try {
        await this.textureStreaming.loadProgressive(
          this.app,
          targetEntity,
          texDef,
          {
            ...streamingContext,
            minLevel: texDef.minLevel,
            priority: texDef.priority,
          }
        );
      } catch (err) {
        console.error(`[SectorLoader] Failed to load texture ${texDef.url}:`, err);
      }
    });

    // Don't wait for textures to complete - they load progressively
    Promise.all(texturePromises).catch((err) => {
      console.error(`[SectorLoader] Texture loading errors:`, err);
    });
  }

  /**
   * Update LOD level
   */
  async updateLod(newLevel: number): Promise<void> {
    if (!this.loadedSector || !this.manifest) {
      throw new Error('Sector not loaded');
    }

    if (newLevel === this.loadedSector.currentLod) {
      return; // Already at this LOD
    }

    if (this.verbose) {
      console.log(`[SectorLoader] Updating LOD: ${this.loadedSector.currentLod} → ${newLevel}`);
    }

    // Load new meshes
    await this.loadMeshes(this.loadedSector.entity, newLevel);

    // Update state
    this.loadedSector.currentLod = newLevel;
    this.loadedSector.memoryUsage = this.estimateMemoryUsage(newLevel);

    // Update status based on LOD
    if (newLevel === 0) {
      this.loadedSector.status = SectorStatus.LoadedHigh;
    } else if (newLevel === 1) {
      this.loadedSector.status = SectorStatus.LoadedMedium;
    } else {
      this.loadedSector.status = SectorStatus.LoadedLow;
    }
  }

  /**
   * Unload sector
   */
  unload(): void {
    if (!this.loadedSector) return;

    if (this.verbose) {
      console.log(`[SectorLoader] Unloading sector: ${this.sectorId}`);
    }

    // Cancel texture loading
    this.textureStreaming.cancelSector(this.sectorId);

    // Destroy entity
    if (this.loadedSector.entity) {
      this.loadedSector.entity.destroy();
    }

    this.loadedSector = null;
  }

  /**
   * Estimate memory usage for a LOD level (rough estimate)
   */
  private estimateMemoryUsage(lodLevel: number): number {
    if (!this.manifest) return 0;

    let total = 0;

    // Estimate mesh memory
    for (const meshDef of this.manifest.meshes) {
      const lod = meshDef.lods.find((l) => l.level === lodLevel);
      if (lod) {
        total += lod.size;
      }
    }

    // Estimate texture memory (rough: assume 4 bytes per pixel at full res)
    // This is a placeholder - real texture memory depends on mip levels loaded
    for (const texDef of this.manifest.textures) {
      total += 2 * 1024 * 1024; // Assume 2MB per texture on average
    }

    return total;
  }

  /**
   * Get loaded sector data
   */
  getLoadedSector(): LoadedSector | null {
    return this.loadedSector;
  }

  /**
   * Get sector ID
   */
  getSectorId(): string {
    return this.sectorId;
  }

  /**
   * Get manifest
   */
  getManifest(): SectorManifest | null {
    return this.manifest;
  }
}

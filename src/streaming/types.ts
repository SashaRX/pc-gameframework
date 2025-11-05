/**
 * Type definitions for PlayCanvas Streaming System
 *
 * This module provides progressive sector-based world streaming
 * integrated with KTX2 Progressive Loader for textures.
 */

import type * as pc from 'playcanvas';
import type { Ktx2ProgressiveLoader } from '../ktx2-loader/Ktx2ProgressiveLoader';

// ============================================================================
// Configuration Interfaces
// ============================================================================

/**
 * Main streaming system configuration
 */
export interface StreamingConfig {
  /** Size of a grid cell in world units (e.g., 50-100m) */
  gridSize: number;

  /** View distance for loading sectors (e.g., 200-500m) */
  viewDistance: number;

  /** Maximum concurrent sector loads */
  maxConcurrentLoads: number;

  /** Memory budget in megabytes */
  memoryBudget: number;

  /** Radius for priority loading (sectors within this radius load first) */
  priorityRadius: number;

  /** Enable debug visualization */
  debug?: boolean;

  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Texture streaming configuration
 */
export interface TextureStreamingConfig {
  /** Default minimum mip level to start with */
  defaultMinLevel: number;

  /** Adaptive margin multiplier for screen size calculations */
  adaptiveMargin: number;

  /** Delay between mip level loads (ms) */
  stepDelayMs: number;

  /** Enable IndexedDB caching */
  enableCache: boolean;

  /** Cache TTL in days */
  cacheTtlDays: number;
}

// ============================================================================
// Sector Manifest
// ============================================================================

/**
 * Complete sector manifest - describes all assets in a sector
 */
export interface SectorManifest {
  /** Unique sector identifier (e.g., "x50_z100") */
  sectorId: string;

  /** Grid coordinates */
  coordinates: { x: number; z: number };

  /** PlayCanvas template ID to instantiate */
  templateId: string;

  /** Mesh definitions with LOD levels */
  meshes: MeshDefinition[];

  /** Material definitions */
  materials: MaterialDefinition[];

  /** Texture definitions */
  textures: TextureDefinition[];

  /** Optional metadata */
  metadata?: {
    biome?: string;
    tags?: string[];
    version?: string;
  };
}

/**
 * Mesh definition with LOD levels
 */
export interface MeshDefinition {
  /** Mesh identifier within the sector */
  id: string;

  /** Target entity name in template */
  targetEntity: string;

  /** LOD levels (0 = highest quality) */
  lods: MeshLodLevel[];
}

/**
 * Single LOD level for a mesh
 */
export interface MeshLodLevel {
  /** LOD level (0 = high, 1 = medium, 2 = low) */
  level: number;

  /** URL to mesh file (GLB, Draco GLB, etc.) */
  url: string;

  /** File size in bytes */
  size: number;

  /** Is compressed with Draco */
  draco?: boolean;

  /** Distance threshold for switching to this LOD */
  distance?: number;
}

/**
 * Material definition
 */
export interface MaterialDefinition {
  /** Material identifier */
  id: string;

  /** Master material ID to instance from */
  masterId: string;

  /** Target entities to apply this material to */
  targetEntities: string[];

  /** Property overrides for this material instance */
  overrides: Record<string, any>;
}

/**
 * Texture definition for streaming
 */
export interface TextureDefinition {
  /** Texture identifier */
  id: string;

  /** KTX2 file URL */
  url: string;

  /** Target entity name */
  targetEntity: string;

  /** Material property to assign to (e.g., "diffuseMap", "normalMap") */
  materialProperty: string;

  /** Minimum mip level to start loading from */
  minLevel: number;

  /** Loading priority (0-10, higher = more important) */
  priority: number;

  /** Is sRGB texture (for albedo/diffuse) */
  isSrgb?: boolean;
}

// ============================================================================
// Streaming Context
// ============================================================================

/**
 * Context passed to KTX2 loader for streaming coordination
 */
export interface StreamingContext {
  /** Sector this texture belongs to */
  sectorId: string;

  /** Loading priority (0-10) */
  priority: number;

  /** Minimum mip level to load */
  minLevel?: number;

  /** Maximum mip level to load */
  maxLevel?: number;

  /** Stop at screen resolution */
  stopAtScreenRes?: boolean;

  /** Distance from camera (for priority calculation) */
  distance?: number;
}

// ============================================================================
// Sector State
// ============================================================================

/**
 * Sector loading status
 */
export enum SectorStatus {
  /** Not loaded */
  Unloaded = 'unloaded',

  /** Currently loading */
  Loading = 'loading',

  /** Loaded with minimum LOD */
  LoadedLow = 'loaded_low',

  /** Loaded with medium LOD */
  LoadedMedium = 'loaded_medium',

  /** Fully loaded with highest LOD */
  LoadedHigh = 'loaded_high',

  /** Failed to load */
  Failed = 'failed',
}

/**
 * Loaded sector state
 */
export interface LoadedSector {
  /** Sector manifest */
  manifest: SectorManifest;

  /** Root entity in scene */
  entity: pc.Entity;

  /** Current LOD level */
  currentLod: number;

  /** Loading status */
  status: SectorStatus;

  /** Memory usage in bytes */
  memoryUsage: number;

  /** Last access timestamp (for LRU) */
  lastAccessed: number;

  /** Distance from camera */
  distance: number;

  /** Loading priority */
  priority: number;
}

// ============================================================================
// Memory Management
// ============================================================================

/**
 * Memory usage statistics
 */
export interface MemoryStats {
  /** Total memory used by sectors (MB) */
  totalUsedMB: number;

  /** Memory budget (MB) */
  budgetMB: number;

  /** Number of loaded sectors */
  sectorsLoaded: number;

  /** Breakdown by sector */
  sectorBreakdown: Map<string, number>;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Event types for streaming system
 */
export enum StreamingEvent {
  /** Sector started loading */
  SectorLoadStart = 'sector:load:start',

  /** Sector finished loading */
  SectorLoadComplete = 'sector:load:complete',

  /** Sector unloaded */
  SectorUnloaded = 'sector:unloaded',

  /** Sector LOD changed */
  SectorLodChanged = 'sector:lod:changed',

  /** Memory budget exceeded */
  MemoryWarning = 'memory:warning',

  /** Sector load failed */
  SectorLoadFailed = 'sector:load:failed',
}

/**
 * Sector load event data
 */
export interface SectorLoadEvent {
  sectorId: string;
  status: SectorStatus;
  loadTime?: number;
  memoryUsage?: number;
  error?: Error;
}

// ============================================================================
// Grid & Priority
// ============================================================================

/**
 * 2D vector for grid coordinates
 */
export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Priority calculation result
 */
export interface PriorityInfo {
  /** Final priority value (0-1, higher = more important) */
  priority: number;

  /** Distance from camera */
  distance: number;

  /** Direction score (0-1, 1 = directly ahead) */
  directionScore: number;

  /** Velocity score (0-1, based on movement direction) */
  velocityScore: number;
}

// ============================================================================
// Asset Loading
// ============================================================================

/**
 * Asset source interface for loading various asset types
 */
export interface AssetSource {
  /**
   * Load a mesh from URL
   */
  loadMesh(url: string): Promise<pc.Mesh>;

  /**
   * Load a GLB model
   */
  loadGlb(url: string): Promise<pc.Entity>;

  /**
   * Get loading progress (0-1)
   */
  getProgress(): number;

  /**
   * Cancel pending loads
   */
  cancelAll(): void;
}

// ============================================================================
// Callbacks
// ============================================================================

/**
 * Callback for sector loading events
 */
export type SectorLoadCallback = (event: SectorLoadEvent) => void;

/**
 * Callback for progress updates
 */
export type ProgressCallback = (sectorId: string, progress: number) => void;

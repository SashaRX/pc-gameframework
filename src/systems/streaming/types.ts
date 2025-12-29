/**
 * Type definitions for Texture Streaming Manager
 */

import type * as pc from 'playcanvas';
import type { Ktx2LoaderConfig } from '../../loaders/ktx2-types';

// ============================================================================
// Texture Categories
// ============================================================================

/**
 * Texture loading categories
 * - persistent: Always loaded, high priority (UI, player, weapons)
 * - level: Loaded with level, medium priority (level geometry)
 * - dynamic: Streamed by distance, variable priority (world objects)
 */
export type TextureCategory = 'persistent' | 'level' | 'dynamic';

/**
 * Texture loading state
 */
export type TextureState =
  | 'unloaded'    // Not loaded
  | 'queued'      // In loading queue
  | 'loading'     // Currently loading
  | 'partial'     // Partially loaded (some LODs)
  | 'loaded'      // Fully loaded
  | 'error'       // Load failed
  | 'evicting';   // Being evicted from memory

// ============================================================================
// Configuration Interfaces
// ============================================================================

/**
 * Configuration for a texture category
 */
export interface CategoryConfig {
  /** Load immediately when registered */
  loadImmediately: boolean;

  /** Keep in memory (don't evict) */
  keepInMemory: boolean;

  /** Target LOD level (0=full, higher=lower quality) */
  targetLod: number;

  /** Priority weight multiplier */
  priorityWeight: number;

  /** Maximum memory budget for this category (MB) */
  maxMemoryMB?: number;
}

/**
 * Global streaming manager configuration
 */
export interface StreamingManagerConfig {
  /** Maximum total VRAM budget (MB) */
  maxMemoryMB: number;

  /** Maximum concurrent texture loads */
  maxConcurrent: number;

  /** Priority recalculation interval (seconds) */
  priorityUpdateInterval: number;

  /** Distance factor weight in priority calculation */
  distanceWeight: number;

  /** Enable debug logging */
  debugLogging: boolean;

  /** Log priority changes */
  logPriorityChanges: boolean;

  /** URL to libktx.mjs module (optional, overrides Asset Registry) */
  libktxModuleUrl?: string;

  /** URL to libktx.wasm binary (optional, overrides Asset Registry) */
  libktxWasmUrl?: string;

  /** URL to meshopt_decoder.mjs module (optional, overrides Asset Registry) */
  meshoptUrl?: string;
}

/**
 * Texture registration options
 */
export interface TextureRegistration {
  /** Unique identifier */
  id: string;

  /** KTX2 file URL */
  url: string;

  /** Category (persistent/level/dynamic) */
  category: TextureCategory;

  /** Entity to apply texture to */
  entity: pc.Entity;

  /** Minimum LOD level (highest number = lowest quality) */
  minLod?: number;

  /** Maximum LOD level (0 = full quality) */
  maxLod?: number;

  /** Target LOD level */
  targetLod?: number;

  /** User priority override (0-2, default 1) */
  userPriority?: number;

  /** Additional Ktx2Loader config options */
  loaderConfig?: Partial<Ktx2LoaderConfig>;
}

// ============================================================================
// Handle & State
// ============================================================================

/**
 * Texture handle metadata
 */
export interface TextureMetadata {
  id: string;
  url: string;
  category: TextureCategory;
  entity: pc.Entity;

  state: TextureState;

  minLod: number;
  maxLod: number;
  targetLod: number;
  currentLod: number;

  priority: number;
  userPriority: number;

  memoryUsage: number; // bytes
  lastUsed: number;    // timestamp
  loadStartTime?: number;
  loadEndTime?: number;

  error?: Error;
  abortController?: AbortController;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Texture event types
 */
export type TextureEventType =
  | 'registered'
  | 'queued'
  | 'loadStart'
  | 'loadProgress'
  | 'loaded'
  | 'error'
  | 'evicted'
  | 'unregistered'
  | 'priorityChanged';

/**
 * Texture event data
 */
export interface TextureEvent {
  type: TextureEventType;
  textureId: string;
  timestamp: number;
  data?: any;
}

// ============================================================================
// Statistics & Debug
// ============================================================================

/**
 * Streaming manager statistics
 */
export interface StreamingStats {
  // Counts
  totalTextures: number;
  unloaded: number;
  queued: number;
  loading: number;
  partial: number;
  loaded: number;
  error: number;

  // Memory
  memoryUsed: number;    // bytes
  memoryLimit: number;   // bytes
  memoryUsagePercent: number;

  // Performance
  activeLoads: number;
  maxConcurrent: number;
  averageLoadTime: number; // ms

  // Categories
  categoryStats: {
    [K in TextureCategory]: {
      count: number;
      memoryUsed: number;
      loaded: number;
    };
  };

  // Priority distribution
  priorityDistribution: {
    high: number;    // priority > 500
    medium: number;  // priority 100-500
    low: number;     // priority < 100
  };
}

/**
 * Individual texture debug info
 */
export interface TextureDebugInfo {
  id: string;
  url: string;
  category: TextureCategory;
  state: TextureState;

  priority: number;
  distance: number;

  currentLod: number;
  targetLod: number;
  lodProgress: string; // "3/7 loaded"

  memoryMB: string;
  loadTime?: string;

  lastUsed: string; // relative time
}

// ============================================================================
// Priority Calculation
// ============================================================================

/**
 * Priority calculation context
 */
export interface PriorityContext {
  /** Camera position */
  cameraPosition: pc.Vec3;

  /** Current time */
  now: number;

  /** Category weights */
  categoryWeights: Record<TextureCategory, number>;

  /** Distance weight */
  distanceWeight: number;
}

/**
 * Priority calculation result
 */
export interface PriorityResult {
  priority: number;
  distance: number;
  distanceFactor: number;
  categoryWeight: number;
  userWeight: number;
}

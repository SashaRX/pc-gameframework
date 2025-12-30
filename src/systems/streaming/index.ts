/**
 * Texture Streaming System - Public API
 *
 * Export all public components for easy import
 */

// Main manager
export { TextureStreamingManager } from './TextureStreamingManager';

// Core components (for advanced usage)
export { TextureHandle } from './TextureHandle';
export { TextureRegistry } from './TextureRegistry';
export { CategoryManager } from './CategoryManager';
export { MemoryTracker } from './MemoryTracker';
export { SimpleScheduler } from './SimpleScheduler';
export { PriorityQueue } from './PriorityQueue';

// Type definitions
export type {
  TextureCategory,
  TextureState,
  TextureMetadata,
  TextureRegistration,
  CategoryConfig,
  StreamingManagerConfig,
  StreamingStats,
  TextureEventType,
  TextureEvent,
  TextureDebugInfo,
  PriorityContext,
  PriorityResult,
} from './types';

// Memory tracker types
export type { MemoryStats } from './MemoryTracker';

// Priority queue types
export type { PriorityItem } from './PriorityQueue';

// Meshopt decoder (re-export for convenience)
export {
  MeshoptLoader,
  MeshoptDecoder,
  MeshoptMode,
  MeshoptFilter,
  MeshoptModeType,
  MeshoptFilterType,
} from '../../libs/meshoptimizer';

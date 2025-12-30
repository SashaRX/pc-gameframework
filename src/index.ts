/**
 * pc-gameframework - PlayCanvas Game Framework
 *
 * Main entry point - exports all public APIs
 */

// ============================================================================
// Libs - External library loaders (WASM)
// ============================================================================
export { LibktxLoader } from './libs/libktx/LibktxLoader';
export {
  MeshoptLoader,
  MeshoptDecoder,
  MeshoptMode,
  MeshoptFilter,
  MeshoptModeType,
  MeshoptFilterType,
} from './libs/meshoptimizer';

// ============================================================================
// Loaders - Asset loaders
// ============================================================================
export { Ktx2ProgressiveLoader } from './loaders/Ktx2ProgressiveLoader';
export { GpuFormatDetector, TextureFormat } from './loaders/GpuFormatDetector';
export { KtxCacheManager } from './loaders/KtxCacheManager';
export { MemoryPool } from './loaders/MemoryPool';
export * from './loaders/ktx2-types';

// ============================================================================
// Systems - Managers and runtime systems
// ============================================================================

// Streaming system
export {
  TextureStreamingManager,
  TextureHandle,
  TextureRegistry,
  CategoryManager,
  MemoryTracker,
  SimpleScheduler,
  PriorityQueue,
} from './systems/streaming';

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
  MemoryStats,
  PriorityItem,
} from './systems/streaming';

// ============================================================================
// Scripts - PlayCanvas script components
// ============================================================================
export { Ktx2LoaderScript } from './scripts/Ktx2LoaderScript';
export { StreamingManagerScript } from './scripts/StreamingManagerScript';
export { StreamedTextureScript } from './scripts/StreamedTextureScript';

// Register scripts
import './scripts/Ktx2LoaderScript';
import './scripts/StreamingManagerScript';
import './scripts/StreamedTextureScript';

/**
 * Streaming System - Asset streaming for PlayCanvas
 *
 * TWO SYSTEMS AVAILABLE:
 *
 * ============================================================================
 * NEW SYSTEM (Recommended) - ProcessedAssetManager
 * ============================================================================
 * Use when you have:
 * - PlaycanvasAssetProcessor output (mapping.json)
 * - LOD models with distance-based switching
 * - Material instances (master + params)
 * - ORM packed textures
 * - Templates with excluded assets (asset IDs need registration)
 *
 * Entry point: ProcessedAssetManager
 * Components: MappingLoader, AssetRegistrar, MaterialInstanceLoader,
 *             OrmTextureHandler, LodManager
 *
 * ============================================================================
 * LEGACY SYSTEM (Deprecated) - StreamingManager
 * ============================================================================
 * Use when you have:
 * - Simple manifest.json format
 * - Single LOD per model
 * - Direct material loading (no instances)
 * - No template asset ID requirements
 *
 * Entry point: StreamingManager (deprecated)
 * Components: AssetManifest, ModelLoader, MaterialLoader, TextureLoader
 *
 * ============================================================================
 */

// =============================================================================
// NEW SYSTEM - ProcessedAssetManager (Recommended)
// =============================================================================

// Main coordinator
export { ProcessedAssetManager } from './ProcessedAssetManager';
export type { ProcessedAssetManagerConfig } from './ProcessedAssetManager';

// Mapping & registration
export { MappingLoader } from './MappingLoader';
export { AssetRegistrar } from './AssetRegistrar';

// Material & texture handling
export { MaterialInstanceLoader } from './MaterialInstanceLoader';
export { OrmTextureHandler } from './OrmTextureHandler';

// LOD management
export { LodManager } from './LodManager';

// Types for new system
export * from './MappingTypes';

// =============================================================================
// SHARED COMPONENTS (Used by both systems)
// =============================================================================

export { CacheManager } from './CacheManager';
export { LodModelLoader } from './loaders/LodModelLoader';

// Extended types (LOD, processed assets)
export * from './types-extended';

// =============================================================================
// LEGACY SYSTEM (Deprecated - use ProcessedAssetManager instead)
// =============================================================================

/** @deprecated Use ProcessedAssetManager instead */
export { StreamingManager } from './StreamingManager';

/** @deprecated Use MappingLoader instead */
export { AssetManifest } from './AssetManifest';

/** @deprecated Use LodModelLoader instead */
export { ModelLoader } from './loaders/ModelLoader';

// These are still useful but have specialized replacements
export { MaterialLoader } from './loaders/MaterialLoader';
export { TextureLoader } from './loaders/TextureLoader';

// Legacy types
export * from './types';

/**
 * Streaming System - Main exports
 */

// Main manager for processed assets (new system)
export { ProcessedAssetManager } from './ProcessedAssetManager';
export type { ProcessedAssetManagerConfig } from './ProcessedAssetManager';

// Core components
export { MappingLoader } from './MappingLoader';
export { AssetRegistrar } from './AssetRegistrar';
export { MaterialInstanceLoader } from './MaterialInstanceLoader';
export { OrmTextureHandler } from './OrmTextureHandler';
export { LodManager } from './LodManager';

// Types
export * from './MappingTypes';

// Legacy (still usable)
export { StreamingManager } from './StreamingManager';
export { AssetManifest } from './AssetManifest';
export { CacheManager } from './CacheManager';

export { ModelLoader } from './loaders/ModelLoader';
export { MaterialLoader } from './loaders/MaterialLoader';
export { TextureLoader } from './loaders/TextureLoader';

export * from './types';

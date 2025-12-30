/**
 * Asset Loaders
 *
 * LodModelLoader - Recommended for models with LOD support
 * ModelLoader - Legacy, single LOD only (deprecated)
 */

// Recommended
export { LodModelLoader } from './LodModelLoader';

// Legacy (deprecated)
/** @deprecated Use LodModelLoader instead */
export { ModelLoader } from './ModelLoader';
export type { LoadedModel } from './ModelLoader';

// Active loaders
export { MaterialLoader } from './MaterialLoader';
export type { LoadedMaterial } from './MaterialLoader';

export { TextureLoader } from './TextureLoader';
export type { LoadedTexture, TextureLoaderConfig } from './TextureLoader';

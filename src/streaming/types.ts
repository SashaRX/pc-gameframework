/**
 * Streaming System Types
 */

// ============================================================================
// Asset Manifest Types
// ============================================================================

export interface ModelEntry {
  /** Relative path to GLB file */
  file: string;
  /** File size in bytes (for preload estimation) */
  size?: number;
  /** LOD variants if available */
  lods?: string[];
}

export interface MaterialEntry {
  /** Relative path to material instance JSON */
  file: string;
  /** Master material name in PlayCanvas */
  master: string;
}

export interface TextureEntry {
  /** Relative path to KTX2 file */
  file: string;
  /** File size in bytes */
  size?: number;
  /** Texture category for priority */
  category?: 'hero' | 'environment' | 'detail';
  /** Max LOD level (0 = full quality) */
  maxLod?: number;
}

export interface AssetManifestData {
  /** Base URL for all assets */
  baseUrl: string;
  /** Version for cache invalidation */
  version?: string;
  /**
   * Assets by PlayCanvas Asset Registry ID
   * Key is the asset ID as string (e.g., "12345678")
   */
  assets: Record<string, AssetEntry>;
}

export interface AssetEntry {
  /** Asset type */
  type: 'model' | 'material' | 'texture';
  /** Relative path to file */
  file: string;
  /** File size in bytes (for preload estimation) */
  size?: number;
  /** For materials: master material name */
  master?: string;
  /** For textures: category for priority */
  category?: 'hero' | 'environment' | 'detail';
}

// ============================================================================
// Material Instance Types
// ============================================================================

export interface MaterialInstanceData {
  /** Unique material ID */
  id: string;
  /** Master material name */
  master: string;
  /** Texture slot mappings (slot -> texture ID) */
  textures: Record<string, string>;
  /** Material parameters */
  params?: Record<string, number | number[] | boolean>;
}

// ============================================================================
// Cache Types
// ============================================================================

export type AssetType = 'model' | 'material' | 'texture';

export interface CachedAsset {
  id: string;
  type: AssetType;
  data: ArrayBuffer | object;
  size: number;
  timestamp: number;
  version?: string;
}

export interface CacheStats {
  totalSize: number;
  modelCount: number;
  materialCount: number;
  textureCount: number;
}

// ============================================================================
// Streaming Types
// ============================================================================

export type LoadPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface LoadRequest {
  id: string;
  type: AssetType;
  priority: LoadPriority;
  distance?: number;
  timestamp: number;
}

export interface StreamingConfig {
  /** Manifest URL */
  manifestUrl: string;
  /** Max memory for textures (MB) */
  maxTextureMemoryMB: number;
  /** Max memory for models (MB) */
  maxModelMemoryMB: number;
  /** Max concurrent downloads */
  maxConcurrent: number;
  /** Enable IndexedDB caching */
  useIndexedDB: boolean;
  /** Cache name for IndexedDB */
  cacheName: string;
  /** libktx module URL */
  libktxModuleUrl: string;
  /** libktx WASM URL */
  libktxWasmUrl: string;
  /** Enable debug logging */
  debug: boolean;
}

export const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
  manifestUrl: '',
  maxTextureMemoryMB: 512,
  maxModelMemoryMB: 256,
  maxConcurrent: 4,
  useIndexedDB: true,
  cacheName: 'asset-streaming-cache',
  libktxModuleUrl: '',
  libktxWasmUrl: '',
  debug: false,
};

// ============================================================================
// Entity Scanning Types
// ============================================================================

export interface EntityAssetRefs {
  /** Entity reference */
  entityId: string;
  entityPath: string;
  /** Model ID if has render/model component */
  modelId?: string;
  /** Material IDs per mesh instance */
  materialIds: string[];
  /** Direct texture IDs (if not through material) */
  textureIds: string[];
}

export interface TemplateAssetRefs {
  templateId: string;
  templateName: string;
  entities: EntityAssetRefs[];
  /** All unique asset IDs referenced */
  allModels: string[];
  allMaterials: string[];
  allTextures: string[];
}

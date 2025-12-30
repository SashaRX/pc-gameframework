/**
 * Extended Streaming Types - Support for LODs, packed textures, material instances
 *
 * Handles the transformation from PlayCanvas asset structure to processed assets:
 * - Models with LOD variants
 * - Packed textures (multiple channels combined)
 * - Material instances referencing master materials
 */

// ============================================================================
// Extended Asset Manifest
// ============================================================================

/**
 * Extended manifest with full asset transformation support
 */
export interface ExtendedManifestData {
  /** Base URL for all assets */
  baseUrl: string;
  /** Version for cache invalidation */
  version: string;
  /** Build timestamp */
  buildTime?: string;

  /**
   * Asset mappings by original PlayCanvas Asset ID
   * Key = original asset ID as string
   */
  assets: Record<string, ProcessedAssetEntry>;

  /**
   * Texture packing definitions
   * Describes how original textures were combined
   */
  packedTextures?: Record<string, PackedTextureDefinition>;

  /**
   * Master materials available in PlayCanvas project
   */
  masterMaterials?: string[];
}

// ============================================================================
// Processed Asset Entries
// ============================================================================

export type ProcessedAssetEntry =
  | ProcessedModelEntry
  | ProcessedMaterialEntry
  | ProcessedTextureEntry;

/**
 * Model with LOD support
 */
export interface ProcessedModelEntry {
  type: 'model';
  /** Original asset name */
  name: string;
  /** LOD configuration */
  lods: ModelLodConfig;
  /** Total size of all LODs (bytes) */
  totalSize: number;
}

export interface ModelLodConfig {
  /** LOD files from highest to lowest quality */
  files: ModelLodFile[];
  /** LOD selection mode */
  mode: 'distance' | 'screenSize' | 'manual';
  /** Crossfade duration in ms (0 = instant) */
  crossfadeDuration?: number;
}

export interface ModelLodFile {
  /** Relative path to GLB file */
  file: string;
  /** File size in bytes */
  size: number;
  /** Distance threshold for this LOD (if mode=distance) */
  distance?: number;
  /** Screen size threshold (0-1, if mode=screenSize) */
  screenSize?: number;
  /** LOD level (0 = highest quality) */
  level: number;
}

/**
 * Material instance referencing a master
 */
export interface ProcessedMaterialEntry {
  type: 'material';
  /** Original asset name */
  name: string;
  /** Path to material instance JSON */
  file: string;
  /** Master material name in PlayCanvas */
  master: string;
  /** Quick reference to texture dependencies (for preload planning) */
  textureDeps: string[];
}

/**
 * Texture - either standalone or reference to packed texture
 */
export interface ProcessedTextureEntry {
  type: 'texture';
  /** Original asset name */
  name: string;
  /**
   * For standalone textures: path to KTX2 file
   * For packed textures: ID of packed texture + channel info
   */
  source: TextureSource;
  /** Original texture dimensions */
  originalWidth?: number;
  originalHeight?: number;
  /** Texture category for priority */
  category?: 'hero' | 'environment' | 'detail';
}

export type TextureSource = StandaloneTextureSource | PackedTextureSource;

export interface StandaloneTextureSource {
  type: 'standalone';
  /** Path to KTX2 file */
  file: string;
  /** File size in bytes */
  size: number;
}

export interface PackedTextureSource {
  type: 'packed';
  /** ID of the packed texture */
  packedId: string;
  /** Which channel(s) contain this texture's data */
  channels: TextureChannelMapping;
}

// ============================================================================
// Packed Texture Definitions
// ============================================================================

/**
 * Describes a packed texture combining multiple source textures
 */
export interface PackedTextureDefinition {
  /** Unique ID for this packed texture */
  id: string;
  /** Path to KTX2 file */
  file: string;
  /** File size in bytes */
  size: number;
  /** Dimensions */
  width: number;
  height: number;
  /** What each channel contains */
  channels: {
    r?: ChannelContent;
    g?: ChannelContent;
    b?: ChannelContent;
    a?: ChannelContent;
  };
  /** Original texture IDs that were packed into this texture */
  sourceTextures: string[];
}

export interface ChannelContent {
  /** Original texture ID */
  sourceTextureId: string;
  /** Which channel from the source (if source was multi-channel) */
  sourceChannel?: 'r' | 'g' | 'b' | 'a' | 'luminance';
  /** Semantic purpose */
  purpose: TexturePurpose;
}

export type TexturePurpose =
  | 'diffuse'
  | 'normal'
  | 'height'
  | 'gloss'
  | 'roughness'
  | 'metalness'
  | 'ao'
  | 'emissive'
  | 'opacity'
  | 'specular';

/**
 * Mapping of texture data to shader channels
 */
export interface TextureChannelMapping {
  /** Channel containing the data: 'r', 'g', 'b', 'a', or 'rgb' for color */
  channel: 'r' | 'g' | 'b' | 'a' | 'rgb' | 'rgba';
  /** Invert the value (1 - value) */
  invert?: boolean;
}

// ============================================================================
// Material Instance Data (JSON file format)
// ============================================================================

/**
 * Material instance JSON file structure
 */
export interface MaterialInstanceFile {
  /** Version for compatibility */
  version: 1;
  /** Original PlayCanvas material asset ID */
  originalId: string;
  /** Original material name */
  name: string;
  /** Master material to clone from */
  master: string;

  /**
   * Texture slot assignments
   * Maps PlayCanvas slot names to texture configurations
   */
  textures: Record<string, MaterialTextureSlot>;

  /**
   * Scalar/color parameters that differ from master
   */
  parameters?: MaterialParameters;

  /**
   * Shader chunk overrides (advanced)
   */
  chunks?: Record<string, string>;
}

export interface MaterialTextureSlot {
  /** Texture asset ID (may be packed texture ID) */
  textureId: string;
  /**
   * Channel extraction for packed textures
   * If undefined, use full texture (rgb/rgba)
   */
  channel?: TextureChannelMapping;
  /** UV channel (0 or 1) */
  uvChannel?: number;
  /** Tiling */
  tiling?: [number, number];
  /** Offset */
  offset?: [number, number];
}

export interface MaterialParameters {
  // Colors (as [r, g, b] 0-1)
  diffuse?: [number, number, number];
  specular?: [number, number, number];
  emissive?: [number, number, number];

  // Scalars
  metalness?: number;
  gloss?: number; // 0-1, inversed in shader if using roughness
  glossInvert?: boolean; // true if source is roughness
  aoMapIntensity?: number; // 0-1, how strong AO effect is
  bumpiness?: number;
  heightMapFactor?: number;
  emissiveIntensity?: number;
  opacity?: number;

  // Flags
  twoSidedLighting?: boolean;
  useFog?: boolean;
  useGammaTonemap?: boolean;

  // Any additional custom parameters
  [key: string]: any;
}

// ============================================================================
// Runtime Types
// ============================================================================

/**
 * Loaded model with LOD support
 */
export interface LoadedModelWithLods {
  id: string;
  config: ModelLodConfig;
  /** Loaded LOD assets (may be partially loaded) */
  lods: Map<number, LoadedLodLevel>;
  /** Currently active LOD level */
  currentLod: number;
  /** Entity this model is applied to */
  entity?: pc.Entity;
}

export interface LoadedLodLevel {
  level: number;
  asset: pc.Asset;
  resource: any; // ContainerResource
  loaded: boolean;
  loading: boolean;
}

/**
 * Loaded packed texture
 */
export interface LoadedPackedTexture {
  id: string;
  texture: pc.Texture;
  definition: PackedTextureDefinition;
  /** Map of original texture ID -> channel info for quick lookup */
  channelMap: Map<string, TextureChannelMapping>;
}

// LoadedMaterialInstance moved to MappingTypes.ts

// ============================================================================
// Type Guards
// ============================================================================

export function isModelEntry(entry: ProcessedAssetEntry): entry is ProcessedModelEntry {
  return entry.type === 'model';
}

export function isMaterialEntry(entry: ProcessedAssetEntry): entry is ProcessedMaterialEntry {
  return entry.type === 'material';
}

export function isTextureEntry(entry: ProcessedAssetEntry): entry is ProcessedTextureEntry {
  return entry.type === 'texture';
}

export function isPackedSource(source: TextureSource): source is PackedTextureSource {
  return source.type === 'packed';
}

export function isStandaloneSource(source: TextureSource): source is StandaloneTextureSource {
  return source.type === 'standalone';
}

// Import pc types for declarations
import type * as pc from 'playcanvas';

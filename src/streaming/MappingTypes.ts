/**
 * Mapping Types - Structure of mapping.json from PlaycanvasAssetProcessor
 */

// ============================================================================
// Mapping JSON Root
// ============================================================================

export interface AssetMapping {
  /** Base URL for all assets (B2 server) */
  baseUrl: string;
  /** Version for cache invalidation */
  version?: string;
  /** Model mappings by original PlayCanvas asset ID */
  models: Record<string, ModelMapping>;
  /** Material mappings by original PlayCanvas asset ID */
  materials: Record<string, string>; // ID -> path to instance JSON
}

// ============================================================================
// Model Mapping
// ============================================================================

export interface ModelMapping {
  /** Original asset name */
  name: string;
  /** Material IDs used by this model (original PlayCanvas IDs) */
  materials: number[];
  /** LOD configurations */
  lods: LodConfig[];
}

export interface LodConfig {
  /** Path to GLB file on server */
  path: string;
  /** Max distance for this LOD (null = infinite, load first) */
  maxDistance: number | null;
}

// ============================================================================
// Material Instance JSON (loaded from server)
// ============================================================================

export interface MaterialInstanceJson {
  /** Master material name in PlayCanvas */
  master: string;
  /** Scalar/color parameters */
  params?: MaterialParams;
  /** Texture assignments */
  textures?: Record<string, TextureRef | PackedTextureRef>;
}

export interface MaterialParams {
  diffuse?: [number, number, number];
  specular?: [number, number, number];
  emissive?: [number, number, number];
  metalness?: number;
  glossiness?: number;
  opacity?: number;
  bumpiness?: number;
  [key: string]: any;
}

/** Simple texture reference */
export type TextureRef = string;

/** Packed texture with channel mapping (e.g., ORM) */
export interface PackedTextureRef {
  path: string;
  /** Channel mappings - which channel contains what */
  ao?: 'r' | 'g' | 'b' | 'a';
  roughness?: 'r' | 'g' | 'b' | 'a';
  metalness?: 'r' | 'g' | 'b' | 'a';
  occlusion?: 'r' | 'g' | 'b' | 'a';
  gloss?: 'r' | 'g' | 'b' | 'a';
  height?: 'r' | 'g' | 'b' | 'a';
}

// ============================================================================
// Type Guards
// ============================================================================

export function isPackedTextureRef(ref: TextureRef | PackedTextureRef): ref is PackedTextureRef {
  return typeof ref === 'object' && 'path' in ref;
}

export function isSimpleTextureRef(ref: TextureRef | PackedTextureRef): ref is TextureRef {
  return typeof ref === 'string';
}

// ============================================================================
// Runtime Types
// ============================================================================

export interface LoadedModel {
  id: string;
  name: string;
  materialIds: number[];
  lods: LoadedLod[];
  currentLodIndex: number;
  entity?: pc.Entity;
}

export interface LoadedLod {
  index: number;
  config: LodConfig;
  asset: pc.Asset | null;
  loaded: boolean;
  loading: boolean;
}

export interface LoadedMaterialInstance {
  id: string;
  material: pc.StandardMaterial;
  masterName: string;
  texturePaths: Map<string, string | PackedTextureRef>;
  texturesLoaded: boolean;
}

// pc types
import type * as pc from 'playcanvas';

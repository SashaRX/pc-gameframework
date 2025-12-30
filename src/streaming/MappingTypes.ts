/**
 * Mapping Types - Structure of mapping.json from PlaycanvasAssetProcessor
 *
 * See docs/MAPPING_SPEC.md for full specification
 */

import type * as pc from 'playcanvas';

// ============================================================================
// Mapping JSON Root
// ============================================================================

export interface AssetMapping {
  /** Schema version */
  version: string;
  /** Generation timestamp */
  generated?: string;
  /** Base URL for all assets (B2 server) */
  baseUrl: string;
  /** Master materials: name -> asset ID */
  masterMaterials?: Record<string, number>;
  /** Model mappings by original PlayCanvas asset ID */
  models: Record<string, ModelMapping>;
  /** Material mappings: asset ID -> path to instance JSON */
  materials: Record<string, string>;
  /** Texture mappings: asset ID or string key -> path or PackedTextureEntry */
  textures: Record<string | number, string | PackedTextureEntry>;
}

// ============================================================================
// Model Mapping
// ============================================================================

export interface ModelMapping {
  /** Original asset name */
  name: string;
  /** Path in editor hierarchy */
  path: string;
  /** Material IDs used by this model (original PlayCanvas IDs) */
  materials: number[];
  /** LOD configurations */
  lods: LodConfig[];
}

export interface LodConfig {
  /** LOD level (0 = highest detail) */
  level: number;
  /** Path to GLB file relative to baseUrl */
  file: string;
  /** Switch distance (0 = closest) */
  distance: number;
}

// ============================================================================
// Texture Entries
// ============================================================================

/** Packed texture entry with source asset IDs */
export interface PackedTextureEntry {
  /** Path to KTX2 file */
  file: string;
  /** Original asset IDs that were packed [ao, gloss, metalness, height?] */
  sources: number[];
}

export function isPackedTextureEntry(entry: string | PackedTextureEntry): entry is PackedTextureEntry {
  return typeof entry === 'object' && 'file' in entry && 'sources' in entry;
}

// ============================================================================
// Material Instance JSON (loaded from server)
// ============================================================================

export interface MaterialInstanceJson {
  /** Master material name */
  master: string;
  /** Scalar/color parameters */
  params?: MaterialParams;
  /** Texture assignments: slot -> asset ID (number) or packed key (string) */
  textures?: Record<string, number | string>;
}

export interface MaterialParams {
  diffuse?: [number, number, number];
  specular?: [number, number, number];
  emissive?: [number, number, number];
  emissiveIntensity?: number;
  metalness?: number;
  gloss?: number;
  opacity?: number;
  bumpiness?: number;
  [key: string]: any;
}

// ============================================================================
// Runtime Types
// ============================================================================

export interface LoadedModel {
  id: string;
  name: string;
  path: string;
  materialIds: number[];
  lods: LoadedLod[];
  currentLodIndex: number;
  entity?: pc.Entity;
}

export interface LoadedLod {
  level: number;
  config: LodConfig;
  asset: pc.Asset | null;
  loaded: boolean;
  loading: boolean;
}

export interface LoadedMaterialInstance {
  id: string;
  material: pc.StandardMaterial;
  masterName: string;
  /** Texture slots: slot name -> asset ID or packed key */
  textureRefs: Map<string, number | string>;
  texturesLoaded: boolean;
}

// ============================================================================
// Utility Types
// ============================================================================

/** Texture reference - either asset ID (number) or packed texture key (string) */
export type TextureRef = number | string;

export function isPackedTextureKey(ref: TextureRef): ref is string {
  return typeof ref === 'string';
}

export function isAssetId(ref: TextureRef): ref is number {
  return typeof ref === 'number';
}

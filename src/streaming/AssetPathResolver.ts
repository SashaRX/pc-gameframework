/**
 * AssetPathResolver - Resolves asset paths using PlayCanvas structure
 *
 * PlayCanvas structure: files/assets/{assetId}/1/{filename}
 * Meta file: files/assets/{assetId}/1/{filename}.meta.json
 */

export interface AssetPaths {
  /** Base path to asset directory */
  dir: string;
  /** Full URL to main asset file */
  file: string;
  /** Full URL to meta.json */
  meta: string;
}

export class AssetPathResolver {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Get paths for asset by ID and filename
   */
  resolve(assetId: string | number, filename: string): AssetPaths {
    const id = String(assetId);
    const dir = `${this.baseUrl}/files/assets/${id}/1`;

    return {
      dir,
      file: `${dir}/${filename}`,
      meta: `${dir}/${filename}.meta.json`,
    };
  }

  /**
   * Get directory path for asset ID
   */
  getAssetDir(assetId: string | number): string {
    return `${this.baseUrl}/files/assets/${String(assetId)}/1`;
  }

  /**
   * Get meta.json path for asset
   */
  getMetaPath(assetId: string | number, filename: string): string {
    return `${this.getAssetDir(assetId)}/${filename}.meta.json`;
  }

  /**
   * Get file path within asset directory
   */
  getFilePath(assetId: string | number, filename: string): string {
    return `${this.getAssetDir(assetId)}/${filename}`;
  }

  /**
   * Build LOD file path
   */
  getLodPath(assetId: string | number, lodFilename: string): string {
    return `${this.getAssetDir(assetId)}/${lodFilename}`;
  }

  /**
   * Update base URL
   */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

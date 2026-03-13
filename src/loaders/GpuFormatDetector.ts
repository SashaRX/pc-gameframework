/**
 * GPU Format Detector
 * Detects supported compressed texture formats for the current platform.
 * Supports both WebGL2 and WebGPU devices via PlayCanvas GraphicsDevice API.
 *
 * KEY CHANGE: Constructor now takes pc.GraphicsDevice instead of WebGL context.
 * Both WebGL and WebGPU set the same ext* fields on the device, so detection
 * is uniform across backends. BPTC on WebGPU uses supportsTextureFormatTier1
 * (texture-format-tier1 = BC6H/BC7) instead of extTextureCompressionBPTC.
 */

export interface GpuCapabilities {
  // Desktop formats
  s3tc: boolean;        // BC1-BC3 (DXT1-DXT5)
  s3tc_srgb: boolean;   // BC1-BC3 sRGB variant
  bptc: boolean;        // BC6H/BC7 — WebGL: EXT_texture_compression_bptc, WebGPU: texture-format-tier1
  rgtc: boolean;        // BC4/BC5 — WebGL: EXT_texture_compression_rgtc, WebGPU: part of BC

  // Mobile formats
  etc1: boolean;        // ETC1 — WebGL only (not in WebGPU spec)
  etc: boolean;         // ETC2/EAC — WebGL: WEBGL_compressed_texture_etc, WebGPU: texture-compression-etc2
  astc: boolean;        // ASTC — WebGL: WEBGL_compressed_texture_astc, WebGPU: texture-compression-astc
  pvrtc: boolean;       // PVRTC — WebGL only (not in WebGPU spec)

  // Universal
  uncompressed: boolean;
}

export enum TextureFormat {
  BC1_RGB = 'BC1_RGB',
  BC1_RGBA = 'BC1_RGBA',
  BC3_RGBA = 'BC3_RGBA',
  BC4_R = 'BC4_R',
  BC5_RG = 'BC5_RG',
  BC6H_RGB_UF = 'BC6H_RGB_UF',
  BC7_RGBA = 'BC7_RGBA',

  ETC1_RGB = 'ETC1_RGB',
  ETC2_RGB = 'ETC2_RGB',
  ETC2_RGBA = 'ETC2_RGBA',
  ETC2_RGBA1 = 'ETC2_RGBA1',
  EAC_R11 = 'EAC_R11',
  EAC_RG11 = 'EAC_RG11',

  ASTC_4x4 = 'ASTC_4x4',
  ASTC_5x5 = 'ASTC_5x5',
  ASTC_6x6 = 'ASTC_6x6',
  ASTC_8x8 = 'ASTC_8x8',

  PVRTC1_4_RGB = 'PVRTC1_4_RGB',
  PVRTC1_4_RGBA = 'PVRTC1_4_RGBA',
  PVRTC1_2_RGB = 'PVRTC1_2_RGB',
  PVRTC1_2_RGBA = 'PVRTC1_2_RGBA',

  RGBA8 = 'RGBA8',
  SRGB8_ALPHA8 = 'SRGB8_ALPHA8',
}

interface CachedExtFormats {
  COMPRESSED_RGB_S3TC_DXT1_EXT?: number;
  COMPRESSED_RGBA_S3TC_DXT1_EXT?: number;
  COMPRESSED_RGBA_S3TC_DXT5_EXT?: number;
  COMPRESSED_RED_RGTC1_EXT?: number;
  COMPRESSED_RED_GREEN_RGTC2_EXT?: number;
  COMPRESSED_RGBA_BPTC_UNORM_EXT?: number;
  COMPRESSED_RGB_ETC1_WEBGL?: number;
  COMPRESSED_RGB8_ETC2?: number;
  COMPRESSED_RGBA8_ETC2_EAC?: number;
  COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2?: number;
  COMPRESSED_RGBA_ASTC_4x4_KHR?: number;
  COMPRESSED_RGBA_ASTC_6x6_KHR?: number;
  COMPRESSED_RGBA_ASTC_8x8_KHR?: number;
  COMPRESSED_RGB_PVRTC_4BPPV1_IMG?: number;
  COMPRESSED_RGBA_PVRTC_4BPPV1_IMG?: number;
  RGBA?: number;
  SRGB8_ALPHA8?: number;
}

export class GpuFormatDetector {
  private capabilities: GpuCapabilities;
  private _isWebGpu: boolean;
  /** WebGL extension format constants, cached at construction time (WebGL only) */
  private extFormats: CachedExtFormats = {};

  /**
   * @param device PlayCanvas GraphicsDevice (works for both WebGL2 and WebGPU)
   */
  constructor(device: any /* pc.GraphicsDevice */) {
    this._isWebGpu = device.isWebGPU === true;
    this.capabilities = this.detectCapabilities(device);

    // Cache WebGL extension enums for getInternalFormat() hot path
    if (!this._isWebGpu) {
      const gl = device.gl as WebGL2RenderingContext | null;
      if (gl) {
        this.cacheExtFormats(gl);
      }
    }
  }

  // ============================================================================
  // Capability Detection
  // ============================================================================

  /**
   * Detect capabilities using PlayCanvas GraphicsDevice ext* fields.
   *
   * Both WebGL2 and WebGPU set identical field names on the device:
   *   WebGL:  extCompressedTextureASTC = gl.getExtension('WEBGL_compressed_texture_astc')
   *   WebGPU: extCompressedTextureASTC = requireFeature('texture-compression-astc')
   *
   * BPTC (BC7) differs:
   *   WebGL:  extTextureCompressionBPTC (EXT_texture_compression_bptc)
   *   WebGPU: supportsTextureFormatTier1 (texture-format-tier1 covers BC6H/BC7)
   *           See PR #8459 — added in engine v2.x
   *
   * ETC1 / PVRTC: WebGL only — these fields don't exist on WebGPU devices.
   */
  private detectCapabilities(device: any): GpuCapabilities {
    const isWebGpu = this._isWebGpu;

    return {
      // S3TC (BC1-BC3): extCompressedTextureS3TC on both backends
      s3tc:      !!device.extCompressedTextureS3TC,
      s3tc_srgb: !!device.extCompressedTextureS3TC_SRGB,

      // BC7:
      //   WebGL  → EXT_texture_compression_bptc (extTextureCompressionBPTC)
      //   WebGPU → texture-format-tier1 (supportsTextureFormatTier1, includes tier2)
      bptc: isWebGpu
        ? (!!device.supportsTextureFormatTier1 || !!device.supportsTextureFormatTier2)
        : !!device.extTextureCompressionBPTC,

      // BC4/BC5:
      //   WebGL  → EXT_texture_compression_rgtc (not tracked by PC — fallback to S3TC)
      //   WebGPU → included in texture-compression-bc (= extCompressedTextureS3TC)
      rgtc: isWebGpu
        ? !!device.extCompressedTextureS3TC
        : (() => {
          // PlayCanvas doesn't expose a field for RGTC; detect via gl if available
          const gl = device.gl as WebGL2RenderingContext | null;
          return gl ? !!gl.getExtension('EXT_texture_compression_rgtc') : false;
        })(),

      // ETC1: WebGL only (WEBGL_compressed_texture_etc1), no WebGPU equivalent
      etc1: !!device.extCompressedTextureETC1,

      // ETC2: extCompressedTextureETC on both backends
      etc: !!device.extCompressedTextureETC,

      // ASTC: extCompressedTextureASTC on both backends
      astc: !!device.extCompressedTextureASTC,

      // PVRTC: WebGL only, no WebGPU equivalent
      pvrtc: !!device.extCompressedTexturePVRTC,

      uncompressed: true,
    };
  }

  /**
   * Cache WebGL extension enum values at init time.
   * Avoids repeated getExtension() calls in uploadMipLevel hot path.
   */
  private cacheExtFormats(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const s3tc   = gl.getExtension('WEBGL_compressed_texture_s3tc');
    const rgtc   = gl.getExtension('EXT_texture_compression_rgtc');
    const bptc   = gl.getExtension('EXT_texture_compression_bptc');
    const etc1   = gl.getExtension('WEBGL_compressed_texture_etc1');
    const etc    = gl.getExtension('WEBGL_compressed_texture_etc');
    const astc   = gl.getExtension('WEBGL_compressed_texture_astc') ||
                   gl.getExtension('WEBKIT_WEBGL_compressed_texture_astc');
    const pvrtc  = gl.getExtension('WEBGL_compressed_texture_pvrtc') ||
                   gl.getExtension('WEBKIT_WEBGL_compressed_texture_pvrtc');

    this.extFormats = {
      COMPRESSED_RGB_S3TC_DXT1_EXT:         (s3tc  as any)?.COMPRESSED_RGB_S3TC_DXT1_EXT,
      COMPRESSED_RGBA_S3TC_DXT1_EXT:        (s3tc  as any)?.COMPRESSED_RGBA_S3TC_DXT1_EXT,
      COMPRESSED_RGBA_S3TC_DXT5_EXT:        (s3tc  as any)?.COMPRESSED_RGBA_S3TC_DXT5_EXT,
      COMPRESSED_RED_RGTC1_EXT:             (rgtc  as any)?.COMPRESSED_RED_RGTC1_EXT,
      COMPRESSED_RED_GREEN_RGTC2_EXT:       (rgtc  as any)?.COMPRESSED_RED_GREEN_RGTC2_EXT,
      COMPRESSED_RGBA_BPTC_UNORM_EXT:       (bptc  as any)?.COMPRESSED_RGBA_BPTC_UNORM_EXT,
      COMPRESSED_RGB_ETC1_WEBGL:            (etc1  as any)?.COMPRESSED_RGB_ETC1_WEBGL,
      COMPRESSED_RGB8_ETC2:                 (etc   as any)?.COMPRESSED_RGB8_ETC2,
      COMPRESSED_RGBA8_ETC2_EAC:            (etc   as any)?.COMPRESSED_RGBA8_ETC2_EAC,
      COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2: (etc as any)?.COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2,
      COMPRESSED_RGBA_ASTC_4x4_KHR:         (astc  as any)?.COMPRESSED_RGBA_ASTC_4x4_KHR,
      COMPRESSED_RGBA_ASTC_6x6_KHR:         (astc  as any)?.COMPRESSED_RGBA_ASTC_6x6_KHR,
      COMPRESSED_RGBA_ASTC_8x8_KHR:         (astc  as any)?.COMPRESSED_RGBA_ASTC_8x8_KHR,
      COMPRESSED_RGB_PVRTC_4BPPV1_IMG:      (pvrtc as any)?.COMPRESSED_RGB_PVRTC_4BPPV1_IMG,
      COMPRESSED_RGBA_PVRTC_4BPPV1_IMG:     (pvrtc as any)?.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG,
      RGBA:          gl.RGBA,
      SRGB8_ALPHA8:  (gl as WebGL2RenderingContext).SRGB8_ALPHA8 ?? gl.RGBA,
    };
  }

  // ============================================================================
  // Public API
  // ============================================================================

  getCapabilities(): GpuCapabilities {
    return { ...this.capabilities };
  }

  isWebGpuDevice(): boolean {
    return this._isWebGpu;
  }

  isSupported(format: TextureFormat): boolean {
    switch (format) {
      case TextureFormat.BC1_RGB:
      case TextureFormat.BC1_RGBA:
      case TextureFormat.BC3_RGBA:    return this.capabilities.s3tc;
      case TextureFormat.BC4_R:
      case TextureFormat.BC5_RG:      return this.capabilities.rgtc;
      case TextureFormat.BC6H_RGB_UF:
      case TextureFormat.BC7_RGBA:    return this.capabilities.bptc;
      case TextureFormat.ETC1_RGB:    return this.capabilities.etc1;
      case TextureFormat.ETC2_RGB:
      case TextureFormat.ETC2_RGBA:
      case TextureFormat.ETC2_RGBA1:
      case TextureFormat.EAC_R11:
      case TextureFormat.EAC_RG11:    return this.capabilities.etc;
      case TextureFormat.ASTC_4x4:
      case TextureFormat.ASTC_5x5:
      case TextureFormat.ASTC_6x6:
      case TextureFormat.ASTC_8x8:    return this.capabilities.astc;
      case TextureFormat.PVRTC1_4_RGB:
      case TextureFormat.PVRTC1_4_RGBA:
      case TextureFormat.PVRTC1_2_RGB:
      case TextureFormat.PVRTC1_2_RGBA: return this.capabilities.pvrtc;
      case TextureFormat.RGBA8:
      case TextureFormat.SRGB8_ALPHA8:  return true;
      default: return false;
    }
  }

  getBestFormat(hasAlpha: boolean, isSrgb: boolean): TextureFormat {
    if (this.capabilities.astc) return TextureFormat.ASTC_4x4;
    if (this.capabilities.bptc) return TextureFormat.BC7_RGBA;
    if (this.capabilities.etc)  return hasAlpha ? TextureFormat.ETC2_RGBA : TextureFormat.ETC2_RGB;
    if (this.capabilities.s3tc) return hasAlpha ? TextureFormat.BC3_RGBA  : TextureFormat.BC1_RGB;
    if (this.capabilities.etc1 && !hasAlpha) return TextureFormat.ETC1_RGB;
    if (this.capabilities.pvrtc) return hasAlpha ? TextureFormat.PVRTC1_4_RGBA : TextureFormat.PVRTC1_4_RGB;
    return isSrgb ? TextureFormat.SRGB8_ALPHA8 : TextureFormat.RGBA8;
  }

  /**
   * Get WebGL internal format constant for a given TextureFormat.
   * Uses values cached at construction time — no getExtension() calls.
   * Returns 0 on WebGPU (not applicable; upload path uses PlayCanvas abstraction).
   */
  getInternalFormat(format: TextureFormat): number {
    if (this._isWebGpu) return 0;

    const f = this.extFormats;
    switch (format) {
      case TextureFormat.BC1_RGB:    return f.COMPRESSED_RGB_S3TC_DXT1_EXT   ?? 0;
      case TextureFormat.BC1_RGBA:   return f.COMPRESSED_RGBA_S3TC_DXT1_EXT  ?? 0;
      case TextureFormat.BC3_RGBA:   return f.COMPRESSED_RGBA_S3TC_DXT5_EXT  ?? 0;
      case TextureFormat.BC4_R:      return f.COMPRESSED_RED_RGTC1_EXT       ?? 0;
      case TextureFormat.BC5_RG:     return f.COMPRESSED_RED_GREEN_RGTC2_EXT ?? 0;
      case TextureFormat.BC7_RGBA:   return f.COMPRESSED_RGBA_BPTC_UNORM_EXT ?? 0;
      case TextureFormat.ETC1_RGB:   return f.COMPRESSED_RGB_ETC1_WEBGL      ?? 0;
      case TextureFormat.ETC2_RGB:   return f.COMPRESSED_RGB8_ETC2           ?? 0;
      case TextureFormat.ETC2_RGBA:  return f.COMPRESSED_RGBA8_ETC2_EAC      ?? 0;
      case TextureFormat.ETC2_RGBA1: return f.COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2 ?? 0;
      case TextureFormat.ASTC_4x4:   return f.COMPRESSED_RGBA_ASTC_4x4_KHR  ?? 0;
      case TextureFormat.ASTC_6x6:   return f.COMPRESSED_RGBA_ASTC_6x6_KHR  ?? 0;
      case TextureFormat.ASTC_8x8:   return f.COMPRESSED_RGBA_ASTC_8x8_KHR  ?? 0;
      case TextureFormat.PVRTC1_4_RGB:  return f.COMPRESSED_RGB_PVRTC_4BPPV1_IMG  ?? 0;
      case TextureFormat.PVRTC1_4_RGBA: return f.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG ?? 0;
      case TextureFormat.RGBA8:       return f.RGBA         ?? 0x1908;
      case TextureFormat.SRGB8_ALPHA8:return f.SRGB8_ALPHA8 ?? 0x8C43;
      default: return 0;
    }
  }

  logCapabilities(): void {
    const caps = this.capabilities;
    console.log(`[GPU] Device: ${this._isWebGpu ? 'WebGPU' : 'WebGL2'}`);
    console.log('[GPU] Compressed Texture Support:');
    console.log('  Desktop:');
    console.log('    S3TC (BC1-BC3):   ', caps.s3tc     ? '✅' : '❌');
    console.log('    S3TC sRGB:        ', caps.s3tc_srgb ? '✅' : '❌');
    console.log('    BPTC (BC6H/BC7):  ', caps.bptc     ? '✅' : '❌');
    console.log('    RGTC (BC4/BC5):   ', caps.rgtc     ? '✅' : '❌');
    console.log('  Mobile:');
    console.log('    ETC1:             ', caps.etc1      ? '✅' : '❌');
    console.log('    ETC2/EAC:         ', caps.etc       ? '✅' : '❌');
    console.log('    ASTC:             ', caps.astc      ? '✅' : '❌');
    console.log('    PVRTC:            ', caps.pvrtc     ? '✅' : '❌');
    console.log('[GPU] Best format (RGB): ', this.getBestFormat(false, false));
    console.log('[GPU] Best format (RGBA):', this.getBestFormat(true,  false));
  }
}

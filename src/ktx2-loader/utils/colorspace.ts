/**
 * DFD (Data Format Descriptor) parsing utilities
 * Based on KTX2 specification
 */

import type { Ktx2ColorSpace } from '../types';

// Khronos Data Format constants
const KHR_DF_TRANSFER_LINEAR = 1;
const KHR_DF_TRANSFER_SRGB = 2;
const KHR_DF_PRIMARIES_BT709 = 1;

const TRANSFER_FUNCTION_NAMES: Record<number, string> = {
  1: 'Linear',
  2: 'sRGB',
  3: 'ITU',
  4: 'NTSC',
  5: 'S-Log',
  6: 'S-Log2',
};

const PRIMARIES_NAMES: Record<number, string> = {
  1: 'BT.709 (sRGB)',
  2: 'BT.601 (EBU)',
  3: 'BT.601 (SMPTE)',
  4: 'BT.2020',
  10: 'Display P3',
  11: 'Adobe RGB',
};

/**
 * Parse color space information from DFD (Data Format Descriptor)
 * 
 * DFD structure (offset from start of DFD block):
 * +0:  totalSize (uint32)
 * +4:  vendorId + descriptorType (packed uint32)
 * +8:  versionNumber + descriptorBlockSize (packed uint32)
 * +12: colorModel (uint8)
 * +13: colorPrimaries (uint8)
 * +14: transferFunction (uint8)
 * +15: flags (uint8)
 * 
 * @param dfd DFD data block
 * @param verbose Enable verbose logging
 */
export function parseDFDColorSpace(
  dfd: Uint8Array,
  verbose = false
): Ktx2ColorSpace {
  if (!dfd || dfd.length < 44) {
    if (verbose) {
      console.warn('[DFD] Insufficient data for parsing');
    }
    return {
      isSrgb: false,
      transferFunction: 'unknown',
      transferFunctionCode: 0,
      primaries: 'unknown',
      primariesCode: 0,
      colorModel: 0,
      flags: 0,
      recommendedPixelFormat: 'RGBA8',
    };
  }

  try {
    const view = new DataView(dfd.buffer, dfd.byteOffset, dfd.byteLength);

    // Read header
    const totalSize = view.getUint32(0, true);
    const vendorId = view.getUint32(4, true);
    const descriptorType = view.getUint32(8, true);

    // Read color space info
    const colorModel = view.getUint8(12);
    const colorPrimaries = view.getUint8(13);
    const transferFunction = view.getUint8(14);
    const flags = view.getUint8(15);

    const isSrgb = transferFunction === KHR_DF_TRANSFER_SRGB;
    const isLinear = transferFunction === KHR_DF_TRANSFER_LINEAR;

    const transferName = TRANSFER_FUNCTION_NAMES[transferFunction] || `Unknown (${transferFunction})`;
    const primariesName = PRIMARIES_NAMES[colorPrimaries] || `Unknown (${colorPrimaries})`;

    if (verbose) {
      console.log('[DFD] Color Space Info:', {
        vendorId: vendorId === 0 ? 'Khronos' : `0x${vendorId.toString(16)}`,
        descriptorType,
        colorModel,
        transferFunction: `${transferFunction} (${transferName})`,
        colorPrimaries: `${colorPrimaries} (${primariesName})`,
        isSrgb,
        isLinear,
      });
    }

    return {
      isSrgb,
      isLinear,
      transferFunction: transferName,
      transferFunctionCode: transferFunction,
      primaries: primariesName,
      primariesCode: colorPrimaries,
      colorModel,
      flags,
      recommendedPixelFormat: isSrgb ? 'SRGBA8' : 'RGBA8',
    };
  } catch (error) {
    console.error('[DFD] Parse error:', error);
    return {
      isSrgb: false,
      transferFunction: 'error',
      transferFunctionCode: 0,
      primaries: 'error',
      primariesCode: 0,
      colorModel: 0,
      flags: 0,
      recommendedPixelFormat: 'RGBA8',
    };
  }
}

/**
 * Validate DFD structure
 */
export function validateDFD(dfd: Uint8Array): boolean {
  if (!dfd || dfd.length < 44) {
    return false;
  }

  const view = new DataView(dfd.buffer, dfd.byteOffset, dfd.byteLength);
  const totalSize = view.getUint32(0, true);

  // Total size should match or be less than actual data
  if (totalSize > dfd.length) {
    return false;
  }

  return true;
}
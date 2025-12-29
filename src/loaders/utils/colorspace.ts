/**
 * DFD (Data Format Descriptor) parsing utilities
 * Based on KTX2 specification
 */

import type { Ktx2ColorSpace } from '../ktx2-types';

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
 * +16+: sample information (16 bytes per sample)
 *
 * Sample structure:
 * +0: bitOffset (uint16)
 * +2: bitLength (uint8)
 * +3: channelType (uint8) - 0=Red, 1=Green, 2=Blue, 15=Alpha
 * ...
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
      hasAlpha: false,
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

    // Detect alpha channel from sample information
    // Samples start at offset 16, each sample is 16 bytes
    // ChannelType: 0=Red, 1=Green, 2=Blue, 15=Alpha
    let hasAlpha = false;
    const numSamples = Math.floor((dfd.length - 16) / 16);
    for (let i = 0; i < numSamples; i++) {
      const sampleOffset = 16 + (i * 16);
      if (sampleOffset + 4 <= dfd.length) {
        const channelType = view.getUint8(sampleOffset + 3);
        if (channelType === 15) { // Alpha channel
          hasAlpha = true;
          break;
        }
      }
    }

    if (verbose) {
      console.log('[DFD] Color Space Info:', {
        vendorId: vendorId === 0 ? 'Khronos' : `0x${vendorId.toString(16)}`,
        descriptorType,
        colorModel,
        transferFunction: `${transferFunction} (${transferName})`,
        colorPrimaries: `${colorPrimaries} (${primariesName})`,
        isSrgb,
        isLinear,
        hasAlpha,
        numSamples,
      });
    }

    return {
      isSrgb,
      isLinear,
      hasAlpha,
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
      hasAlpha: false,
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
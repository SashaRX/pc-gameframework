/* global pc */

var Ktx2ProgressiveVanilla = pc.createScript('Ktx2ProgressiveVanilla');

// --- Атрибуты ---
Ktx2ProgressiveVanilla.attributes.add('libktxJs', { title: 'libktx.js', type: 'asset', assetType: 'script' });
Ktx2ProgressiveVanilla.attributes.add('libktxWasm', { title: 'libktx.wasm', type: 'asset' });
Ktx2ProgressiveVanilla.attributes.add('ktxUrl', { title: 'KTX2 URL', type: 'string', default: '' });
Ktx2ProgressiveVanilla.attributes.add('progressive', { type: 'boolean', default: true });
Ktx2ProgressiveVanilla.attributes.add('isSrgb', { title: 'sRGB (Albedo)', type: 'boolean', default: false });
Ktx2ProgressiveVanilla.attributes.add('stepDelayMs', { title: 'Delay between steps (ms)', type: 'number', default: 150 });
Ktx2ProgressiveVanilla.attributes.add('verbose', { type: 'boolean', default: true });
Ktx2ProgressiveVanilla.attributes.add('maxRgbaBytes', { title: 'Max RGBA bytes', type: 'number', default: 67108864 });
Ktx2ProgressiveVanilla.attributes.add('enableAniso', { title: 'Enable Anisotropy (if available)', type: 'boolean', default: true });
Ktx2ProgressiveVanilla.attributes.add('adaptiveLoading', { title: 'Adaptive Loading (stop at screen resolution)', type: 'boolean', default: false });
Ktx2ProgressiveVanilla.attributes.add('adaptiveMargin', { title: 'Adaptive Margin (multiplier)', type: 'number', default: 1.5, description: 'Load mips N times larger than screen size' });
Ktx2ProgressiveVanilla.attributes.add('adaptiveUpdateInterval', { title: 'Adaptive Update Check Interval (s)', type: 'number', default: 0.5, description: 'How often to check if more detail is needed' });

// --- Callbacks ---
Ktx2ProgressiveVanilla.attributes.add('onProgressCallback', { title: 'Progress Callback Name', type: 'string', default: '', description: 'Function name: onProgress(level, totalLevels, mipInfo)' });
Ktx2ProgressiveVanilla.attributes.add('onCompleteCallback', { title: 'Complete Callback Name', type: 'string', default: '', description: 'Function name: onComplete(stats)' });

// --- Web Worker ---
Ktx2ProgressiveVanilla.attributes.add('useWorker', { title: 'Use Web Worker for transcode', type: 'boolean', default: true, description: 'Offload transcoding to background thread' });
Ktx2ProgressiveVanilla.attributes.add('workerScript', { title: 'Worker Script', type: 'asset', assetType: 'script', description: 'Ktx2TranscodeWorker.js' });
Ktx2ProgressiveVanilla.attributes.add('minFrameInterval', { title: 'Min Frame Interval (ms)', type: 'number', default: 16, description: 'Minimum time between mip loads to maintain framerate (~60fps = 16ms)' });

// --- Кеш модуля ---
if (!window.__KTX_MODULE_STATE) {
    window.__KTX_MODULE_STATE = { promise: null, instance: null };
}

// --- Utils ---
function readU64asNumber(view, off) {
    const lo = view.getUint32(off, true);
    const hi = view.getUint32(off + 4, true);
    return lo + hi * 4294967296;
}
function writeU64(view, off, value) {
    const lo = value >>> 0;
    const hi = Math.floor(value / 4294967296) >>> 0;
    view.setUint32(off, lo, true);
    view.setUint32(off + 4, hi, true);
}
function align(n, a) { return (n + (a - 1)) & ~(a - 1); }

// --- Parse DFD Color Space ---
Ktx2ProgressiveVanilla.prototype._parseDFDColorSpace = function(dfd) {
    if (!dfd || dfd.length < 44) {
        if (this.verbose) console.warn('[DFD] Недостаточно данных для парсинга');
        return { isSrgb: false, transferFunction: 'unknown', primaries: 'unknown' };
    }

    const view = new DataView(dfd.buffer, dfd.byteOffset, dfd.byteLength);
    
    try {
        const totalSize = view.getUint32(0, true);
        const vendorId = view.getUint32(4, true);
        const descriptorType = view.getUint32(8, true);
        
        const colorModel = view.getUint8(12);
        const colorPrimaries = view.getUint8(13);
        const transferFunction = view.getUint8(14);
        const flags = view.getUint8(15);
        
        const KHR_DF_TRANSFER_LINEAR = 1;
        const KHR_DF_TRANSFER_SRGB = 2;
        const KHR_DF_PRIMARIES_BT709 = 1;
        
        const isSrgb = transferFunction === KHR_DF_TRANSFER_SRGB;
        const isLinear = transferFunction === KHR_DF_TRANSFER_LINEAR;
        
        const transferNames = {
            1: 'Linear',
            2: 'sRGB',
            3: 'ITU',
            4: 'NTSC',
            5: 'S-Log',
            6: 'S-Log2'
        };
        
        const primariesNames = {
            1: 'BT.709 (sRGB)',
            2: 'BT.601 (EBU)',
            3: 'BT.601 (SMPTE)',
            4: 'BT.2020',
            10: 'Display P3',
            11: 'Adobe RGB'
        };
        
        const transferName = transferNames[transferFunction] || `Unknown (${transferFunction})`;
        const primariesName = primariesNames[colorPrimaries] || `Unknown (${colorPrimaries})`;
        
        if (this.verbose) {
            console.log('[DFD] Color Space Info:', {
                vendorId: vendorId === 0 ? 'Khronos' : `0x${vendorId.toString(16)}`,
                descriptorType,
                colorModel,
                transferFunction: `${transferFunction} (${transferName})`,
                colorPrimaries: `${colorPrimaries} (${primariesName})`,
                isSrgb,
                isLinear
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
            recommendedPixelFormat: isSrgb ? 'SRGBA8' : 'RGBA8'
        };
        
    } catch (error) {
        console.error('[DFD] Ошибка парсинга:', error);
        return {
            isSrgb: false,
            transferFunction: 'error',
            primaries: 'error',
            error: error.message
        };
    }
};

// --- Shader chunk для LOD ---
Ktx2ProgressiveVanilla.prototype._createShaderChunk = function() {
    const device = this.app.graphicsDevice;
    const chunks = pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_GLSL);
    
    chunks.set('diffusePS', `
// diffusePS — анизотропия сохраняется, LOD клампится в [min,max]
uniform sampler2D texture_diffuseMap;
uniform float material_minAvailableLod; // min LOD, = BASE_LEVEL
uniform float material_maxAvailableLod; // max LOD, = MAX_LEVEL

void getAlbedo() {
    dAlbedo = vec3(1.0);
    #ifdef STD_DIFFUSE_TEXTURE
        vec2 uv = {STD_DIFFUSE_TEXTURE_UV};
        
        // Производные в нормализованных UV
        vec2 dudx = dFdx(uv);
        vec2 dudy = dFdy(uv);
        
        // Оценка auto-LOD
        vec2 texSize = vec2(textureSize(texture_diffuseMap, 0));
        float rho2 = max(dot(dudx * texSize, dudx * texSize),
                         dot(dudy * texSize, dudy * texSize));
        float autoLod = 0.5 * log2(rho2);
        
        // Клампим в доступное окно
        float targetLod = clamp(autoLod, 
                                material_minAvailableLod, 
                                material_maxAvailableLod);
        
        // Масштабируем производные
        float scale = exp2(targetLod - autoLod);
        
        // Аппаратная анизотропия + трилинеар
        dAlbedo = textureGrad(texture_diffuseMap, uv, 
                             dudx * scale, dudy * scale).rgb;
    #endif
    
    #ifdef STD_DIFFUSE_CONSTANT
        dAlbedo *= material_diffuse.rgb;
    #endif
}
`);
    
    if (this.verbose) console.log('[KTX] Custom shader chunk registered');
};

// --- Инициализация ---
Ktx2ProgressiveVanilla.prototype.initialize = function () {
    const self = this;
    this._activeTexture = null;
    this._probeData = null;  // Результат probe (не конфликтует с методом _probe)
    this._currentTargetLod = undefined;
    this._lastUpdateCheck = 0;
    this._worker = null;
    this._workerReady = false;
    this._workerPendingCallbacks = new Map();
    this._workerMessageId = 0;
    
    if (this.verbose) console.log('>>> Progressive KTX2 with Adaptive LOD start');

    if (!(Number(this.maxRgbaBytes) > 0)) {
        this.maxRgbaBytes = 67108864;
    }

    // Регистрируем shader chunk
    this._createShaderChunk();

    const ensureFactory = () => new Promise((resolve, reject) => {
        if (typeof createKtxModule === 'function') return resolve();
        if (self.libktxJs && !window.__KTX_SCRIPT_TAG) {
            const url = self.libktxJs.getFileUrl();
            const tag = document.createElement('script');
            tag.src = url; tag.async = true;
            tag.onload = () => {
                window.__KTX_SCRIPT_TAG = true;
                if (typeof createKtxModule === 'function') resolve();
                else reject(new Error('createKtxModule не найден'));
            };
            tag.onerror = () => reject(new Error('Не удалось загрузить libktx.js'));
            document.head.appendChild(tag);
            return;
        }
        let tries = 0;
        const iv = setInterval(() => {
            tries++;
            if (typeof createKtxModule === 'function') { clearInterval(iv); resolve(); }
            else if (tries > 50) { clearInterval(iv); reject(new Error('createKtxModule таймаут')); }
        }, 50);
    });

    const initKtx = () => {
        if (window.__KTX_MODULE_STATE.instance) {
            self.ktx = window.__KTX_MODULE_STATE.instance;
            if (self.verbose) console.log('[KTX] Module ready (cached)');
            return Promise.resolve(self.ktx);
        }
        if (window.__KTX_MODULE_STATE.promise) {
            return window.__KTX_MODULE_STATE.promise.then(m => {
                self.ktx = m;
                return m;
            });
        }
        const wasmUrl = (self.libktxWasm && self.libktxWasm.getFileUrl) ? self.libktxWasm.getFileUrl() : null;
        if (self.verbose && wasmUrl) console.log('[KTX] locateFile -> libktx.wasm =>', wasmUrl);
        
        const opts = { locateFile: (path) => wasmUrl || path };
        const p = createKtxModule(opts).then((M) => {
            window.__KTX_MODULE_STATE.instance = M;
            self.ktx = M;
            const api = {
                malloc:  M.cwrap('malloc', 'number', ['number']),
                free:    M.cwrap('free', null, ['number']),
                createFromMemory:  M.cwrap('ktxTexture2_CreateFromMemory', 'number', ['number','number','number','number']),
                destroy: M.cwrap('ktxTexture2_Destroy', null, ['number']),
                transcode: M.cwrap('ktxTexture2_TranscodeBasis', 'number', ['number','number','number']),
                needsTranscoding: M.cwrap('ktxTexture2_NeedsTranscoding', 'number', ['number']),
                getData: M.cwrap('ktx_get_data', 'number', ['number']),
                getDataSize: M.cwrap('ktx_get_data_size', 'number', ['number']),
                getWidth: M.cwrap('ktx_get_base_width', 'number', ['number']),
                getHeight: M.cwrap('ktx_get_base_height', 'number', ['number']),
                getLevels: M.cwrap('ktx_get_num_levels', 'number', ['number']),
                getOffset: M.cwrap('ktx_get_image_offset', 'number', ['number','number','number','number']),
                errorString: M.cwrap('ktxErrorString', 'string', ['number']),
                heapU8: M.HEAPU8
            };
            M.api = api;
            if (self.verbose) console.log('[KTX] API ready:', Object.keys(api));
            if (self.verbose) console.log('[KTX] Module initialized');
            return M;
        });
        window.__KTX_MODULE_STATE.promise = p;
        return p;
    };

    ensureFactory().then(initKtx).then(async () => {
        // Инициализируем Worker если включен
        if (this.useWorker) {
            await this._initWorker();
        }
        
        if (this.ktx && this.ktxUrl && this.progressive) {
            this.progressiveLoadToEntity(this.entity);
        }
    }).catch(err => console.error('[KTX] init failed:', err));
};

// --- HEAD Request для проверки Range support ---
Ktx2ProgressiveVanilla.prototype._fetchWithHead = async function(url) {
    try {
        const headResp = await fetch(url, { method: 'HEAD' });
        
        if (!headResp.ok) {
            console.warn('[KTX] HEAD request failed:', headResp.status, headResp.statusText);
            return { totalSize: 0, supportsRanges: false };
        }
        
        const contentLength = headResp.headers.get('Content-Length');
        const acceptRanges = headResp.headers.get('Accept-Ranges');
        
        const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
        const supportsRanges = acceptRanges === 'bytes';
        
        if (this.verbose) {
            console.log('[KTX] HEAD response:', {
                totalSize,
                supportsRanges,
                contentType: headResp.headers.get('Content-Type'),
                server: headResp.headers.get('Server')
            });
        }
        
        return { totalSize, supportsRanges };
        
    } catch (error) {
        console.warn('[KTX] HEAD request error:', error.message);
        return { totalSize: 0, supportsRanges: false };
    }
};

// --- Fetch Range ---
Ktx2ProgressiveVanilla.prototype._fetchRange = async function (url, start, endInclusive) {
    const res = await fetch(url, { headers: { 'Range': `bytes=${start}-${endInclusive}` } });
    
    if (!(res.status === 206 || res.status === 200)) {
        throw new Error(`[KTX] Range request failed: HTTP ${res.status} ${res.statusText}`);
    }
    
    // Проверяем Content-Range header для 206 ответов
    if (res.status === 206) {
        const contentRange = res.headers.get('Content-Range');
        if (this.verbose && contentRange) {
            console.log(`[KTX] Content-Range: ${contentRange}`);
        }
    }
    
    const ab = await res.arrayBuffer();
    const expectedSize = endInclusive - start + 1;
    
    if (res.status === 200) {
        // Сервер вернул весь файл вместо range
        console.warn('[KTX] Server returned full file (200) instead of range (206)');
        const full = new Uint8Array(ab);
        const s = Math.max(0, start|0);
        const e = Math.max(s, (endInclusive|0) + 1);
        return full.subarray(s, e).slice(0);
    }
    
    // 206 Partial Content
    const result = new Uint8Array(ab);
    
    if (result.byteLength !== expectedSize) {
        console.warn(`[KTX] Range size mismatch: expected ${expectedSize}, got ${result.byteLength}`);
    }
    
    return result;
};

// --- Probe ---
Ktx2ProgressiveVanilla.prototype._probe = async function (url) {
    // Шаг 1: HEAD запрос для получения размера файла и проверки Range support
    const { totalSize, supportsRanges } = await this._fetchWithHead(url);
    
    if (!supportsRanges) {
        console.warn('[KTX] Server does not support Range requests - progressive loading may be inefficient');
    }
    
    // Шаг 2: Загружаем header (80 байт)
    const head = await this._fetchRange(url, 0, 79);
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);

    const headerSize = 80;
    const levelCount = dv.getUint32(0x28, true);
    
    const pixelWidth  = dv.getUint32(0x14, true);
    const pixelHeight = dv.getUint32(0x18, true);
    const pixelDepth  = dv.getUint32(0x1C, true);
    const layerCount  = dv.getUint32(0x20, true);
    const faceCount   = dv.getUint32(0x24, true);

    const dfdOff = dv.getUint32(0x30, true);
    const dfdLen = dv.getUint32(0x34, true);
    const kvdOff = dv.getUint32(0x38, true);
    const kvdLen = dv.getUint32(0x3C, true);
    const sgdOff = readU64asNumber(dv, 0x40);
    const sgdLen = readU64asNumber(dv, 0x48);

    if (this.verbose) {
        console.log('[KTX] Header SGD info:', {
            sgdOffset: sgdOff,
            sgdLength: sgdLen,
            dfdOffset: dfdOff,
            dfdLength: dfdLen,
            kvdOffset: kvdOff,
            kvdLength: kvdLen
        });
    }

    const levelIndexSize = 24 * levelCount;
    const prefaceEnd = (headerSize + levelIndexSize) - 1;

    const lastEnd = (sgdOff && sgdLen) ? (sgdOff + sgdLen - 1)
                  : (kvdOff && kvdLen) ? (kvdOff + kvdLen - 1)
                  : (dfdOff && dfdLen) ? (dfdOff + dfdLen - 1)
                  : prefaceEnd;
    const meta = await this._fetchRange(url, 0, Math.max(lastEnd, prefaceEnd));

    if (this.verbose) {
        console.log('[KTX] Fetched metadata:', {
            metaSize: meta.byteLength,
            lastEnd: lastEnd,
            prefaceEnd: prefaceEnd,
            fetchedUpTo: Math.max(lastEnd, prefaceEnd)
        });
    }

    const levelIndexStart = headerSize;
    const view = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
    const levels = [];
    for (let i = 0; i < levelCount; i++) {
        const base = levelIndexStart + i * 24;
        const byteOffset = readU64asNumber(view, base + 0);
        const byteLength = readU64asNumber(view, base + 8);
        const uncmpLen  = readU64asNumber(view, base + 16);
        levels.push({ byteOffset, byteLength, uncompressedByteLength: uncmpLen });
    }
    
    if (this.verbose && levels.length > 0) {
        console.log('[KTX] Level Index (first 3):');
        for (let i = 0; i < Math.min(3, levels.length); i++) {
            console.log(`  Level ${i}: offset=${levels[i].byteOffset} len=${levels[i].byteLength} uncmp=${levels[i].uncompressedByteLength}`);
        }
        if (levels.length > 3) {
            console.log('[KTX] Level Index (last 3):');
            for (let i = Math.max(0, levels.length - 3); i < levels.length; i++) {
                console.log(`  Level ${i}: offset=${levels[i].byteOffset} len=${levels[i].byteLength} uncmp=${levels[i].uncompressedByteLength}`);
            }
        }
    }

    const slice = (off, len) => (len ? meta.subarray(off, off + len) : new Uint8Array(0));
    const dfd = slice(dfdOff, dfdLen);
    const kvd = slice(kvdOff, kvdLen);
    const sgd = slice(sgdOff, sgdLen);

    if (this.verbose) {
        console.log('[KTX] Extracted sections:', {
            dfdSize: dfd.byteLength,
            kvdSize: kvd.byteLength,
            sgdSize: sgd.byteLength
        });
    }

    const width  = pixelWidth;
    const height = pixelHeight;

    if (this.verbose) console.log(`[KTX] Probe: levels=${levelCount} width=${width} height=${height}`);

    const colorSpace = this._parseDFDColorSpace(dfd);

    return {
        url,
        totalSize,
        supportsRanges,
        headerSize,
        headerBytes: meta.subarray(0, headerSize),
        levelCount,
        layerCount,
        faceCount,
        pixelDepth,
        levelIndexSize,
        levels,
        dfd, kvd, sgd,
        dfdOff, dfdLen, kvdOff, kvdLen, sgdOff, sgdLen,
        width, height,
        colorSpace
    };
};

// --- Repack ---
Ktx2ProgressiveVanilla.prototype._repackSingleLevel = function (probe, levelIdx, levelPayload) {
    const h = probe.headerBytes.slice(0);
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);

    const w0 = Math.max(1, probe.width  >>> levelIdx);
    const h0 = Math.max(1, probe.height >>> levelIdx);
    dv.setUint32(0x14, w0, true);
    dv.setUint32(0x18, h0, true);
    dv.setUint32(0x28, 1,  true);

    const headerView = new DataView(probe.headerBytes.buffer, probe.headerBytes.byteOffset, probe.headerBytes.byteLength);
    const scheme = headerView.getUint32(0x2C, true);
    const isETC1S = (scheme === 1);

    const liSize = 24;
    let off = 80 + liSize;

    let dfdOff = 0, dfdLen = probe.dfd.byteLength;
    if (dfdLen > 0) { off = align(off, 4); dfdOff = off; off += dfdLen; }

    let kvdOff = 0, kvdLen = probe.kvd.byteLength;
    if (kvdLen > 0) { off = align(off, 4); kvdOff = off; off += kvdLen; }

    let sgdData = probe.sgd;
    if (isETC1S && probe.sgd.byteLength > 0) {
        sgdData = this._repackSgdForLevel(
            probe.sgd, 
            levelIdx, 
            probe.levelCount,
            probe.layerCount || 0,
            probe.faceCount || 1,
            probe.pixelDepth || 0
        );
    }
    
    let sgdOff = 0, sgdLen = sgdData.byteLength;
    if (sgdLen > 0) { off = align(off, 8); sgdOff = off; off += sgdLen; }

    off = align(off, 8);
    const dataOff = off;
    const dataLen = levelPayload.byteLength;

    dv.setUint32(0x30, dfdOff, true); dv.setUint32(0x34, dfdLen, true);
    dv.setUint32(0x38, kvdOff, true); dv.setUint32(0x3C, kvdLen, true);
    writeU64(dv, 0x40, sgdOff);
    writeU64(dv, 0x48, sgdLen);

    const li = new Uint8Array(liSize); const liv = new DataView(li.buffer);
    const src = probe.levels[levelIdx];
    writeU64(liv, 0,  dataOff);
    writeU64(liv, 8,  dataLen);
    
    let ubl = 0;
    if (scheme === 0) {
        ubl = dataLen;
    } else if (scheme === 2) {
        ubl = (src.uncompressedByteLength >>> 0) || 0;
    } else {
        ubl = 0;
    }
    writeU64(liv, 16, ubl);

    const total = align(dataOff + dataLen, 8);
    const out = new Uint8Array(total);
    let p = 0;

    out.set(h, p);  p += h.length;
    out.set(li, p); p += li.length;

    if (dfdLen) { p = align(p, 4); out.set(probe.dfd, p); p += dfdLen; }
    if (kvdLen) { p = align(p, 4); out.set(probe.kvd, p); p += kvdLen; }
    if (sgdLen) { p = align(p, 8); out.set(sgdData, p); p += sgdLen; }
    p = align(p, 8); out.set(levelPayload, p); p += dataLen;

    if (this.verbose && levelIdx >= 10) {
        console.log(`[KTX] Repack Level ${levelIdx}:`, {
            miniSize: out.byteLength,
            sgdPresent: sgdLen > 0,
            sgdSize: sgdLen,
            sgdOffset: sgdOff,
            payloadSize: dataLen,
            payloadOffset: dataOff,
            scheme: scheme,
            isETC1S: isETC1S,
            uncompressedByteLength: ubl
        });
    }

    return out;
};

Ktx2ProgressiveVanilla.prototype._imagesPerLevel = function(levelIdx, pixelDepth, layerCount, faceCount) {
    const depthAtLevel = Math.max(1, (pixelDepth|0) >>> levelIdx);
    const layers = Math.max(1, layerCount|0);
    return layers * Math.max(1, faceCount|0) * depthAtLevel;
};

Ktx2ProgressiveVanilla.prototype._repackSgdForLevel = function(sgdFull, levelIdx, origLevelCount, layerCount, faceCount, pixelDepth) {
    if (!sgdFull || !sgdFull.byteLength) return new Uint8Array(0);
    
    const dv = new DataView(sgdFull.buffer, sgdFull.byteOffset, sgdFull.byteLength);
    const headerSize = 20;
    const endpointsByteLength = dv.getUint32(4, true);
    const selectorsByteLength = dv.getUint32(8, true);
    const tablesByteLength    = dv.getUint32(12, true);
    const extendedByteLength  = dv.getUint32(16, true);

    let imageCountFull = 0;
    for (let p = 0; p < Math.max(1, origLevelCount); p++) {
        imageCountFull += this._imagesPerLevel(p, pixelDepth, layerCount, faceCount);
    }
    
    const imageDescSize = 20;
    const imageDescsStart = headerSize;
    const codebooksOffsetFull = imageDescsStart + imageCountFull * imageDescSize;

    let startIndex = 0;
    for (let p = 0; p < levelIdx; p++) {
        startIndex += this._imagesPerLevel(p, pixelDepth, layerCount, faceCount);
    }
    const levelCountImgs = this._imagesPerLevel(levelIdx, pixelDepth, layerCount, faceCount);

    const srcDescStart = imageDescsStart + startIndex * imageDescSize;
    const srcDescEnd   = srcDescStart + levelCountImgs * imageDescSize;
    const singleLevelDescs = sgdFull.subarray(srcDescStart, srcDescEnd);

    const codebooksSize = endpointsByteLength + selectorsByteLength + tablesByteLength + extendedByteLength;
    const newSgdSize = headerSize + singleLevelDescs.byteLength + codebooksSize;
    const newSgd = new Uint8Array(newSgdSize);

    newSgd.set(sgdFull.subarray(0, headerSize), 0);
    newSgd.set(singleLevelDescs, headerSize);
    const codebooksSrc = sgdFull.subarray(codebooksOffsetFull, codebooksOffsetFull + codebooksSize);
    newSgd.set(codebooksSrc, headerSize + singleLevelDescs.byteLength);

    if (this.verbose) {
        console.log(`[KTX] SGD sliced for L${levelIdx}: ${levelCountImgs} imgs (of ${imageCountFull} total), ${sgdFull.byteLength}→${newSgdSize} bytes`);
    }
    
    return newSgd;
};

// --- Transcode ---
Ktx2ProgressiveVanilla.prototype._transcodeToRgba = function (ktxBuf) {
    const ktx = this.ktx;
    const api = ktx.api;

    const src = ktxBuf instanceof Uint8Array ? ktxBuf : new Uint8Array(ktxBuf.slice(0));
    const ptr = api.malloc(src.byteLength);
    ktx.HEAPU8.set(src, ptr);

    const outPtrPtr = api.malloc(4);
    const rc = api.createFromMemory(ptr, src.byteLength, 0, outPtrPtr);
    if (rc) {
        const msg = api.errorString ? api.errorString(rc) : '';
        api.free(outPtrPtr);
        api.free(ptr);
        throw new Error(`CreateFromMemory rc=${rc} ${msg}`);
    }

    const texPtr = ktx.getValue(outPtrPtr, '*');
    api.free(outPtrPtr);

    const need = api.needsTranscoding(texPtr);
    if (need) {
        const KTX_TTF_RGBA32 = 13;
        const rcT = api.transcode(texPtr, KTX_TTF_RGBA32, 0);
        if (rcT) {
            const msg = api.errorString ? api.errorString(rcT) : '';
            api.destroy(texPtr);
            api.free(ptr);
            throw new Error(`Transcode rc=${rcT} ${msg}`);
        }
    }

    const dataPtr  = api.getData(texPtr);
    const baseW    = api.getWidth(texPtr);
    const baseH    = api.getHeight(texPtr);
    const dataSize = api.getDataSize(texPtr);
    const expected = baseW * baseH * 4;
    const total = Math.min(expected, dataSize);
    
    const rgbaCopy = new Uint8Array(total);
    const CHUNK_SIZE = 1048576;
    
    for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
        const size = Math.min(CHUNK_SIZE, total - offset);
        const chunk = ktx.HEAPU8.subarray(dataPtr + offset, dataPtr + offset + size);
        rgbaCopy.set(chunk, offset);
    }
    
    api.destroy(texPtr);
    api.free(ptr);

    if (this.verbose) console.log(`[KTX] Transcoded ${baseW}x${baseH} (${total} bytes)`);
    
    return { width: baseW, height: baseH, data: rgbaCopy };
};

// --- Callback Helpers ---
Ktx2ProgressiveVanilla.prototype._fireProgress = function(level, totalLevels, mipInfo) {
    if (!this.onProgressCallback) return;
    
    try {
        const callbackFn = this.entity[this.onProgressCallback] || window[this.onProgressCallback];
        if (typeof callbackFn === 'function') {
            callbackFn.call(this.entity, level, totalLevels, mipInfo);
        }
    } catch(e) {
        console.error('[KTX] Progress callback error:', e);
    }
};

Ktx2ProgressiveVanilla.prototype._fireComplete = function(stats) {
    if (!this.onCompleteCallback) return;
    
    try {
        const callbackFn = this.entity[this.onCompleteCallback] || window[this.onCompleteCallback];
        if (typeof callbackFn === 'function') {
            callbackFn.call(this.entity, stats);
        }
    } catch(e) {
        console.error('[KTX] Complete callback error:', e);
    }
};

// --- Web Worker Methods ---
Ktx2ProgressiveVanilla.prototype._initWorker = async function() {
    if (!this.useWorker || !this.workerScript) {
        if (this.verbose) console.log('[KTX] Worker disabled or not configured');
        return false;
    }
    
    try {
        const workerUrl = this.workerScript.getFileUrl();
        this._worker = new Worker(workerUrl);
        
        // Настраиваем обработчик сообщений
        this._worker.onmessage = (e) => {
            const { type, success, messageId } = e.data;
            
            if (messageId !== undefined && this._workerPendingCallbacks.has(messageId)) {
                const callback = this._workerPendingCallbacks.get(messageId);
                this._workerPendingCallbacks.delete(messageId);
                
                if (success) {
                    callback.resolve(e.data);
                } else {
                    callback.reject(new Error(e.data.error || 'Worker error'));
                }
            } else if (type === 'init') {
                this._workerReady = success;
                if (success && this.verbose) {
                    console.log('[KTX] Worker initialized');
                }
            }
        };
        
        this._worker.onerror = (error) => {
            console.error('[KTX] Worker error:', error);
            this._workerReady = false;
        };
        
        // Загружаем libktx.js как текст
        const libktxUrl = this.libktxJs ? this.libktxJs.getFileUrl() : null;
        if (!libktxUrl) {
            throw new Error('libktx.js URL not available');
        }
        
        if (this.verbose) console.log('[KTX] Fetching libktx.js code...');
        const libktxCodeResponse = await fetch(libktxUrl);
        const libktxCode = await libktxCodeResponse.text();
        
        if (this.verbose) console.log('[KTX] libktx.js code loaded, size:', libktxCode.length, 'bytes');
        
        // Получаем WASM URL
        const wasmUrl = this.libktxWasm ? this.libktxWasm.getFileUrl() : null;
        if (!wasmUrl) {
            throw new Error('libktx.wasm URL not available');
        }
        
        // Инициализируем Worker с кодом и WASM URL
        this._worker.postMessage({
            type: 'init',
            data: { 
                libktxCode: libktxCode,
                wasmUrl: wasmUrl
            }
        });
        
        // Ждем инициализации (с таймаутом 10 секунд для WASM загрузки)
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Worker initialization timeout'));
            }, 10000);
            
            const checkReady = setInterval(() => {
                if (this._workerReady) {
                    clearTimeout(timeout);
                    clearInterval(checkReady);
                    resolve();
                }
            }, 50);
        });
        
        return true;
        
    } catch (error) {
        console.error('[KTX] Worker initialization failed:', error);
        this._worker = null;
        this._workerReady = false;
        return false;
    }
};

Ktx2ProgressiveVanilla.prototype._transcodeInWorker = function(miniKtx) {
    return new Promise((resolve, reject) => {
        if (!this._worker || !this._workerReady) {
            reject(new Error('Worker not ready'));
            return;
        }
        
        const messageId = this._workerMessageId++;
        
        // Сохраняем callback для этого сообщения
        this._workerPendingCallbacks.set(messageId, { resolve, reject });
        
        // Таймаут на транскодирование (30 секунд)
        const timeout = setTimeout(() => {
            if (this._workerPendingCallbacks.has(messageId)) {
                this._workerPendingCallbacks.delete(messageId);
                reject(new Error('Worker transcode timeout'));
            }
        }, 30000);
        
        // Создаем копию для передачи (с transfer ownership)
        const miniCopy = miniKtx.slice(0);
        
        // Отправляем данные в Worker
        this._worker.postMessage({
            type: 'transcode',
            messageId: messageId,
            data: { miniKtx: miniCopy.buffer }
        }, [miniCopy.buffer]);  // Transfer ownership
        
        // Очищаем таймаут при успехе
        const originalResolve = resolve;
        resolve = (data) => {
            clearTimeout(timeout);
            originalResolve(data);
        };
    });
};

Ktx2ProgressiveVanilla.prototype._transcode = async function(miniKtx) {
    // Пытаемся использовать Worker если доступен
    if (this.useWorker && this._worker && this._workerReady) {
        try {
            const result = await this._transcodeInWorker(miniKtx);
            // Восстанавливаем формат как в _transcodeToRgba
            return {
                width: result.width,
                height: result.height,
                data: new Uint8Array(result.data)
            };
        } catch (error) {
            if (this.verbose) {
                console.warn('[KTX] Worker transcode failed, falling back to main thread:', error.message);
            }
            // Fallback на главный поток
        }
    }
    
    // Fallback: транскодирование в главном потоке
    return this._transcodeToRgba(miniKtx);
};

// --- Calculate Required LOD based on screen size ---
Ktx2ProgressiveVanilla.prototype._calculateRequiredLod = function(entity, baseW, baseH, levelCount) {
    if (!this.adaptiveLoading) {
        return 0;
    }
    
    const camera = this.app.root.findByName('Camera')?.camera;
    if (!camera) {
        if (this.verbose) console.warn('[KTX] No camera found, loading all levels');
        return 0;
    }
    
    const model = entity.model;
    if (!model || !model.meshInstances || !model.meshInstances[0]) {
        if (this.verbose) console.warn('[KTX] No mesh instance found, loading all levels');
        return 0;
    }
    
    const aabb = model.meshInstances[0].aabb;
    if (!aabb) {
        if (this.verbose) console.warn('[KTX] No AABB found, loading all levels');
        return 0;
    }
    
    const worldPos = aabb.center;
    const halfExtents = aabb.halfExtents;
    
    const corners = [
        new pc.Vec3(worldPos.x - halfExtents.x, worldPos.y - halfExtents.y, worldPos.z - halfExtents.z),
        new pc.Vec3(worldPos.x + halfExtents.x, worldPos.y + halfExtents.y, worldPos.z + halfExtents.z)
    ];
    
    const screenCorners = corners.map(corner => {
        const screenPos = new pc.Vec3();
        camera.worldToScreen(corner, screenPos);
        return screenPos;
    });
    
    const screenWidth = Math.abs(screenCorners[1].x - screenCorners[0].x);
    const screenHeight = Math.abs(screenCorners[1].y - screenCorners[0].y);
    const screenSize = Math.max(screenWidth, screenHeight);
    
    const targetScreenSize = screenSize * (this.adaptiveMargin || 1.5);
    
    if (this.verbose) {
        console.log('[KTX] Adaptive loading calculation:', {
            screenSize: screenSize.toFixed(1) + 'px',
            withMargin: targetScreenSize.toFixed(1) + 'px',
            baseResolution: `${baseW}x${baseH}`,
            levels: levelCount
        });
    }
    
    let targetLod = 0;
    
    for (let i = levelCount - 1; i >= 0; i--) {
        const mipW = Math.max(1, baseW >>> i);
        const mipH = Math.max(1, baseH >>> i);
        const mipSize = Math.max(mipW, mipH);
        
        if (mipSize >= targetScreenSize) {
            targetLod = i;
            if (this.verbose) {
                console.log(`[KTX] Selected LOD ${i}: ${mipW}x${mipH} (>= ${targetScreenSize.toFixed(1)}px)`);
            }
            break;
        }
    }
    
    if (targetLod === levelCount - 1) {
        if (this.verbose) {
            const mipW = Math.max(1, baseW >>> targetLod);
            const mipH = Math.max(1, baseH >>> targetLod);
            console.log(`[KTX] Object very small (${targetScreenSize.toFixed(1)}px), using smallest mip: ${mipW}x${mipH}`);
        }
    }
    
    if (targetLod === 0 && targetScreenSize > Math.max(baseW, baseH)) {
        if (this.verbose) {
            console.log(`[KTX] Object larger than base texture, loading full resolution`);
        }
    }
    
    return targetLod;
};

// --- Progressive Load ---
Ktx2ProgressiveVanilla.prototype.progressiveLoadToEntity = async function (entity) {
    if (!this.ktx) throw new Error('KTX module not ready');
    if (!this.ktxUrl) throw new Error('ktxUrl пуст');

    // Инициализация статистики загрузки
    const loadStats = {
        startTime: performance.now(),
        endTime: 0,
        totalLevels: 0,
        loadedLevels: 0,
        totalBytes: 0,
        loadedBytes: 0,
        transcodeTimeMs: 0
    };

    const probe = await this._probe(this.ktxUrl);
    const levelCount = probe.levelCount;
    const baseW = probe.width;
    const baseH = probe.height;

    // 🔧 ИСПРАВЛЕНИЕ #2: Сохраняем probe для update()
    this._probeData = probe;  // Используем _probeData вместо _probe

    const targetLod = this._calculateRequiredLod(entity, baseW, baseH, levelCount);
    
    // 🔧 ИСПРАВЛЕНИЕ #2: Сохраняем текущий target LOD
    this._currentTargetLod = targetLod;
    
    // Обновляем статистику
    loadStats.totalLevels = levelCount;
    loadStats.totalBytes = probe.levels.reduce((sum, lvl) => sum + lvl.byteLength, 0);
    
    if (this.verbose && this.adaptiveLoading) {
        console.log(`[KTX] Adaptive loading: will load levels ${levelCount - 1} down to ${targetLod}`);
    }

    const autoDetectedSrgb = probe.colorSpace ? probe.colorSpace.isSrgb : false;
    const useSrgb = (this.isSrgb !== undefined && this.isSrgb !== null) ? this.isSrgb : !!autoDetectedSrgb;

    if (this.verbose) {
        console.log('[KTX] Color Space:', {
            autoDetected: autoDetectedSrgb,
            userOverride: this.isSrgb,
            willUse: useSrgb ? 'sRGB' : 'Linear'
        });
    }

    const format = useSrgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8;
    const tex = new pc.Texture(this.app.graphicsDevice, {
        width: baseW,
        height: baseH,
        format: format,
        mipmaps: true,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: pc.FILTER_LINEAR,
        addressU: pc.ADDRESS_REPEAT,
        addressV: pc.ADDRESS_REPEAT
    });

    {
        const initSize = baseW * baseH * 4;
        const initData = new Uint8Array(initSize);
        for (let i = 0; i < initSize; i += 4) {
            initData[i] = 128; initData[i+1] = 128; initData[i+2] = 128; initData[i+3] = 255;
        }
        const pixels = tex.lock();
        pixels.set(initData);
        tex.unlock();
    }

    const gl = this.app.graphicsDevice.gl;
    const glTexture = tex.impl._glTexture;

    if (glTexture) {
        const prevBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
        gl.bindTexture(gl.TEXTURE_2D, glTexture);

        for (let i = 1; i < levelCount; i++) {
            const w = Math.max(1, baseW >> i);
            const h = Math.max(1, baseH >> i);
            const size = w * h * 4;
            const mipData = new Uint8Array(size);
            for (let j = 0; j < size; j += 4) {
                mipData[j] = 128; mipData[j+1] = 128; mipData[j+2] = 128; mipData[j+3] = 255;
            }
            gl.texImage2D(gl.TEXTURE_2D, i, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, mipData);
        }

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, levelCount - 1);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levelCount - 1);

        if (this.enableAniso) {
            const ext = gl.getExtension('EXT_texture_filter_anisotropic') ||
                        gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
                        gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
            if (ext) {
                const maxAniso = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 8;
                gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
                if (this.verbose) console.log(`[KTX] Anisotropy: ${Math.min(8, maxAniso)}x`);
            }
        }

        gl.bindTexture(gl.TEXTURE_2D, prevBinding);
        if (this.verbose) console.log('[KTX] All mip levels initialized, BASE/MAX set to', levelCount - 1);
    }

    if (this.verbose) console.log(`[KTX] Created texture ${baseW}x${baseH} with ${levelCount} mip levels`);

    let minAvailableLod = levelCount - 1;
    let maxAvailableLod = levelCount - 1;

    const assign = () => {
        const comp = entity.render || entity.model;
        const mi = comp && comp.meshInstances && comp.meshInstances[0];
        if (!mi) return false;

        if (!this._activeTexture || this._activeTexture !== tex) {
            if (this._activeTexture) {
                const oldTex = this._activeTexture;
                requestAnimationFrame(() => { try { oldTex.destroy(); } catch(e) {} });
            }
            this._activeTexture = tex;

            const originalMat = mi.material;
            const customMat = originalMat.clone();

            customMat.diffuseMap = tex;
            customMat.setParameter('material_minAvailableLod', minAvailableLod);
            customMat.setParameter('material_maxAvailableLod', maxAvailableLod);
            customMat.update();

            mi.material = customMat;
            this._customMaterial = customMat;

            if (this.verbose) console.log('[KTX] Texture assigned with LOD-window uniforms');
        }
        return true;
    };

    let idx = levelCount - 1;

    const stepOnce = async (i) => {
        const lvl = probe.levels[i];
        if (!lvl || lvl.byteLength === 0) {
            console.error(`[KTX] Invalid level ${i}: empty or missing`);
            return false;
        }

        const payload = await this._fetchRange(probe.url, lvl.byteOffset, lvl.byteOffset + lvl.byteLength - 1);
        if (!payload || payload.byteLength !== lvl.byteLength) {
            console.error(`[KTX] Level ${i} payload incomplete: expected ${lvl.byteLength}, got ${payload ? payload.byteLength : 0}`);
            return false;
        }

        const mini = this._repackSingleLevel(probe, i, payload);

        const dv = new DataView(mini.buffer, mini.byteOffset, mini.byteLength);
        const w = dv.getUint32(0x14, true);
        const h = dv.getUint32(0x18, true);

        const maxTex = this.app.graphicsDevice.maxTextureSize || 4096;
        if (w > maxTex || h > maxTex) {
            if (this.verbose) console.warn(`[KTX] Skip ${w}x${h}`);
            return false;
        }

        if (this.verbose) console.log(`[KTX] Loading Level ${i}: ${w}x${h} (${lvl.byteLength} bytes @ offset ${lvl.byteOffset})`);

        let result;
        const transcodeStart = performance.now();
        try {
            result = await this._transcode(mini);
        } catch(e) {
            console.error(`[KTX] Transcode failed for Level ${i}:`, e.message);
            console.error(`[KTX] Debug info:`, {
                levelIndex: i, width: w, height: h,
                payloadSize: payload.byteLength, miniSize: mini.byteLength,
                expectedSize: lvl.byteLength, byteOffset: lvl.byteOffset,
                uncompressedSize: lvl.uncompressedByteLength
            });
            return false;
        }

        try {
            const device = this.app.graphicsDevice;
            const gl = device.gl;
            const glTexture = tex.impl._glTexture;
            if (!glTexture) {
                console.error('[KTX] No WebGL texture');
                return false;
            }

            const prevBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
            gl.bindTexture(gl.TEXTURE_2D, glTexture);

            gl.texImage2D(
                gl.TEXTURE_2D,
                i,
                gl.RGBA,
                result.width,
                result.height,
                0,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                result.data
            );

            // ✅ ОСВОБОЖДЕНИЕ ПАМЯТИ: Обнуляем данные после загрузки в GPU
            const dataSize = result.data.byteLength;
            result.data.fill(0);  // Обнуляем массив
            result.data = null;   // Удаляем ссылку для GC
            
            // Также очищаем временные буферы
            mini.fill(0);
            payload.fill(0);
            
            // Обновляем статистику
            const transcodeTime = performance.now() - transcodeStart;
            loadStats.transcodeTimeMs += transcodeTime;
            loadStats.loadedBytes += lvl.byteLength;
            loadStats.loadedLevels++;
            
            if (i < minAvailableLod) minAvailableLod = i;
            if (i > maxAvailableLod) maxAvailableLod = i;

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, minAvailableLod);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL,  maxAvailableLod);

            gl.bindTexture(gl.TEXTURE_2D, prevBinding);

            if (this._customMaterial) {
                this._customMaterial.setParameter('material_minAvailableLod', minAvailableLod);
                this._customMaterial.setParameter('material_maxAvailableLod', maxAvailableLod);
                if (this.verbose) console.log(`[KTX] Updated LOD window: [${minAvailableLod}, ${maxAvailableLod}]`);
            }

            if (i === levelCount - 1) assign();
            
            // ✅ CALLBACK: Сообщаем о прогрессе
            this._fireProgress(i, levelCount, {
                level: i,
                width: w,
                height: h,
                compressedSize: lvl.byteLength,
                uncompressedSize: dataSize,
                transcodeTimeMs: transcodeTime,
                minLod: minAvailableLod,
                maxLod: maxAvailableLod
            });

        } catch(e) {
            console.error(`[KTX] Failed to set mip level ${i}:`, e);
            return false;
        }

        return true;
    };

    await stepOnce(idx);
    
    let lastFrameTime = performance.now();

    while (this.progressive && idx > targetLod) {
        idx--;
        
        // Умный лимитер: ждем минимальный интервал + stepDelayMs
        const now = performance.now();
        const elapsed = now - lastFrameTime;
        const minInterval = Math.max(this.minFrameInterval || 16, 0);
        const waitTime = Math.max(minInterval - elapsed, 0) + (this.stepDelayMs || 0);
        
        if (waitTime > 0) {
            await new Promise(r => setTimeout(r, waitTime));
        }
        
        lastFrameTime = performance.now();
        const success = await stepOnce(idx);
        if (!success) break;
    }

    if (this.verbose) {
        const loadedLevels = levelCount - idx;
        console.log(`[KTX] Complete: ${baseW}x${baseH}, loaded ${loadedLevels}/${levelCount} levels (stopped at LOD ${idx})`);
    }
    
    // ✅ Завершаем статистику
    loadStats.endTime = performance.now();
    const totalTimeMs = loadStats.endTime - loadStats.startTime;
    
    // ✅ CALLBACK: Сообщаем о завершении
    this._fireComplete({
        totalTimeMs: totalTimeMs,
        transcodeTimeMs: loadStats.transcodeTimeMs,
        networkTimeMs: totalTimeMs - loadStats.transcodeTimeMs,
        totalLevels: loadStats.totalLevels,
        loadedLevels: loadStats.loadedLevels,
        totalBytes: loadStats.totalBytes,
        loadedBytes: loadStats.loadedBytes,
        targetLod: targetLod,
        finalLod: idx,
        resolution: `${baseW}x${baseH}`,
        averageTranscodeTimeMs: loadStats.transcodeTimeMs / loadStats.loadedLevels
    });
};

// --- Update: динамическая дозагрузка при приближении ---
Ktx2ProgressiveVanilla.prototype.update = function(dt) {
    if (!this.adaptiveLoading) return;
    
    // 🔧 ИСПРАВЛЕНИЕ #1: Исправлена логика проверки
    if (!this._probeData || this._currentTargetLod === undefined) return;
    
    this._lastUpdateCheck = this._lastUpdateCheck || 0;
    this._lastUpdateCheck += dt;
    
    const checkInterval = this.adaptiveUpdateInterval || 0.5;
    if (this._lastUpdateCheck < checkInterval) return;
    this._lastUpdateCheck = 0;
    
    const newTargetLod = this._calculateRequiredLod(
        this.entity, 
        this._probeData.width, 
        this._probeData.height, 
        this._probeData.levelCount
    );
    
    if (newTargetLod < this._currentTargetLod) {
        if (this.verbose) {
            console.log(`[KTX] Camera closer: LOD ${this._currentTargetLod} → ${newTargetLod}, loading more detail...`);
        }
        
        this._loadAdditionalLevels(this._currentTargetLod - 1, newTargetLod);
        this._currentTargetLod = newTargetLod;
    }
};

// --- Дозагрузка дополнительных уровней ---
Ktx2ProgressiveVanilla.prototype._loadAdditionalLevels = async function(fromLod, toLod) {
    if (!this._probeData || !this.ktx) return;
    
    const probe = this._probeData;
    
    for (let i = fromLod; i >= toLod; i--) {
        const lvl = probe.levels[i];
        if (!lvl || lvl.byteLength === 0) continue;
        
        try {
            const payload = await this._fetchRange(probe.url, lvl.byteOffset, lvl.byteOffset + lvl.byteLength - 1);
            const mini = this._repackSingleLevel(probe, i, payload);
            
            const dv = new DataView(mini.buffer, mini.byteOffset, mini.byteLength);
            const w = dv.getUint32(0x14, true);
            const h = dv.getUint32(0x18, true);
            
            if (this.verbose) {
                console.log(`[KTX] Loading additional Level ${i}: ${w}x${h}`);
            }
            
            const transcodeStart = performance.now();
            const result = await this._transcode(mini);
            const transcodeTime = performance.now() - transcodeStart;
            
            const gl = this.app.graphicsDevice.gl;
            const glTexture = this._activeTexture?.impl._glTexture;
            
            if (glTexture) {
                const prevBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
                gl.bindTexture(gl.TEXTURE_2D, glTexture);
                
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    i,
                    gl.RGBA,
                    result.width,
                    result.height,
                    0,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    result.data
                );
                
                // ✅ ОСВОБОЖДЕНИЕ ПАМЯТИ: Обнуляем данные после загрузки в GPU
                const dataSize = result.data.byteLength;
                result.data.fill(0);
                result.data = null;
                mini.fill(0);
                payload.fill(0);
                
                // 🔧 ИСПРАВЛЕНИЕ #3: Обновляем оба параметра LOD-окна
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, i);
                // maxAvailableLod остается прежним (самый мелкий загруженный)
                
                if (this._customMaterial) {
                    this._customMaterial.setParameter('material_minAvailableLod', i);
                    // 🔧 ИСПРАВЛЕНИЕ #3: Обновляем maxAvailableLod в uniform
                    // (maxAvailableLod = последний загруженный уровень, обычно levelCount-1)
                    if (this.verbose) {
                        console.log(`[KTX] Updated LOD after additional load: minLod=${i}`);
                    }
                }
                
                gl.bindTexture(gl.TEXTURE_2D, prevBinding);
                
                // ✅ CALLBACK: Сообщаем о прогрессе дозагрузки
                this._fireProgress(i, probe.levelCount, {
                    level: i,
                    width: w,
                    height: h,
                    compressedSize: lvl.byteLength,
                    uncompressedSize: dataSize,
                    transcodeTimeMs: transcodeTime,
                    isAdditionalLoad: true
                });
            }
            
            await new Promise(r => setTimeout(r, this.stepDelayMs));
            
        } catch(e) {
            console.error(`[KTX] Failed to load additional level ${i}:`, e);
        }
    }
    
    if (this.verbose) {
        console.log(`[KTX] Additional levels loaded, now at LOD ${toLod}`);
    }
};
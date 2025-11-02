// Ktx2TranscodeWorker.js
// Web Worker для транскодирования KTX2 в фоновом потоке

let ktxModule = null;
let ktxApi = null;

// Инициализация libktx в Worker
self.addEventListener('message', async function(e) {
    const { type, data, messageId } = e.data;
    
    console.log('[Worker] Received message:', type, messageId ? `(ID: ${messageId})` : '');
    
    try {
        switch (type) {
            case 'init':
                console.log('[Worker] Init requested');
                await initKtxModule(data.libktxCode, data.wasmUrl);
                console.log('[Worker] Init complete, sending response');
                self.postMessage({ type: 'init', success: true });
                console.log('[Worker] Init response sent');
                break;
                
            case 'transcode':
                // data.miniKtx - это ArrayBuffer после transfer
                // Создаем Uint8Array из него
                const miniKtxArray = new Uint8Array(data.miniKtx);
                const result = transcodeToRgba(miniKtxArray);
                // Передаем ownership RGBA буфера обратно в main thread
                self.postMessage({
                    type: 'transcode',
                    success: true,
                    messageId: messageId,
                    width: result.width,
                    height: result.height,
                    data: result.data
                }, [result.data.buffer]);  // Transfer ownership
                break;
                
            default:
                throw new Error(`Unknown message type: ${type}`);
        }
    } catch (error) {
        console.error('[Worker] Error processing message:', type, error);
        self.postMessage({
            type: type,
            success: false,
            messageId: messageId,
            error: error.message,
            stack: error.stack
        });
    }
});

// Инициализация KTX модуля
async function initKtxModule(libktxCode, wasmUrl) {
    console.log('[Worker] Starting initialization...');
    
    if (ktxModule) {
        console.log('[Worker] KTX module already initialized');
        return;
    }
    
    try {
        // Выполняем код libktx.js в Worker scope через eval
        if (typeof self.createKtxModule === 'undefined') {
            console.log('[Worker] Executing libktx.js code...');
            
            // Используем eval для выполнения кода в глобальном scope
            // eslint-disable-next-line no-eval
            self.eval(libktxCode);
            
            // После выполнения createKtxModule должен быть доступен
            if (typeof self.createKtxModule !== 'undefined') {
                console.log('[Worker] createKtxModule loaded successfully');
            } else {
                throw new Error('createKtxModule not found after executing libktx.js');
            }
        }
        
        // Инициализируем WASM модуль
        const opts = {
            locateFile: (path) => {
                if (path.endsWith('.wasm')) {
                    return wasmUrl;
                }
                return path;
            }
        };
        
        console.log('[Worker] Initializing WASM module with wasmUrl:', wasmUrl);
        ktxModule = await self.createKtxModule(opts);
        
        // Создаем API обертки
        ktxApi = {
            malloc: ktxModule.cwrap('malloc', 'number', ['number']),
            free: ktxModule.cwrap('free', null, ['number']),
            createFromMemory: ktxModule.cwrap('ktxTexture2_CreateFromMemory', 'number', ['number','number','number','number']),
            destroy: ktxModule.cwrap('ktxTexture2_Destroy', null, ['number']),
            transcode: ktxModule.cwrap('ktxTexture2_TranscodeBasis', 'number', ['number','number','number']),
            needsTranscoding: ktxModule.cwrap('ktxTexture2_NeedsTranscoding', 'number', ['number']),
            getData: ktxModule.cwrap('ktx_get_data', 'number', ['number']),
            getDataSize: ktxModule.cwrap('ktx_get_data_size', 'number', ['number']),
            getWidth: ktxModule.cwrap('ktx_get_base_width', 'number', ['number']),
            getHeight: ktxModule.cwrap('ktx_get_base_height', 'number', ['number']),
            errorString: ktxModule.cwrap('ktxErrorString', 'string', ['number']),
            HEAPU8: ktxModule.HEAPU8
        };
        
        console.log('[Worker] KTX module initialized successfully');
        
    } catch (error) {
        console.error('[Worker] Initialization error:', error);
        throw error;
    }
}

// Транскодирование в RGBA
function transcodeToRgba(miniKtx) {
    if (!ktxModule || !ktxApi) {
        throw new Error('KTX module not initialized');
    }
    
    const src = new Uint8Array(miniKtx);
    const ptr = ktxApi.malloc(src.byteLength);
    
    // Получаем актуальный HEAPU8 (может измениться при росте heap)
    const heap = ktxModule.HEAPU8;
    heap.set(src, ptr);
    
    const outPtrPtr = ktxApi.malloc(4);
    const rc = ktxApi.createFromMemory(ptr, src.byteLength, 0, outPtrPtr);
    
    if (rc !== 0) {
        ktxApi.free(outPtrPtr);
        ktxApi.free(ptr);
        const msg = ktxApi.errorString ? ktxApi.errorString(rc) : '';
        throw new Error(`CreateFromMemory failed: rc=${rc} ${msg}`);
    }
    
    const texPtr = ktxModule.getValue(outPtrPtr, '*');
    ktxApi.free(outPtrPtr);
    
    const needsTranscode = ktxApi.needsTranscoding(texPtr);
    if (needsTranscode) {
        const KTX_TTF_RGBA32 = 13;
        const rcT = ktxApi.transcode(texPtr, KTX_TTF_RGBA32, 0);
        
        if (rcT !== 0) {
            ktxApi.destroy(texPtr);
            ktxApi.free(ptr);
            const msg = ktxApi.errorString ? ktxApi.errorString(rcT) : '';
            throw new Error(`Transcode failed: rc=${rcT} ${msg}`);
        }
    }
    
    const dataPtr = ktxApi.getData(texPtr);
    const baseW = ktxApi.getWidth(texPtr);
    const baseH = ktxApi.getHeight(texPtr);
    const dataSize = ktxApi.getDataSize(texPtr);
    const expected = baseW * baseH * 4;
    const total = Math.min(expected, dataSize);
    
    // Копируем данные из WASM памяти (используем актуальный heap)
    const rgbaCopy = new Uint8Array(total);
    const heapCurrent = ktxModule.HEAPU8; // Обновляем reference перед копированием
    const CHUNK_SIZE = 1048576;
    
    for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
        const size = Math.min(CHUNK_SIZE, total - offset);
        const chunk = heapCurrent.subarray(dataPtr + offset, dataPtr + offset + size);
        rgbaCopy.set(chunk, offset);
    }
    
    // Освобождаем память
    ktxApi.destroy(texPtr);
    ktxApi.free(ptr);
    
    return { width: baseW, height: baseH, data: rgbaCopy };
}

console.log('[Worker] Ktx2TranscodeWorker loaded');
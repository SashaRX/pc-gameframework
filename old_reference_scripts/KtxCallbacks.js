/* global pc */

// Скрипт для отслеживания прогресса загрузки KTX2
var KtxCallbacks = pc.createScript('ktxCallbacks');

KtxCallbacks.prototype.initialize = function() {
    // Регистрируем глобальные callbacks ДО загрузки
    window.onKtxProgress = this.onProgress.bind(this);
    window.onKtxComplete = this.onComplete.bind(this);
    
    console.log('[KTX Callbacks] Registered');
};

KtxCallbacks.prototype.onProgress = function(level, total, info) {
    const percent = ((total - level) / total * 100).toFixed(1);
    
    console.log(`📥 [${percent}%] Level ${level}/${total}: ${info.width}x${info.height}`);
    console.log(`   Compressed: ${(info.compressedSize / 1024).toFixed(2)} KB`);
    console.log(`   Transcode: ${info.transcodeTimeMs.toFixed(2)}ms`);
    
    if (info.isAdditionalLoad) {
        console.log('   ⚡ Additional load (camera closer)');
    }
};

KtxCallbacks.prototype.onComplete = function(stats) {
    console.log('✅ ============ KTX2 Loading Complete ============');
    console.log(`⏱️  Total time: ${(stats.totalTimeMs / 1000).toFixed(2)}s`);
    console.log(`🔄 Transcode: ${(stats.transcodeTimeMs / 1000).toFixed(2)}s`);
    console.log(`🌐 Network: ${(stats.networkTimeMs / 1000).toFixed(2)}s`);
    console.log(`📊 Loaded: ${stats.loadedLevels}/${stats.totalLevels} levels`);
    console.log(`💾 Downloaded: ${(stats.loadedBytes / 1024).toFixed(2)} KB / ${(stats.totalBytes / 1024).toFixed(2)} KB`);
    console.log(`⚡ Avg transcode: ${stats.averageTranscodeTimeMs.toFixed(2)}ms/level`);
    console.log(`🎯 Resolution: ${stats.resolution}`);
    console.log(`📍 Final LOD: ${stats.finalLod} (target was ${stats.targetLod})`);
    console.log('================================================');
};
/* global pc, createKtxModule */

/**
 * ТЕСТОВЫЙ СКРИПТ - проверка что libktx работает
 * Этот скрипт НЕ загружает libktx.js, только ИСПОЛЬЗУЕТ его
 */

var KtxMinimalTest = pc.createScript('ktxMinimalTest');

KtxMinimalTest.prototype.initialize = function() {
    console.log('=== MINIMAL TEST START ===');
    
    // Проверка 1: Функция существует
    if (typeof createKtxModule !== 'function') {
        console.error('[TEST] ERROR: createKtxModule not found!');
        console.error('[TEST] Add libktx.js to Project Settings > Libraries');
        return;
    }
    console.log('[TEST] ✓ createKtxModule found');
    
    // Проверка 2: Инициализация модуля
    createKtxModule()
        .then(module => {
            console.log('[TEST] ✓ Module initialized');
            console.log('[TEST] ✓ HEAPU8 available:', !!module.HEAPU8);
            console.log('[TEST] ✓ cwrap available:', !!module.cwrap);
            console.log('[TEST] === TEST PASSED ===');
        })
        .catch(err => {
            console.error('[TEST] ✗ Module init failed:', err);
        });
};
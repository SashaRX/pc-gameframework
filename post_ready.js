/**
 * post_ready.js - Автоматическое добавление Module.ready Promise
 *
 * Этот файл должен быть добавлен в CMakeLists.txt через --post-js:
 *
 * set(
 *     KTX_EM_COMMON_KTX_LINK_FLAGS
 *     --pre-js ${CMAKE_CURRENT_SOURCE_DIR}/interface/js_binding/class_compat.js
 *     --post-js ${CMAKE_CURRENT_SOURCE_DIR}/interface/js_binding/post_ready.js
 *     --extern-post-js ${CMAKE_CURRENT_SOURCE_DIR}/interface/js_binding/module_create_compat.js
 *     ${KTX_EM_COMMON_LINK_FLAGS}
 * )
 *
 * Этот скрипт создаёт Module.ready Promise, который резолвится после
 * полной инициализации WebAssembly модуля.
 */

if (!Module.ready) {
  var readyPromiseResolve, readyPromiseReject;

  Module.ready = new Promise(function(resolve, reject) {
    readyPromiseResolve = resolve;
    readyPromiseReject = reject;
  });

  // Сохраняем оригинальный onRuntimeInitialized если есть
  var originalOnRuntimeInitialized = Module.onRuntimeInitialized;

  Module.onRuntimeInitialized = function() {
    try {
      // Вызвать оригинальный callback если был
      if (originalOnRuntimeInitialized) {
        originalOnRuntimeInitialized.call(Module);
      }

      // Резолвить Promise
      if (readyPromiseResolve) {
        readyPromiseResolve(Module);
      }
    } catch (err) {
      // В случае ошибки реджектить Promise
      console.error('[libktx] Runtime initialization failed:', err);
      if (readyPromiseReject) {
        readyPromiseReject(err);
      }
      throw err;
    }
  };

  // Также обработать случай ошибки при загрузке WASM
  var originalOnAbort = Module.onAbort;
  Module.onAbort = function(what) {
    if (originalOnAbort) {
      originalOnAbort.call(Module, what);
    }
    if (readyPromiseReject) {
      readyPromiseReject(new Error('Aborted: ' + what));
    }
  };
}

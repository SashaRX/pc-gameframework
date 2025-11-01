# Анализ текущего CMakeLists.txt и рекомендации по исправлению

## 🔍 Текущее состояние

В текущем CMakeLists.txt есть:

### ✅ Что уже сделано правильно:

1. **EXPORTED_FUNCTIONS list построен правильно для Windows/Ninja:**
```cmake
set(KTX_EXPORTS_LIST
  _malloc
  _free
  _ktxTexture2_CreateFromMemory
  # ... и т.д.
)

# Построение JSON-строки
set(_json "[")
foreach(sym IN LISTS KTX_EXPORTS_LIST)
  string(APPEND _json "\\\"${sym}\\\",")
endforeach()
string(REGEX REPLACE ",$" "" _json "${_json}")
string(APPEND _json "]")

set(KTX_EXPORTED_FUNCTIONS_ARG "SHELL:-sEXPORTED_FUNCTIONS=${_json}")
```

2. **MODULARIZE включён:**
```cmake
"SHELL:-s MODULARIZE=1"
```

3. **EXPORT_NAME задан:**
```cmake
"SHELL:-s EXPORT_NAME=createKtxModule"  # для ktx_js
"SHELL:-s EXPORT_NAME=createKtxReadModule"  # для ktx_js_read
```

### ❌ Что нужно исправить:

## 1. Добавить -sEXPORT_ES6=1

**Проблема:** Без этого флага генерируется CommonJS, а не ES6 модуль.

**Исправление:**
```cmake
target_link_options(ktx_js PUBLIC
  ${KTX_EM_COMMON_KTX_LINK_FLAGS}
  "SHELL:-s EXPORT_NAME=createKtxModule"
  "SHELL:-s EXPORT_ES6=1"  # ← Добавить эту строку
  ${KTX_EXPORTED_FUNCTIONS_ARG}
)
```

## 2. Отключить FILESYSTEM

**Проблема:** FS/TTY раздувают файл на ~500 КБ.

**Исправление:**

В начале секции EMSCRIPTEN добавить:
```cmake
if(EMSCRIPTEN AND KTX_FEATURE_JS)
    # Отключить FS/TTY для уменьшения размера
    add_compile_definitions(
        KTX_OMIT_VULKAN=1
    )
    add_link_options(
        "SHELL:-s FILESYSTEM=0"
    )

    set(
        KTX_EM_COMMON_LINK_FLAGS
        --bind
        "SHELL:-s MODULARIZE=1"
        "SHELL:-s FILESYSTEM=0"  # ← Добавить
        "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue','HEAPU8','GL']"
        "SHELL:-s GL_PREINITIALIZED_CONTEXT=1"
    )
```

## 3. Добавить флаги оптимизации памяти

**Исправление:**
```cmake
target_link_options(ktx_js PUBLIC
  ${KTX_EM_COMMON_KTX_LINK_FLAGS}
  "SHELL:-s EXPORT_NAME=createKtxModule"
  "SHELL:-s EXPORT_ES6=1"
  "SHELL:-s ALLOW_MEMORY_GROWTH=1"
  "SHELL:-s MAXIMUM_MEMORY=4GB"
  "SHELL:-s INITIAL_MEMORY=64MB"
  "SHELL:-s NO_EXIT_RUNTIME=1"
  ${KTX_EXPORTED_FUNCTIONS_ARG}
)
```

## 4. Добавить -sENVIRONMENT=web,worker

**Проблема:** По умолчанию включает Node.js код.

**Исправление:**
```cmake
target_link_options(ktx_js PUBLIC
  ${KTX_EM_COMMON_KTX_LINK_FLAGS}
  "SHELL:-s EXPORT_NAME=createKtxModule"
  "SHELL:-s EXPORT_ES6=1"
  "SHELL:-s ENVIRONMENT=web,worker"  # ← Добавить
  ${KTX_EXPORTED_FUNCTIONS_ARG}
)
```

## 5. Убедиться что расширенный список экспортов

**Текущий список:**
```cmake
set(KTX_EXPORTS_LIST
  _malloc
  _free
  _ktxTexture2_CreateFromMemory
  _ktxTexture2_CreateFromStream
  _ktxTexture2_TranscodeBasis
  _ktxTexture2_Destroy
  _ktxTexture2_NeedsTranscoding
  _ktxTexture_GetData
  _ktxTexture_GetDataSize
  _ktxErrorString
  _ktx_get_base_width
  _ktx_get_base_height
  _ktx_get_num_levels
  _ktx_get_image_offset
  _ktx_get_data
  _ktx_get_data_size
)
```

**Рекомендация:** Добавить дополнительные функции для полной функциональности:
```cmake
set(KTX_EXPORTS_LIST
  _malloc
  _free
  _ktxTexture_CreateFromMemory
  _ktxTexture2_CreateFromMemory
  _ktxTexture2_CreateFromStream
  _ktxTexture_Destroy
  _ktxTexture2_Destroy
  _ktxTexture2_TranscodeBasis
  _ktxTexture2_NeedsTranscoding
  _ktxTexture_GetImageOffset
  _ktxTexture_GetData
  _ktxTexture_GetDataSize
  _ktxTexture_GetSize
  _ktxTexture_GetVkFormat
  _ktxTexture_GetOGLFormat
  _ktxErrorString
  # Дополнительные функции из interface/js_binding
  _ktx_get_base_width
  _ktx_get_base_height
  _ktx_get_num_levels
  _ktx_get_image_offset
  _ktx_get_data
  _ktx_get_data_size
)
```

## 📝 Полный исправленный блок для ktx_js

```cmake
if(EMSCRIPTEN AND KTX_FEATURE_JS)
    # Отключить FS/TTY для уменьшения размера
    add_compile_definitions(
        KTX_OMIT_VULKAN=1
    )

    set(
        KTX_EM_COMMON_LINK_FLAGS
        --bind
        "SHELL:-s MODULARIZE=1"
        "SHELL:-s EXPORT_ES6=1"
        "SHELL:-s FILESYSTEM=0"
        "SHELL:-s NO_EXIT_RUNTIME=1"
        "SHELL:-s ALLOW_MEMORY_GROWTH=1"
        "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue','HEAPU8','GL']"
        "SHELL:-s GL_PREINITIALIZED_CONTEXT=1"
    )

    set(
        KTX_EM_COMMON_KTX_LINK_FLAGS
        --pre-js ${CMAKE_CURRENT_SOURCE_DIR}/interface/js_binding/class_compat.js
        --extern-post-js ${CMAKE_CURRENT_SOURCE_DIR}/interface/js_binding/module_create_compat.js
        ${KTX_EM_COMMON_LINK_FLAGS}
    )

    set(
        KTX_JS_COMMON_SOURCE
        interface/js_binding/ktx_wrapper.cpp
        interface/js_binding/class_compat.js
        interface/js_binding/module_create_compat.js
    )

    # --- Расширенный список экспортов ---
    set(KTX_EXPORTS_LIST
      _malloc
      _free
      _ktxTexture_CreateFromMemory
      _ktxTexture2_CreateFromMemory
      _ktxTexture2_CreateFromStream
      _ktxTexture_Destroy
      _ktxTexture2_Destroy
      _ktxTexture2_TranscodeBasis
      _ktxTexture2_NeedsTranscoding
      _ktxTexture_GetImageOffset
      _ktxTexture_GetData
      _ktxTexture_GetDataSize
      _ktxTexture_GetSize
      _ktxTexture_GetVkFormat
      _ktxTexture_GetOGLFormat
      _ktxErrorString
      _ktx_get_base_width
      _ktx_get_base_height
      _ktx_get_num_levels
      _ktx_get_image_offset
      _ktx_get_data
      _ktx_get_data_size
    )

    # Построение JSON-строки для Windows/Ninja
    set(_json "[")
    foreach(sym IN LISTS KTX_EXPORTS_LIST)
      string(APPEND _json "\\\"${sym}\\\",")
    endforeach()
    string(REGEX REPLACE ",$" "" _json "${_json}")
    string(APPEND _json "]")

    set(KTX_EXPORTED_FUNCTIONS_ARG "SHELL:-sEXPORTED_FUNCTIONS=${_json}")
    message(STATUS "EXPORTED_FUNCTIONS ARG -> ${KTX_EXPORTED_FUNCTIONS_ARG}")

    add_executable( ktx_js
        ${KTX_JS_COMMON_SOURCE}
        interface/js_binding/vk_format.inl
        interface/js_binding/ktx_shim.c
    )

    target_compile_definitions(ktx_js PUBLIC KTX_FEATURE_WRITE)
    target_link_libraries( ktx_js ktx )
    target_sources(ktx_js PRIVATE lib/memstream.c)

    target_include_directories(
        ktx_js
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/other_include
        ${CMAKE_CURRENT_SOURCE_DIR}/lib/src
        $<TARGET_PROPERTY:ktx,INTERFACE_INCLUDE_DIRECTORIES>
    )

    set_target_properties( ktx_js PROPERTIES OUTPUT_NAME "libktx")

    target_link_options(ktx_js PUBLIC
      ${KTX_EM_COMMON_KTX_LINK_FLAGS}
      "SHELL:-s EXPORT_NAME=createKtxModule"
      "SHELL:-s ENVIRONMENT=web,worker"
      "SHELL:-s MAXIMUM_MEMORY=4GB"
      "SHELL:-s INITIAL_MEMORY=64MB"
      ${KTX_EXPORTED_FUNCTIONS_ARG}
    )

    install(TARGETS ktx_js
        RUNTIME
            DESTINATION .
            COMPONENT ktx_js
    )
    install(FILES ${CMAKE_BINARY_DIR}/libktx.wasm
        DESTINATION .
        COMPONENT ktx_js
    )

    # ... аналогично для ktx_js_read ...
endif()
```

## 🎯 Итоговые флаги для правильной сборки

### Основные флаги (обязательные):
```cmake
-s MODULARIZE=1
-s EXPORT_ES6=1
-s EXPORT_NAME=createKtxModule
-s ENVIRONMENT=web,worker
-s FILESYSTEM=0
-s NO_EXIT_RUNTIME=1
```

### Флаги памяти:
```cmake
-s ALLOW_MEMORY_GROWTH=1
-s MAXIMUM_MEMORY=4GB
-s INITIAL_MEMORY=64MB
```

### Флаги экспортов:
```cmake
-s EXPORTED_FUNCTIONS=[список C функций]
-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue','HEAPU8']
```

## 📦 Ожидаемый результат после исправлений

| Параметр | До | После |
|----------|-----|-------|
| **Формат модуля** | CommonJS (или проблемы с ES6) | ✅ ES6 (`export default`) |
| **Module.ready** | ❌ Отсутствует | ⚠️ Нужна пост-обработка |
| **FILESYSTEM** | ✅ Уже отключен в коде | ✅ Отключен в линкере |
| **Размер libktx.mjs** | ~116 КБ | ~100-120 КБ (минимизировано) |
| **Размер libktx.wasm** | ~1.6 МБ | ~1.6 МБ (без изменений) |
| **Экспорты C функций** | ✅ Настроены | ✅ Полный список |

## ⚠️ Важно: Module.ready всё равно нужна пост-обработка

Даже с правильными флагами CMake, Emscripten **не создаёт Module.ready автоматически** при использовании MODULARIZE=1.

Решение:
1. Собрать с исправленным CMakeLists.txt
2. Запустить `scripts/quick-fix-libktx.mjs` для добавления Module.ready
3. Или использовать `--post-js` скрипт в CMake:

```cmake
# Создать post.js файл:
# File: interface/js_binding/post_ready.js
if (!Module.ready) {
  Module.ready = new Promise((resolve, reject) => {
    const originalInit = Module.onRuntimeInitialized;
    Module.onRuntimeInitialized = function() {
      if (originalInit) originalInit();
      resolve(Module);
    };
  });
}

# В CMakeLists.txt:
target_link_options(ktx_js PUBLIC
  --post-js ${CMAKE_CURRENT_SOURCE_DIR}/interface/js_binding/post_ready.js
  ${KTX_EM_COMMON_KTX_LINK_FLAGS}
  # ...
)
```

## 🚀 Команды для сборки

```bash
# 1. Очистить build директорию
rm -rf build-wasm
mkdir build-wasm
cd build-wasm

# 2. Конфигурация с Emscripten
emcmake cmake .. \
  -DCMAKE_BUILD_TYPE=Release \
  -DKTX_FEATURE_TESTS=OFF \
  -DKTX_FEATURE_TOOLS=OFF \
  -DKTX_FEATURE_DOC=OFF \
  -DKTX_FEATURE_LOADTEST_APPS=OFF \
  -DKTX_FEATURE_JS=ON

# 3. Сборка
emmake make -j$(nproc)

# 4. Пост-обработка (добавление Module.ready)
node ../scripts/quick-fix-libktx.mjs libktx.mjs

# 5. Копирование результатов
cp libktx.mjs /home/user/ktx2-progressive-loader-esm/lib/
cp libktx.wasm /home/user/ktx2-progressive-loader-esm/lib/
```

## 📚 Дополнительные ресурсы

- Emscripten Settings Reference: https://emscripten.org/docs/tools_reference/settings_reference.html
- MODULARIZE docs: https://emscripten.org/docs/getting_started/FAQ.html#how-can-i-tell-when-the-page-is-fully-loaded-and-it-is-safe-to-call-compiled-functions

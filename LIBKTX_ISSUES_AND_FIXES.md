# Проблемы libktx.mjs и их решения

## 🔴 Критические проблемы текущей сборки

### 1. Отсутствие `Module.ready` Promise

**Проблема:**
```javascript
const ktx = await createKtxModule();
await ktx.ready; // ❌ ready is undefined
```

**Причина:**
Emscripten по умолчанию не создаёт `Module.ready` Promise в MODULARIZE режиме.

**Решение:**
```javascript
// В начале createKtxModule добавить:
var readyPromiseResolve, readyPromiseReject;
Module.ready = new Promise((resolve, reject) => {
  readyPromiseResolve = resolve;
  readyPromiseReject = reject;
});

// В onRuntimeInitialized:
Module.onRuntimeInitialized = function() {
  // ... инициализация ...
  if (readyPromiseResolve) {
    readyPromiseResolve(Module);
  }
};
```

**Флаги Emscripten:** Нет автоматического флага, нужна пост-обработка.

---

### 2. `wasmImports is not defined`

**Проблема:**
```javascript
function getWasmImports() {
  var imports = { a: wasmImports }; // ❌ ReferenceError: wasmImports is not defined
  return imports;
}
```

**Причина:**
Переменная `wasmImports` используется до инициализации.

**Решение:**
```javascript
var wasmImports = {};

function getWasmImports() {
  var imports = { a: wasmImports }; // ✅ Теперь определён
  return imports;
}
```

**Флаги Emscripten:**
Проблема в генерируемом коде, исправляется пост-обработкой.

---

### 3. `assignWasmExports is not defined`

**Проблема:**
```javascript
async function createWasm() {
  // ...
  assignWasmExports(wasmExports); // ❌ ReferenceError: assignWasmExports is not defined
}
```

**Причина:**
Функция вызывается, но не определена.

**Решение:**
```javascript
function assignWasmExports(exports) {
  wasmExports = exports;
}

async function createWasm() {
  // ...
  assignWasmExports(wasmExports); // ✅ Теперь работает
}
```

**Флаги Emscripten:**
Исправляется пост-обработкой или новыми версиями Emscripten.

---

### 4. Функции не экспортируются

**Проблема:**
```javascript
Module.ktxTexture // ❌ undefined
Module.ErrorCode  // ❌ undefined
```

**Причина:**
В CMake не указаны `-sEXPORTED_FUNCTIONS` и `-sEXPORTED_RUNTIME_METHODS`.

**Решение:**
```bash
-sEXPORTED_FUNCTIONS='["_malloc","_free","_ktxTexture_CreateFromMemory","_ktxTexture_Destroy","_ktxTexture2_TranscodeBasis"]'
-sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue"]'
```

**Флаги CMake:**
```cmake
list(APPEND EMSCRIPTEN_LINK_FLAGS
    "-sEXPORTED_FUNCTIONS=[...]"
    "-sEXPORTED_RUNTIME_METHODS=[...]"
)
```

---

### 5. FS и TTY раздувают файл

**Проблема:**
Текущий `libktx.mjs` содержит полный Emscripten runtime с FS, TTY, MEMFS (~800 КБ сырой, ~200 КБ gzip).

**Причина:**
По умолчанию `-sFILESYSTEM=1`.

**Решение:**
```bash
-sFILESYSTEM=0  # Отключить FS/TTY/MEMFS
```

**Результат:**
Размер уменьшается до ~200 КБ сырой, ~60 КБ gzip.

---

### 6. Неправильный путь к WASM

**Проблема:**
```javascript
function findWasmBinary() {
  return new URL("libktx.wasm", import.meta.url).href;
  // ❌ Возвращает file:/// в Node или ломается при бандлинге
}
```

**Причина:**
`import.meta.url` не всегда корректен для динамических импортов.

**Решение:**
```javascript
function findWasmBinary() {
  if (Module["locateFile"]) {
    return locateFile("libktx.wasm");
  }
  return scriptDirectory + "libktx.wasm";
}
```

И при создании модуля:
```javascript
const ktx = await createKtxModule({
  locateFile: (path) => `/path/to/${path}`
});
```

---

### 7. Нет правильного Promise API

**Проблема:**
Текущий `createKtxModule` возвращает `Module`, но WASM может быть не инициализирован.

**Как должно быть:**
```javascript
const ktx = await createKtxModule({
  locateFile: (path) => `/libs/${path}`
});

// ✅ Дождаться готовности
await ktx.ready;

// ✅ Теперь можно использовать
ktx.ktxTexture.CreateFromMemory(...);
```

---

## 🔧 Правильные флаги Emscripten

### Полная команда

```bash
emcc \
  # --- Основные параметры ---
  -O3 \
  -sEXPORT_ES6=1 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createKtxModule \
  -sENVIRONMENT=web,worker \
  \
  # --- Экспорты C функций ---
  -sEXPORTED_FUNCTIONS='[
    "_malloc",
    "_free",
    "_ktxTexture_CreateFromMemory",
    "_ktxTexture_Destroy",
    "_ktxTexture2_TranscodeBasis",
    "_ktxTexture_GetImageOffset",
    "_ktxTexture_GetData",
    "_ktxTexture_GetSize"
  ]' \
  \
  # --- Экспорты JS методов ---
  -sEXPORTED_RUNTIME_METHODS='[
    "ccall",
    "cwrap",
    "getValue",
    "setValue",
    "UTF8ToString",
    "lengthBytesUTF8",
    "stringToUTF8"
  ]' \
  \
  # --- Оптимизация размера ---
  -sFILESYSTEM=0 \
  -sNO_EXIT_RUNTIME=1 \
  -sDISABLE_EXCEPTION_CATCHING=0 \
  -sASSERTIONS=0 \
  \
  # --- Настройки памяти ---
  -sALLOW_MEMORY_GROWTH=1 \
  -sMAXIMUM_MEMORY=4GB \
  -sINITIAL_MEMORY=64MB \
  -sSTACK_SIZE=5MB \
  \
  # --- Выходной файл ---
  -o libktx.mjs \
  <source files>
```

---

## 📊 Сравнение "до" и "после"

| Параметр | ❌ Текущая сборка | ✅ Правильная сборка |
|----------|-------------------|---------------------|
| **Module.ready** | Отсутствует | Promise, резолвится после init |
| **wasmImports** | ReferenceError | Инициализирован |
| **assignWasmExports** | ReferenceError | Определена |
| **ktxTexture экспорт** | undefined | Объект с методами |
| **FS/TTY** | Включены (+500 КБ) | Отключены (-500 КБ) |
| **Размер .mjs** | ~800 КБ | ~200 КБ |
| **Размер gzip** | ~200 КБ | ~60 КБ |
| **locateFile** | Хардкод import.meta.url | Настраиваемый |
| **Promise API** | Нет | Есть (await ready) |

---

## 🚀 Как пересобрать

### Быстрый способ

```bash
./scripts/build-libktx.sh
```

Скрипт автоматически:
1. Клонирует KTX-Software
2. Настроит CMake с правильными флагами
3. Соберёт libktx.mjs
4. Выполнит пост-обработку (Module.ready, wasmImports, assignWasmExports)
5. Скопирует в `lib/`

### Ручной способ

См. подробности в [BUILD_LIBKTX_GUIDE.md](./BUILD_LIBKTX_GUIDE.md)

---

## ✅ Проверка правильности сборки

```bash
./scripts/test-libktx.mjs
```

Тесты проверяют:
- ✅ Module.ready Promise существует
- ✅ Все функции экспортированы
- ✅ FS/TTY отключены
- ✅ Модуль инициализируется без ошибок
- ✅ wasmImports и assignWasmExports определены

---

## 📚 Ссылки

- **Emscripten Settings**: https://emscripten.org/docs/tools_reference/settings_reference.html
- **KTX-Software**: https://github.com/KhronosGroup/KTX-Software
- **PlayCanvas basis.js**: https://github.com/playcanvas/engine/blob/main/extras/basis.js
- **MODULARIZE docs**: https://emscripten.org/docs/getting_started/FAQ.html#how-can-i-tell-when-the-page-is-fully-loaded-and-it-is-safe-to-call-compiled-functions

---

## 🎯 Итого

**Основные проблемы:**
1. ❌ Нет `Module.ready` Promise
2. ❌ `wasmImports` не инициализирован
3. ❌ `assignWasmExports` не определена
4. ❌ Функции не экспортируются из C
5. ❌ FS/TTY раздувают размер
6. ❌ Хардкод пути к WASM
7. ❌ Нет Promise API

**Решения:**
1. ✅ Добавить `Module.ready` через пост-обработку
2. ✅ Инициализировать `wasmImports = {}`
3. ✅ Определить `assignWasmExports()`
4. ✅ Добавить `-sEXPORTED_FUNCTIONS` и `-sEXPORTED_RUNTIME_METHODS`
5. ✅ Использовать `-sFILESYSTEM=0`
6. ✅ Использовать `Module.locateFile()`
7. ✅ Ждать `await Module.ready`

**Результат:**
- ✅ Модуль работает корректно
- ✅ Размер уменьшен в ~4 раза
- ✅ Promise API доступен
- ✅ Совместимость с PlayCanvas

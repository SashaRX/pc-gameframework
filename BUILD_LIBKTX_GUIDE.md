# Правильная сборка libktx.mjs с Emscripten

## Проблемы текущей сборки

Текущий `lib/libktx.mjs` имеет следующие критические проблемы:

1. ❌ **Нет `Module.ready` Promise** - модуль не готов после создания
2. ❌ **`wasmImports` не определён** - `ReferenceError` при инициализации
3. ❌ **`assignWasmExports()` не существует** - функция не определена
4. ❌ **Функции не экспортируются** - `Module.ktxTexture = undefined`
5. ❌ **FS и TTY включены** - раздувает размер на 400-600 КБ
6. ❌ **Неправильный путь к WASM** - `import.meta.url` ломается в браузере

## Правильные флаги Emscripten

### Минимальная конфигурация для libktx

```bash
emcc \
  -O3 \
  -sEXPORT_ES6=1 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createKtxModule \
  -sENVIRONMENT=web,worker \
  -sALLOW_MEMORY_GROWTH=1 \
  -sMAXIMUM_MEMORY=4GB \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_ktxTexture_CreateFromMemory","_ktxTexture_Destroy","_ktxTexture2_TranscodeBasis","_ktxTexture_GetImageOffset","_ktxTexture_GetData","_ktxTexture_GetSize"]' \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue"]' \
  -sFILESYSTEM=0 \
  -sNO_EXIT_RUNTIME=1 \
  -sDISABLE_EXCEPTION_CATCHING=0 \
  -sASSERTIONS=0 \
  --no-entry \
  -o libktx.mjs \
  <source files>
```

### Ключевые параметры

| Флаг | Назначение | Важность |
|------|-----------|----------|
| `-sEXPORT_ES6=1` | Генерирует ES6 модуль вместо CommonJS | ⚠️ Обязательно |
| `-sMODULARIZE=1` | Оборачивает в функцию-фабрику | ⚠️ Обязательно |
| `-sEXPORT_NAME=createKtxModule` | Название экспортируемой функции | ⚠️ Обязательно |
| `-sENVIRONMENT=web,worker` | Только браузер/worker, без Node.js | ✅ Рекомендуется |
| `-sFILESYSTEM=0` | **Отключает FS/TTY** - экономит 400-600 КБ | ✅ Критично |
| `-sEXPORTED_FUNCTIONS` | Список C функций для экспорта | ⚠️ Обязательно |
| `-sEXPORTED_RUNTIME_METHODS` | JS API для работы с памятью | ⚠️ Обязательно |
| `-sALLOW_MEMORY_GROWTH=1` | Динамическое увеличение памяти | ✅ Рекомендуется |
| `-sNO_EXIT_RUNTIME=1` | Не завершать runtime после main() | ⚠️ Обязательно |

## Пошаговая инструкция сборки

### Шаг 1: Клонирование KTX-Software

```bash
cd /tmp
git clone --depth=1 --branch=v4.2.0 https://github.com/KhronosGroup/KTX-Software.git
cd KTX-Software
```

### Шаг 2: Установка Emscripten SDK

```bash
# Клонировать emsdk
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk

# Установить последнюю версию
./emsdk install latest
./emsdk activate latest

# Активировать окружение
source ./emsdk_env.sh
```

### Шаг 3: Создание CMakeLists.txt патча

Создайте файл `emscripten_fix.cmake` с правильными флагами:

```cmake
# emscripten_fix.cmake - Правильная конфигурация для libktx.mjs

set(CMAKE_EXECUTABLE_SUFFIX ".mjs")

# Базовые флаги оптимизации
set(EMSCRIPTEN_LINK_FLAGS
    "-O3"
    "-sEXPORT_ES6=1"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=createKtxModule"
    "-sENVIRONMENT=web,worker"
)

# Экспортируемые C функции
list(APPEND EMSCRIPTEN_LINK_FLAGS
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_ktxTexture_CreateFromMemory','_ktxTexture_Destroy','_ktxTexture2_TranscodeBasis','_ktxTexture_GetImageOffset','_ktxTexture_GetData','_ktxTexture_GetSize','_ktxTexture_GetDataSize','_ktxTexture_GetVkFormat','_ktxTexture_GetOGLFormat']"
)

# Экспортируемые JS методы
list(APPEND EMSCRIPTEN_LINK_FLAGS
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue','UTF8ToString','lengthBytesUTF8','stringToUTF8']"
)

# Отключение ненужных модулей (экономит ~500 КБ)
list(APPEND EMSCRIPTEN_LINK_FLAGS
    "-sFILESYSTEM=0"           # Отключить FS/TTY/MEMFS
    "-sNO_EXIT_RUNTIME=1"      # Не завершать runtime
    "-sDISABLE_EXCEPTION_CATCHING=0"  # Включить исключения
    "-sASSERTIONS=0"           # Отключить assertion проверки
)

# Настройки памяти
list(APPEND EMSCRIPTEN_LINK_FLAGS
    "-sALLOW_MEMORY_GROWTH=1"
    "-sMAXIMUM_MEMORY=4GB"
    "-sINITIAL_MEMORY=64MB"
    "-sSTACK_SIZE=5MB"
)

# Применить флаги
string(REPLACE ";" " " EMSCRIPTEN_LINK_FLAGS_STR "${EMSCRIPTEN_LINK_FLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${EMSCRIPTEN_LINK_FLAGS_STR}")
```

### Шаг 4: Сборка libktx с правильными флагами

```bash
cd /tmp/KTX-Software

# Создать директорию сборки
mkdir build-wasm
cd build-wasm

# Конфигурирование с Emscripten
emcmake cmake .. \
  -DCMAKE_BUILD_TYPE=Release \
  -DKTX_FEATURE_TESTS=OFF \
  -DKTX_FEATURE_TOOLS=OFF \
  -DKTX_FEATURE_DOC=OFF \
  -DKTX_FEATURE_STATIC_LIBRARY=ON \
  -DKTX_FEATURE_LOADTEST_APPS=OFF \
  -C ../emscripten_fix.cmake

# Сборка
emmake make -j$(nproc)
```

### Шаг 5: Пост-обработка сгенерированного файла

После сборки файл `libktx.mjs` будет находиться в `build-wasm/`.

**Важно:** Нужно добавить `Module.ready` Promise вручно!

Создайте файл `fix-libktx.js`:

```javascript
// fix-libktx.js - Добавляет Module.ready Promise
const fs = require('fs');

const libktxPath = process.argv[2] || 'libktx.mjs';
let code = fs.readFileSync(libktxPath, 'utf8');

// Найти место создания Module
const moduleCreation = 'async function createKtxModule(moduleArg={})';
const readyPromiseInit = `
var readyPromiseResolve, readyPromiseReject;
Module.ready = new Promise((resolve, reject) => {
  readyPromiseResolve = resolve;
  readyPromiseReject = reject;
});
`;

// Вставить после начала функции createKtxModule
code = code.replace(
  moduleCreation + '{',
  moduleCreation + '{' + readyPromiseInit
);

// Найти onRuntimeInitialized и добавить резолв
const runtimeInitPattern = 'Module.onRuntimeInitialized=function(){';
const runtimeInitFixed = `Module.onRuntimeInitialized=function(){
  try{
    Module["ktxTexture"]=Module.texture;
    Module["ErrorCode"]=Module.error_code;
    Module["TranscodeTarget"]=Module.transcode_fmt;
    Module["TranscodeFlags"]=Module.transcode_flag_bits;
    if(readyPromiseResolve){
      readyPromiseResolve(Module);
    }
  }catch(err){
    if(readyPromiseReject){
      readyPromiseReject(err);
    }
    throw err;
  }
`;

code = code.replace(runtimeInitPattern, runtimeInitFixed);

// Исправить locateFile для корректной работы с import.meta.url
code = code.replace(
  'return new URL("libktx.wasm",import.meta.url).href',
  `return scriptDirectory + "libktx.wasm"`
);

fs.writeFileSync(libktxPath, code);
console.log('✅ libktx.mjs исправлен');
```

Запустить:

```bash
node fix-libktx.js build-wasm/libktx.mjs
```

### Шаг 6: Копирование в проект

```bash
cp build-wasm/libktx.mjs /home/user/ktx2-progressive-loader-esm/lib/
cp build-wasm/libktx.wasm /home/user/ktx2-progressive-loader-esm/lib/
```

## Проверка правильной сборки

### Тест 1: Module.ready Promise

```javascript
import createKtxModule from './lib/libktx.mjs';

const ktx = await createKtxModule({
  locateFile: (path) => `/path/to/${path}`
});

// ✅ Должен существовать Promise
console.assert(ktx.ready instanceof Promise, 'Module.ready должен быть Promise');

// ✅ Дождаться инициализации
await ktx.ready;
console.log('✅ Module готов');
```

### Тест 2: Экспортированные функции

```javascript
await ktx.ready;

// ✅ Проверка экспортов
console.assert(ktx.ktxTexture !== undefined, 'ktxTexture должен быть определён');
console.assert(ktx.ErrorCode !== undefined, 'ErrorCode должен быть определён');
console.assert(ktx.TranscodeTarget !== undefined, 'TranscodeTarget должен быть определён');

// ✅ Проверка C функций
console.assert(typeof ktx._malloc === 'function', '_malloc должен быть функцией');
console.assert(typeof ktx._free === 'function', '_free должен быть функцией');

console.log('✅ Все экспорты на месте');
```

### Тест 3: Отсутствие FS/TTY

```javascript
// ❌ Не должно быть
console.assert(ktx.FS === undefined, 'FS должен быть отключён');
console.assert(ktx.TTY === undefined, 'TTY должен быть отключён');
console.assert(ktx.MEMFS === undefined, 'MEMFS должен быть отключён');

console.log('✅ FS/TTY отключены');
```

### Тест 4: Размер файла

```bash
# Правильный размер libktx.mjs должен быть ~150-250 КБ (gzip ~50-70 КБ)
# Если больше 500 КБ - значит FS/TTY всё ещё включены

ls -lh lib/libktx.mjs
```

## Сравнение с официальной сборкой PlayCanvas

Официальный libktx.js от PlayCanvas (basis.js):

```javascript
var libktx = (function() {
  var Module = {
    locateFile: function(path) {
      return '/api/assets/files/libraries/libktx/' + path;
    }
  };

  // ... Emscripten код ...

  Module.ready = new Promise((resolve, reject) => {
    Module.onRuntimeInitialized = () => {
      Module.ktxTexture = Module.texture;
      Module.ErrorCode = Module.error_code;
      Module.TranscodeTarget = Module.transcode_fmt;
      resolve(Module);
    };
  });

  return Module;
})();

export default libktx;
```

**Отличия от нашей сборки:**

1. ✅ PlayCanvas использует IIFE обёртку - мы используем `createKtxModule()`
2. ✅ У них есть `Module.ready` - мы добавляем через `fix-libktx.js`
3. ✅ У них `locateFile` настраивается снаружи - у нас тоже через параметр

## Альтернативный вариант: Готовая сборка от PlayCanvas

Если сборка с нуля сложна, можно взять готовую:

```bash
# Скачать готовый libktx.js от PlayCanvas
curl -O https://code.playcanvas.com/basis/libktx.mjs
curl -O https://code.playcanvas.com/basis/libktx.wasm

# Или из KTX-Software релиза
curl -L -O https://github.com/KhronosGroup/KTX-Software/releases/download/v4.2.0/libktx-wasm.zip
unzip libktx-wasm.zip
```

## Заключение

Правильная сборка libktx.mjs требует:

1. ✅ **MODULARIZE=1 + EXPORT_ES6=1** - ES6 модуль
2. ✅ **FILESYSTEM=0** - отключить FS/TTY
3. ✅ **EXPORTED_FUNCTIONS** - экспортировать C функции
4. ✅ **EXPORTED_RUNTIME_METHODS** - экспортировать JS API
5. ✅ **Module.ready Promise** - добавить вручную
6. ✅ **Правильный locateFile** - через параметры, а не import.meta.url

Размер итогового файла:
- ❌ С FS/TTY: ~800 КБ (сырой), ~200 КБ (gzip)
- ✅ Без FS/TTY: ~200 КБ (сырой), ~60 КБ (gzip)

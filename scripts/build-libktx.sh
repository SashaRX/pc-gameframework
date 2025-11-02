#!/bin/bash
# Скрипт автоматической сборки libktx.mjs с правильными флагами Emscripten

set -e

echo "🔧 Сборка libktx.mjs с правильными параметрами Emscripten"
echo ""

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Параметры
KTX_VERSION="${KTX_VERSION:-v4.2.0}"
WORK_DIR="${WORK_DIR:-/tmp/ktx-build}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "📦 Параметры сборки:"
echo "   KTX Version: $KTX_VERSION"
echo "   Work Dir: $WORK_DIR"
echo "   Project Dir: $PROJECT_DIR"
echo ""

# Проверка Emscripten
if ! command -v emcc &> /dev/null; then
    echo -e "${RED}❌ Emscripten не найден!${NC}"
    echo "Установите Emscripten SDK:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk"
    echo "  ./emsdk install latest"
    echo "  ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

echo -e "${GREEN}✅ Emscripten найден: $(emcc --version | head -n1)${NC}"
echo ""

# Создание рабочей директории
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# Клонирование KTX-Software
if [ ! -d "KTX-Software" ]; then
    echo "📥 Клонирование KTX-Software $KTX_VERSION..."
    git clone --depth=1 --branch="$KTX_VERSION" https://github.com/KhronosGroup/KTX-Software.git
    echo -e "${GREEN}✅ KTX-Software клонирован${NC}"
else
    echo -e "${YELLOW}⚠️  KTX-Software уже клонирован, пропускаем...${NC}"
fi

cd KTX-Software

# Создание CMake патча
echo "📝 Создание emscripten_fix.cmake..."
cat > emscripten_fix.cmake << 'EOF'
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

# Экспортируемые C функции (обёрнуты в двойные кавычки для CMake)
list(APPEND EMSCRIPTEN_LINK_FLAGS
    "-sEXPORTED_FUNCTIONS=[\"_malloc\",\"_free\",\"_ktxTexture_CreateFromMemory\",\"_ktxTexture_Destroy\",\"_ktxTexture2_TranscodeBasis\",\"_ktxTexture_GetImageOffset\",\"_ktxTexture_GetData\",\"_ktxTexture_GetSize\",\"_ktxTexture_GetDataSize\",\"_ktxTexture_GetVkFormat\",\"_ktxTexture_GetOGLFormat\"]"
)

# Экспортируемые JS методы
list(APPEND EMSCRIPTEN_LINK_FLAGS
    "-sEXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"getValue\",\"setValue\",\"UTF8ToString\",\"lengthBytesUTF8\",\"stringToUTF8\"]"
)

# Отключение ненужных модулей (экономит ~500 КБ)
list(APPEND EMSCRIPTEN_LINK_FLAGS
    "-sFILESYSTEM=0"
    "-sNO_EXIT_RUNTIME=1"
    "-sDISABLE_EXCEPTION_CATCHING=0"
    "-sASSERTIONS=0"
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
EOF

echo -e "${GREEN}✅ emscripten_fix.cmake создан${NC}"
echo ""

# Создание директории сборки
rm -rf build-wasm
mkdir build-wasm
cd build-wasm

# Конфигурирование с Emscripten
echo "🔧 Конфигурирование CMake..."
emcmake cmake .. \
  -DCMAKE_BUILD_TYPE=Release \
  -DKTX_FEATURE_TESTS=OFF \
  -DKTX_FEATURE_TOOLS=OFF \
  -DKTX_FEATURE_DOC=OFF \
  -DKTX_FEATURE_STATIC_LIBRARY=ON \
  -DKTX_FEATURE_LOADTEST_APPS=OFF \
  -C ../emscripten_fix.cmake

echo -e "${GREEN}✅ CMake сконфигурирован${NC}"
echo ""

# Сборка
echo "🔨 Сборка libktx..."
emmake make -j$(nproc)

echo -e "${GREEN}✅ Сборка завершена${NC}"
echo ""

# Поиск сгенерированного файла
LIBKTX_MJS=$(find . -name "libktx.mjs" -o -name "msc_basis_transcoder.mjs" | head -n1)
LIBKTX_WASM=$(find . -name "libktx.wasm" -o -name "msc_basis_transcoder.wasm" | head -n1)

if [ -z "$LIBKTX_MJS" ]; then
    echo -e "${RED}❌ libktx.mjs не найден после сборки!${NC}"
    exit 1
fi

echo "📄 Найден: $LIBKTX_MJS"
echo "📄 Найден: $LIBKTX_WASM"
echo ""

# Пост-обработка: добавление Module.ready
echo "🔧 Пост-обработка: добавление Module.ready Promise..."

node << 'EOFNODE' "$LIBKTX_MJS"
const fs = require('fs');
const filePath = process.argv[1];

let code = fs.readFileSync(filePath, 'utf8');

// 1. Добавить readyPromise переменные
const moduleCreation = 'async function createKtxModule(moduleArg={})';
if (code.includes(moduleCreation)) {
    const readyPromiseInit = `
var readyPromiseResolve, readyPromiseReject;
Module.ready = new Promise((resolve, reject) => {
  readyPromiseResolve = resolve;
  readyPromiseReject = reject;
});
`;
    code = code.replace(
        moduleCreation + '{',
        moduleCreation + '{' + readyPromiseInit
    );
    console.log('✅ Добавлен Module.ready Promise');
} else {
    console.warn('⚠️  Не найден createKtxModule, пропускаем Module.ready');
}

// 2. Исправить onRuntimeInitialized для резолва Promise
const runtimeInitPattern = 'Module.onRuntimeInitialized=function(){';
if (code.includes(runtimeInitPattern)) {
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
    console.error('[libktx] Runtime initialization failed:', err);
    if(readyPromiseReject){
      readyPromiseReject(err);
    }
    throw err;
  }
`;
    code = code.replace(runtimeInitPattern, runtimeInitFixed);
    console.log('✅ Исправлен onRuntimeInitialized с резолвом Promise');
} else {
    console.warn('⚠️  Не найден onRuntimeInitialized');
}

// 3. Исправить locateFile (убрать import.meta.url хардкод)
code = code.replace(
    /return new URL\("libktx\.wasm",import\.meta\.url\)\.href/g,
    'return scriptDirectory + "libktx.wasm"'
);
console.log('✅ Исправлен locateFile');

// 4. Убедиться что wasmImports инициализирован
if (code.includes('var info={a:wasmImports}') && !code.includes('var wasmImports=')) {
    // Найти место перед getWasmImports и добавить инициализацию
    code = code.replace(
        'function getWasmImports(){',
        'var wasmImports=wasmExports;function getWasmImports(){'
    );
    console.log('✅ Добавлена инициализация wasmImports');
}

// 5. Убедиться что assignWasmExports определён
if (code.includes('assignWasmExports(wasmExports)') && !code.includes('function assignWasmExports')) {
    code = code.replace(
        'async function createWasm(){',
        'function assignWasmExports(exports){wasmExports=exports}async function createWasm(){'
    );
    console.log('✅ Добавлена функция assignWasmExports');
}

fs.writeFileSync(filePath, code);
console.log('✅ libktx.mjs пост-обработка завершена');
EOFNODE

echo -e "${GREEN}✅ Пост-обработка завершена${NC}"
echo ""

# Копирование в проект
echo "📦 Копирование в проект..."
cp "$LIBKTX_MJS" "$PROJECT_DIR/lib/libktx.mjs"
cp "$LIBKTX_WASM" "$PROJECT_DIR/lib/libktx.wasm"

echo -e "${GREEN}✅ Файлы скопированы в lib/${NC}"
echo ""

# Проверка размера
LIBKTX_SIZE=$(du -h "$PROJECT_DIR/lib/libktx.mjs" | cut -f1)
WASM_SIZE=$(du -h "$PROJECT_DIR/lib/libktx.wasm" | cut -f1)

echo "📊 Размеры файлов:"
echo "   libktx.mjs: $LIBKTX_SIZE"
echo "   libktx.wasm: $WASM_SIZE"
echo ""

if [ ${LIBKTX_SIZE%K} -gt 500 ]; then
    echo -e "${YELLOW}⚠️  Предупреждение: libktx.mjs больше 500 КБ!${NC}"
    echo "   Возможно FS/TTY всё ещё включены"
else
    echo -e "${GREEN}✅ Размер оптимален${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Сборка libktx.mjs завершена успешно!${NC}"
echo ""
echo "Следующие шаги:"
echo "1. Проверьте lib/libktx.mjs"
echo "2. Запустите тесты: npm test"
echo "3. Загрузите в PlayCanvas: npm run build-push:debug"

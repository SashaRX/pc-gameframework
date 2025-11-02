#!/bin/bash
# Автоматическое применение патча к CMakeLists.txt KTX-Software

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo -e "${GREEN}🔧 Применение патча к CMakeLists.txt KTX-Software${NC}"
echo ""

# Проверка аргумента
if [ -z "$1" ]; then
    echo -e "${RED}❌ Ошибка: Укажите путь к KTX-Software${NC}"
    echo "Использование: $0 /path/to/KTX-Software"
    exit 1
fi

KTX_DIR="$1"

if [ ! -d "$KTX_DIR" ]; then
    echo -e "${RED}❌ Директория не найдена: $KTX_DIR${NC}"
    exit 1
fi

CMAKE_FILE="$KTX_DIR/CMakeLists.txt"

if [ ! -f "$CMAKE_FILE" ]; then
    echo -e "${RED}❌ CMakeLists.txt не найден: $CMAKE_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Найден: $CMAKE_FILE${NC}"
echo ""

# Создать бэкап
BACKUP_FILE="$CMAKE_FILE.backup.$(date +%Y%m%d_%H%M%S)"
cp "$CMAKE_FILE" "$BACKUP_FILE"
echo -e "${GREEN}✅ Создан бэкап: $BACKUP_FILE${NC}"
echo ""

# Применить патч с помощью sed/awk
echo -e "${YELLOW}🔧 Применение патча...${NC}"

# Создать временный файл с патчем
TEMP_PATCH=$(mktemp)

cat > "$TEMP_PATCH" << 'EOFPATCH'
# Список экспортируемых C функций
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
)

# Построение JSON для EXPORTED_FUNCTIONS
set(_json "[")
foreach(sym IN LISTS KTX_EXPORTS_LIST)
  string(APPEND _json "\\\"${sym}\\\",")
endforeach()
string(REGEX REPLACE ",$" "" _json "${_json}")
string(APPEND _json "]")

set(KTX_EXPORTED_FUNCTIONS_ARG "SHELL:-sEXPORTED_FUNCTIONS=${_json}")
message(STATUS "EXPORTED_FUNCTIONS: ${KTX_EXPORTED_FUNCTIONS_ARG}")

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

add_executable( ktx_js
    ${KTX_JS_COMMON_SOURCE}
    interface/js_binding/vk_format.inl
)
target_compile_definitions(ktx_js PUBLIC KTX_FEATURE_WRITE)
target_link_libraries( ktx_js ktx )
target_include_directories(
    ktx_js
PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/other_include
    ${CMAKE_CURRENT_SOURCE_DIR}/lib/src
    $<TARGET_PROPERTY:ktx,INTERFACE_INCLUDE_DIRECTORIES>
)
target_link_options(
    ktx_js
PUBLIC
    ${KTX_EM_COMMON_KTX_LINK_FLAGS}
    "SHELL:-s EXPORT_NAME=createKtxModule"
    "SHELL:-s ENVIRONMENT=web,worker"
    "SHELL:-s MAXIMUM_MEMORY=4GB"
    "SHELL:-s INITIAL_MEMORY=64MB"
    ${KTX_EXPORTED_FUNCTIONS_ARG}
)
set_target_properties( ktx_js PROPERTIES OUTPUT_NAME "libktx")

add_custom_command(
    TARGET ktx_js
    POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE_DIR:ktx_js>/$<TARGET_FILE_PREFIX:ktx_js>$<TARGET_FILE_BASE_NAME:ktx_js>.js" "${PROJECT_SOURCE_DIR}/tests/webgl"
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE_DIR:ktx_js>/$<TARGET_FILE_PREFIX:ktx_js>$<TARGET_FILE_BASE_NAME:ktx_js>.wasm" "${PROJECT_SOURCE_DIR}/tests/webgl"
    COMMENT "Copy libktx.js and libktx.wasm to tests/webgl"
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

add_executable( ktx_js_read
    ${KTX_JS_COMMON_SOURCE}
)
target_link_libraries( ktx_js_read ktx_read )
target_include_directories(
    ktx_js_read
PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/other_include
    ${CMAKE_CURRENT_SOURCE_DIR}/lib/src
    $<TARGET_PROPERTY:ktx_read,INTERFACE_INCLUDE_DIRECTORIES>
)
target_link_options(
    ktx_js_read
PUBLIC
    ${KTX_EM_COMMON_KTX_LINK_FLAGS}
    "SHELL:-s EXPORT_NAME=createKtxReadModule"
    "SHELL:-s ENVIRONMENT=web,worker"
    "SHELL:-s MAXIMUM_MEMORY=4GB"
    "SHELL:-s INITIAL_MEMORY=64MB"
    ${KTX_EXPORTED_FUNCTIONS_ARG}
)
set_target_properties( ktx_js_read PROPERTIES OUTPUT_NAME "libktx_read")

add_custom_command(
    TARGET ktx_js_read
    POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE_DIR:ktx_js_read>/$<TARGET_FILE_PREFIX:ktx_js_read>$<TARGET_FILE_BASE_NAME:ktx_js_read>.js" "${PROJECT_SOURCE_DIR}/tests/webgl"
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE_DIR:ktx_js_read>/$<TARGET_FILE_PREFIX:ktx_js_read>$<TARGET_FILE_BASE_NAME:ktx_js_read>.wasm" "${PROJECT_SOURCE_DIR}/tests/webgl"
    COMMENT "Copy libktx_read.js and libktx_read.wasm to tests/webgl"
)

install(TARGETS ktx_js_read
    RUNTIME
        DESTINATION .
        COMPONENT ktx_js_read
)
install(FILES ${CMAKE_BINARY_DIR}/libktx_read.wasm
    DESTINATION .
    COMPONENT ktx_js_read
)

add_executable( msc_basis_transcoder_js interface/js_binding/transcoder_wrapper.cpp )
target_link_libraries( msc_basis_transcoder_js ktx_read )
target_include_directories( msc_basis_transcoder_js
    PRIVATE
    lib
    external
    external/basisu/transcoder
)

target_compile_options(msc_basis_transcoder_js
PRIVATE
   $<TARGET_PROPERTY:ktx_read,INTERFACE_COMPILE_OPTIONS>
)

target_link_options(
    msc_basis_transcoder_js
PUBLIC
    ${KTX_EM_COMMON_LINK_FLAGS}
    "SHELL:-s EXPORT_NAME=MSC_TRANSCODER"
    "SHELL:-s ENVIRONMENT=web,worker"
    $<TARGET_PROPERTY:ktx_read,INTERFACE_LINK_OPTIONS>
)
set_target_properties( msc_basis_transcoder_js PROPERTIES OUTPUT_NAME "msc_basis_transcoder")

add_custom_command(
    TARGET msc_basis_transcoder_js
    POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE_DIR:msc_basis_transcoder_js>/$<TARGET_FILE_PREFIX:msc_basis_transcoder_js>$<TARGET_FILE_BASE_NAME:msc_basis_transcoder_js>.js" "${PROJECT_SOURCE_DIR}/tests/webgl"
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE_DIR:msc_basis_transcoder_js>/$<TARGET_FILE_PREFIX:msc_basis_transcoder_js>$<TARGET_FILE_BASE_NAME:msc_basis_transcoder_js>.wasm" "${PROJECT_SOURCE_DIR}/tests/webgl"
    COMMENT "Copy msc_basis_transcoder.js and msc_basis_transcoder.wasm to tests/webgl"
)

install(TARGETS msc_basis_transcoder_js
    RUNTIME
        DESTINATION .
        COMPONENT msc_basis_transcoder_js
)
install(FILES ${CMAKE_BINARY_DIR}/msc_basis_transcoder.wasm
    DESTINATION .
    COMPONENT msc_basis_transcoder_js
)
EOFPATCH

# Применить патч: найти блок if(EMSCRIPTEN AND KTX_FEATURE_JS) и заменить до endif()
python3 - "$CMAKE_FILE" "$TEMP_PATCH" << 'EOFPYTHON'
import sys
import re

cmake_file = sys.argv[1]
patch_file = sys.argv[2]

with open(cmake_file, 'r') as f:
    content = f.read()

with open(patch_file, 'r') as f:
    patch_content = f.read()

# Найти блок if(EMSCRIPTEN AND KTX_FEATURE_JS) ... endif()
pattern = r'if\(EMSCRIPTEN AND KTX_FEATURE_JS\).*?endif\(\)'
replacement = f'if(EMSCRIPTEN AND KTX_FEATURE_JS)\n{patch_content}endif()'

new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)

if new_content == content:
    print("⚠️  Блок if(EMSCRIPTEN AND KTX_FEATURE_JS) не найден!")
    sys.exit(1)

with open(cmake_file, 'w') as f:
    f.write(new_content)

print(f"✅ Патч успешно применён к {cmake_file}")
EOFPYTHON

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Патч успешно применён!${NC}"
    echo ""
    echo -e "${YELLOW}📝 Изменения:${NC}"
    echo "   • Добавлен EXPORT_ES6=1 (ES6 модуль)"
    echo "   • Добавлен FILESYSTEM=0 (убирает FS/TTY)"
    echo "   • Добавлены EXPORTED_FUNCTIONS (C функции)"
    echo "   • Расширен EXPORTED_RUNTIME_METHODS"
    echo "   • Добавлены флаги оптимизации памяти"
    echo ""
    echo -e "${GREEN}🚀 Следующие шаги:${NC}"
    echo "   1. cd $KTX_DIR"
    echo "   2. mkdir build-wasm && cd build-wasm"
    echo "   3. emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DKTX_FEATURE_JS=ON -DKTX_FEATURE_TESTS=OFF -DKTX_FEATURE_TOOLS=OFF"
    echo "   4. emmake make -j\$(nproc)"
    echo "   5. node ${PROJECT_DIR}/scripts/quick-fix-libktx.mjs libktx.js"
else
    echo -e "${RED}❌ Ошибка при применении патча${NC}"
    echo -e "${YELLOW}Восстановление из бэкапа...${NC}"
    cp "$BACKUP_FILE" "$CMAKE_FILE"
    exit 1
fi

rm -f "$TEMP_PATCH"

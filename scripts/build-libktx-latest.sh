#!/bin/bash
# Автоматическая сборка libktx.mjs с последней версией KTX-Software

set -e

echo "🔧 Сборка libktx.mjs с правильными параметрами Emscripten (последняя версия KTX-Software)"
echo ""

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Параметры
KTX_VERSION="${KTX_VERSION:-main}"  # Используем main вместо конкретной версии
WORK_DIR="${WORK_DIR:-/tmp/ktx-build-latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo -e "${CYAN}📦 Параметры сборки:${NC}"
echo "   KTX Version: $KTX_VERSION (последняя)"
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
    echo -e "${CYAN}📥 Клонирование KTX-Software (последняя версия)...${NC}"
    git clone --depth=1 https://github.com/KhronosGroup/KTX-Software.git
    echo -e "${GREEN}✅ KTX-Software клонирован${NC}"
else
    echo -e "${YELLOW}⚠️  KTX-Software уже клонирован, обновляем...${NC}"
    cd KTX-Software
    git pull
    cd ..
fi

cd KTX-Software

# Применение патча
echo ""
echo -e "${CYAN}🔧 Применение патча к CMakeLists.txt...${NC}"
bash "$SCRIPT_DIR/apply-cmake-patch.sh" "$WORK_DIR/KTX-Software"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Ошибка при применении патча${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Патч применён успешно${NC}"
echo ""

# Создание директории сборки
rm -rf build-wasm
mkdir build-wasm
cd build-wasm

# Конфигурирование с Emscripten
echo -e "${CYAN}🔧 Конфигурирование CMake...${NC}"
emcmake cmake .. \
  -DCMAKE_BUILD_TYPE=Release \
  -DKTX_FEATURE_TESTS=OFF \
  -DKTX_FEATURE_TOOLS=OFF \
  -DKTX_FEATURE_DOC=OFF \
  -DKTX_FEATURE_LOADTEST_APPS=OFF \
  -DKTX_FEATURE_JS=ON

echo -e "${GREEN}✅ CMake сконфигурирован${NC}"
echo ""

# Сборка
echo -e "${CYAN}🔨 Сборка libktx...${NC}"
emmake make -j$(nproc)

echo -e "${GREEN}✅ Сборка завершена${NC}"
echo ""

# Поиск сгенерированных файлов
LIBKTX_JS=$(find . -name "libktx.js" | head -n1)
LIBKTX_WASM=$(find . -name "libktx.wasm" | head -n1)

if [ -z "$LIBKTX_JS" ]; then
    echo -e "${RED}❌ libktx.js не найден после сборки!${NC}"
    exit 1
fi

echo -e "${CYAN}📄 Найден: $LIBKTX_JS${NC}"
echo -e "${CYAN}📄 Найден: $LIBKTX_WASM${NC}"
echo ""

# Пост-обработка: добавление Module.ready
echo -e "${CYAN}🔧 Пост-обработка: добавление Module.ready Promise...${NC}"

node "$SCRIPT_DIR/quick-fix-libktx.mjs" "$LIBKTX_JS"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Пост-обработка завершена${NC}"
else
    echo -e "${YELLOW}⚠️  Ошибка пост-обработки, но файл может быть рабочим${NC}"
fi

echo ""

# Копирование в проект
echo -e "${CYAN}📦 Копирование в проект...${NC}"
cp "$LIBKTX_JS" "$PROJECT_DIR/lib/libktx.mjs"
cp "$LIBKTX_WASM" "$PROJECT_DIR/lib/libktx.wasm"

echo -e "${GREEN}✅ Файлы скопированы в lib/${NC}"
echo ""

# Проверка размера
LIBKTX_SIZE=$(du -h "$PROJECT_DIR/lib/libktx.mjs" | cut -f1)
WASM_SIZE=$(du -h "$PROJECT_DIR/lib/libktx.wasm" | cut -f1)

echo -e "${CYAN}📊 Размеры файлов:${NC}"
echo "   libktx.mjs: $LIBKTX_SIZE"
echo "   libktx.wasm: $WASM_SIZE"
echo ""

# Запуск тестов
echo -e "${CYAN}🧪 Запуск тестов...${NC}"
node "$SCRIPT_DIR/test-libktx.mjs"

echo ""
echo -e "${GREEN}🎉 Сборка libktx.mjs завершена успешно!${NC}"
echo ""
echo -e "${CYAN}Следующие шаги:${NC}"
echo "1. Проверьте lib/libktx.mjs"
echo "2. Запустите тесты: npm test"
echo "3. Загрузите в PlayCanvas: npm run build-push:debug"
echo ""
echo -e "${YELLOW}📝 Примечание:${NC}"
echo "   Файлы собраны с оптимальными флагами:"
echo "   • ES6 модуль (export default)"
echo "   • FILESYSTEM=0 (без FS/TTY)"
echo "   • Module.ready Promise"
echo "   • Все C функции экспортированы"

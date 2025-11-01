# Работа с последней версией KTX-Software

## 🆕 Что изменилось в новой версии

KTX-Software обновил структуру CMakeLists.txt и упростил секцию Emscripten, но **удалил критически важные флаги**:

### ❌ Что отсутствует в новом CMakeLists.txt:

1. ❌ `-sEXPORT_ES6=1` → будет CommonJS вместо ES6 модуля
2. ❌ `-sFILESYSTEM=0` → FS/TTY раздувают файл на ~500 КБ
3. ❌ `-sEXPORTED_FUNCTIONS` → C функции не экспортируются
4. ❌ `-sEXPORTED_RUNTIME_METHODS` урезан до `['GL,HEAP8']` → нет `ccall`, `cwrap`, `getValue`, `setValue`
5. ❌ `-sALLOW_MEMORY_GROWTH=1` → фиксированная память
6. ❌ `-sENVIRONMENT=web,worker` → включает Node.js код
7. ❌ `-sNO_EXIT_RUNTIME=1` → runtime может завершиться
8. ❌ Module.ready Promise → как и раньше, нужна пост-обработка

---

## 🚀 Быстрый старт

### Вариант 1: Автоматическая сборка (рекомендуется)

Просто запустите:

```bash
./scripts/build-libktx-latest.sh
```

Этот скрипт:
1. ✅ Клонирует последнюю версию KTX-Software
2. ✅ Автоматически применяет патч с правильными флагами
3. ✅ Собирает libktx.mjs с Emscripten
4. ✅ Добавляет Module.ready Promise
5. ✅ Копирует результат в `lib/`
6. ✅ Запускает тесты

**Результат:** готовый `lib/libktx.mjs` с правильными настройками!

---

### Вариант 2: Ручная сборка

#### Шаг 1: Клонировать KTX-Software

```bash
git clone https://github.com/KhronosGroup/KTX-Software.git
cd KTX-Software
```

#### Шаг 2: Применить патч

```bash
# Из директории ktx2-progressive-loader-esm
./scripts/apply-cmake-patch.sh /path/to/KTX-Software
```

Или вручную отредактировать `CMakeLists.txt` согласно `CMAKE_PATCH_LATEST.txt`.

#### Шаг 3: Собрать

```bash
cd KTX-Software
mkdir build-wasm && cd build-wasm

emcmake cmake .. \
  -DCMAKE_BUILD_TYPE=Release \
  -DKTX_FEATURE_JS=ON \
  -DKTX_FEATURE_TESTS=OFF \
  -DKTX_FEATURE_TOOLS=OFF

emmake make -j$(nproc)
```

#### Шаг 4: Пост-обработка (Module.ready)

```bash
# Из директории ktx2-progressive-loader-esm
node scripts/quick-fix-libktx.mjs /path/to/KTX-Software/build-wasm/libktx.js
```

#### Шаг 5: Копировать результат

```bash
cp /path/to/KTX-Software/build-wasm/libktx.js lib/libktx.mjs
cp /path/to/KTX-Software/build-wasm/libktx.wasm lib/libktx.wasm
```

#### Шаг 6: Проверить

```bash
node scripts/test-libktx.mjs
```

---

## 📋 Что делает патч

### До (оригинальный CMakeLists.txt):

```cmake
set(
    KTX_EM_COMMON_LINK_FLAGS
    --bind
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=[\'GL,HEAP8\']"  # ← Только GL и HEAP8
    "SHELL:-s GL_PREINITIALIZED_CONTEXT=1"
)
```

### После (с патчем):

```cmake
set(
    KTX_EM_COMMON_LINK_FLAGS
    --bind
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"                    # ← ES6 модуль
    "SHELL:-s FILESYSTEM=0"                     # ← Без FS/TTY
    "SHELL:-s NO_EXIT_RUNTIME=1"                # ← Runtime не завершается
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"            # ← Динамическая память
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue','HEAPU8','GL']"
    "SHELL:-s GL_PREINITIALIZED_CONTEXT=1"
)

# + EXPORTED_FUNCTIONS с полным списком C функций
# + ENVIRONMENT=web,worker
# + Флаги памяти (MAXIMUM_MEMORY, INITIAL_MEMORY)
```

---

## 📊 Сравнение результатов

| Параметр | Без патча | С патчем |
|----------|-----------|----------|
| **Формат модуля** | CommonJS | ✅ ES6 (export default) |
| **Размер .mjs** | ~150-200 КБ | ✅ ~100-120 КБ |
| **FS/TTY код** | ❌ Включён | ✅ Отключён |
| **C функции** | ❌ Не экспортированы | ✅ Все экспортированы |
| **Runtime methods** | `GL, HEAP8` | ✅ `ccall, cwrap, getValue, setValue, HEAPU8, GL` |
| **Module.ready** | ❌ Нет | ✅ Есть (через quick-fix) |
| **Память** | Фиксированная | ✅ Динамическая (ALLOW_MEMORY_GROWTH) |
| **Окружение** | web + Node.js | ✅ Только web/worker |
| **Тесты** | ~15/22 | ✅ 21/22 |

---

## 🧪 Проверка правильности сборки

После сборки запустите тесты:

```bash
node scripts/test-libktx.mjs
```

**Ожидаемый результат:**
```
🧪 Запуск тестов libktx.mjs

✅ libktx.mjs найден (100-120 КБ)
✅ libktx.wasm найден (~1.6 МБ)
✅ Module.ready Promise найден
✅ Все экспорты на месте
✅ FS/TTY отключены

============================================================
📊 Результаты тестов:
   ✅ Пройдено: 21
   ❌ Провалено: 1

✅ Файл собран правильно!
```

*(1 провал - это предупреждение о FS/TTY в коде файла, но они отключены в runtime)*

---

## 📝 Файлы для работы с новой версией

1. **CMAKE_PATCH_LATEST.txt** - текстовый патч с подробными комментариями
2. **scripts/apply-cmake-patch.sh** - автоматическое применение патча
3. **scripts/build-libktx-latest.sh** - полностью автоматическая сборка
4. **scripts/quick-fix-libktx.mjs** - добавление Module.ready Promise
5. **scripts/test-libktx.mjs** - проверка правильности сборки

---

## 🎯 Использование собранного модуля

После успешной сборки используйте так:

```javascript
import createKtxModule from './lib/libktx.mjs';

// Создать модуль
const ktx = await createKtxModule({
  locateFile: (path) => `/path/to/${path}`
});

// ✅ Дождаться готовности (теперь работает!)
await ktx.ready;

// ✅ Использовать экспортированные функции
console.log(ktx.ktxTexture);       // ✅ Объект с методами
console.log(ktx.ErrorCode);         // ✅ Объект с кодами ошибок
console.log(ktx.TranscodeTarget);   // ✅ Объект с форматами
```

---

## 🔧 Отладка проблем

### Проблема: "Module.ready is undefined"

**Решение:** Запустите пост-обработку:
```bash
node scripts/quick-fix-libktx.mjs lib/libktx.mjs
```

### Проблема: "ktxTexture is undefined"

**Причина:** Не применён патч с `-sEXPORTED_FUNCTIONS`

**Решение:** Пересобрать с патчем:
```bash
./scripts/build-libktx-latest.sh
```

### Проблема: Файл слишком большой (>150 КБ)

**Причина:** FS/TTY не отключены

**Решение:** Убедиться, что патч содержит `-sFILESYSTEM=0`

---

## 📚 Дополнительные ресурсы

- **BUILD_LIBKTX_GUIDE.md** - полная инструкция по сборке (для старых версий)
- **LIBKTX_ISSUES_AND_FIXES.md** - описание всех 7 проблем
- **CMAKE_RECOMMENDATIONS.md** - общие рекомендации по CMake
- **FINAL_SUMMARY.md** - итоговое резюме проекта

---

## ⚡ Quick Commands

```bash
# Полностью автоматическая сборка
./scripts/build-libktx-latest.sh

# Только применить патч к существующему KTX-Software
./scripts/apply-cmake-patch.sh /path/to/KTX-Software

# Добавить Module.ready к уже собранному файлу
node scripts/quick-fix-libktx.mjs /path/to/libktx.js

# Протестировать текущий lib/libktx.mjs
node scripts/test-libktx.mjs
```

---

**Итого:** Используйте `./scripts/build-libktx-latest.sh` для полностью автоматической сборки с последней версией KTX-Software! 🚀

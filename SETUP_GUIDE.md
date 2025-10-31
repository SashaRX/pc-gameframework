# 🚀 PlayCanvas Setup Guide - KTX2 Progressive Loader

Пошаговая инструкция для интеграции с PlayCanvas Editor.

## Шаг 1: Подготовка проекта

### 1.1 Установка зависимостей

```bash
npm install
```

### 1.2 Сборка проекта

```bash
npm run build:debug
```

После сборки в папке `build/` должны появиться:
- ✅ `main.bundle.js` - основной скрипт
- ✅ `libktx.mjs` - библиотека транскодинга
- ✅ `libktx.wasm` - WASM модуль

---

## Шаг 2: Настройка PlayCanvas Sync

### 2.1 Скопировать конфиг в домашнюю директорию

**Windows:**
```bash
copy .pcconfig C:\Users\<ВашеИмя>\.pcconfig
```

**Mac/Linux:**
```bash
cp .pcconfig ~/.pcconfig
```

### 2.2 Создать локальный конфиг проекта

```bash
copy pcconfig.template.json pcconfig.json
```

### 2.3 Заполнить `pcconfig.json`

Откройте `pcconfig.json` и заполните:

```json
{
  "PLAYCANVAS_API_KEY": "ваш_api_ключ_здесь",
  "PLAYCANVAS_BRANCH_ID": "ваш_branch_id",
  "PLAYCANVAS_PROJECT_ID": 1234567,
  "PLAYCANVAS_BAD_FILE_REG": "^\\.|~$",
  "PLAYCANVAS_BAD_FOLDER_REG": "^\\.|typings|node_modules",
  "PLAYCANVAS_TARGET_SUBDIR": "build"
}
```

**Где взять данные:**
- **API Key**: PlayCanvas Editor → Settings → API → New API Key
- **Project ID**: URL проекта → `https://playcanvas.com/editor/project/1234567`
- **Branch ID**: Editor → Version Control → Branch dropdown → копировать ID

---

## Шаг 3: Загрузка в PlayCanvas Editor

### 3.1 Автоматическая загрузка (рекомендуется)

```bash
npm run build-push:debug
```

Эта команда:
1. Соберёт TypeScript → `build/main.bundle.js`
2. Загрузит `build/` в PlayCanvas автоматически

### 3.2 Ручная загрузка (если sync не работает)

1. Откройте PlayCanvas Editor
2. Перейдите в **Assets**
3. Загрузите файлы из папки `build/`:
   - `main.bundle.js` (как Script)
   - `libktx.mjs` (как Script)
   - `libktx.wasm` (как Binary)

---

## Шаг 4: Создание тестовой сцены

### 4.1 Создать Entity с моделью

1. **Hierarchy** → Правый клик → **New Entity** → **Box** (или Plane)
2. Назовите entity: "TextureTest"

### 4.2 Добавить скрипт ktx2Loader

1. Выберите entity "TextureTest"
2. **Inspector** → **Add Component** → **Script**
3. **Add Script** → Найдите **"ktx2Loader"**
4. Если скрипт не найден → нажмите **Parse** рядом с `main.bundle.js` в Assets

### 4.3 Настроить атрибуты скрипта

В **Inspector** настройте параметры ktx2Loader:

| Параметр | Значение | Описание |
|----------|----------|----------|
| **KTX2 URL** | `https://example.com/test.ktx2` | URL вашего KTX2 файла |
| **Progressive Loading** | ✅ | Включить прогрессивную загрузку |
| **Is sRGB** | ⬜ | ✅ для albedo, ⬜ для normal/roughness |
| **Verbose Logging** | ✅ | Подробные логи в консоли |
| **Enable Cache** | ✅ | Кэширование в IndexedDB |
| **Use Worker** | ⬜ | Web Worker (пока не реализован) |
| **Adaptive Loading** | ⬜ | Остановка на разрешении экрана |
| **Step Delay Ms** | `150` | Задержка между уровнями (мс) |

---

## Шаг 5: Подготовка KTX2 файла

### 5.1 Конвертация текстуры

Используйте [toktx](https://github.com/KhronosGroup/KTX-Software/releases):

```bash
# Basis универсальное сжатие
toktx --bcmp --genmipmap texture.ktx2 input.png

# UASTC высокое качество
toktx --uastc --uastc_quality 2 --genmipmap texture.ktx2 input.png
```

### 5.2 Размещение файла

**Важно:** Хостинг ДОЛЖЕН поддерживать HTTP Range requests!

**✅ Рекомендуется:**
- Cloudflare R2
- AWS S3
- Google Cloud Storage
- Vercel Blob
- Любой CDN с Range поддержкой

**❌ НЕ работает:**
- GitHub Pages (нет Range support)
- Некоторые shared hosting

**Проверка Range поддержки:**
```bash
curl -I https://ваш-сервер.com/texture.ktx2
# Должен вернуть: Accept-Ranges: bytes
```

### 5.3 Тестовый KTX2 файл (для быстрого старта)

Можно использовать публичный тестовый файл:
```
https://cdn.akamai.steamstatic.com/apps/steamvr/vrsettings/preview.ktx2
```

---

## Шаг 6: Запуск и тестирование

### 6.1 Запустить сцену

1. **PlayCanvas Editor** → кнопка **Launch** (▶)
2. Откроется новое окно с вашей сценой

### 6.2 Проверить консоль браузера

Нажмите **F12** → вкладка **Console**

**Успешная загрузка выглядит так:**

```
[KTX2] Initializing loader...
[KTX2] Loading libktx module on main thread...
[KTX2] libktx module loaded successfully
[KTX2] Loader ready

[KTX2] Probing: https://example.com/texture.ktx2
[KTX2] HEAD response: {
  fileSize: "4.25 MB",
  supportsRanges: true
}

[KTX2] Probe complete: {
  size: "2048x2048",
  levels: 12,
  fileSize: "4.25 MB",
  colorSpace: "Linear",
  supportsRanges: true
}

[KTX2] Repacked level 11: {
  originalSize: "0.02 KB",
  miniKtxSize: "0.15 KB",
  dimensions: "1x1",
  overhead: "0.13 KB"
}

[KTX2] Uploaded level 11 to GPU: 1x1 (4.00 KB)
[KTX2] Level 11: 1x1 (45.2ms)

[KTX2] Repacked level 10: {
  originalSize: "0.05 KB",
  miniKtxSize: "0.18 KB",
  dimensions: "2x2",
  overhead: "0.13 KB"
}

[KTX2] Uploaded level 10 to GPU: 2x2 (16.00 KB)
[KTX2] Level 10: 2x2 (38.7ms)

... (loading continues) ...

[KTX2] Loading complete: {
  totalTime: "2.34s",
  levelsLoaded: 12,
  levelsCached: 0,
  downloaded: "4.25 MB",
  transcoded: "16.00 MB"
}
```

### 6.3 Визуальная проверка

Вы должны увидеть:
1. **Сначала** - размытая low-res текстура на модели
2. **Постепенно** - текстура становится четче
3. **В конце** - финальная high-res текстура

---

## Шаг 7: Режим разработки (Watch mode)

Для автоматической пересборки при изменении кода:

```bash
npm run watch-push:debug
```

Теперь при сохранении файлов в `src/`:
1. TypeScript автоматически пересоберётся
2. `build/main.bundle.js` обновится
3. Файл автоматически загрузится в PlayCanvas

**В PlayCanvas Editor:**
- Нажмите **Refresh** в Assets панели
- Или перезапустите **Launch**

---

## 🐛 Решение проблем

### Ошибка: "ktx2Loader script not found"

**Решение:**
1. Откройте Assets в PlayCanvas Editor
2. Найдите `main.bundle.js`
3. Нажмите **Parse** (справа от файла)
4. Подождите завершения парсинга
5. Попробуйте снова добавить скрипт к entity

### Ошибка: "libktx not initialized"

**Причины:**
- Файлы `libktx.mjs` и `libktx.wasm` не загружены в Assets
- Файлы не помечены как Scripts

**Решение:**
1. Проверьте, что оба файла есть в Assets
2. `libktx.mjs` должен иметь тип **Script**
3. `libktx.wasm` должен иметь тип **Binary**

### Ошибка: "Failed to load libktx module"

**Решение:**
```typescript
// В Ktx2LoaderScript.ts измените:
const libktxMjsUrl = this.app.assets.find('libktx.mjs')?.getFileUrl();

// На:
const libktxMjsUrl = this.app.assets.find('libktx.mjs', 'script')?.getFileUrl();
```

### Текстура не загружается

**Проверьте:**
1. URL корректный и доступен (откройте в браузере)
2. Сервер поддерживает CORS
3. Сервер поддерживает HTTP Range requests
4. Entity имеет Model компонент
5. В консоли нет ошибок

**Тест Range support:**
```bash
curl -I https://your-server.com/texture.ktx2
```

Должен вернуть:
```
Accept-Ranges: bytes
```

### Медленная загрузка

**Оптимизация:**
1. Уменьшите `stepDelayMs` (например, до 50-100ms)
2. Включите `adaptiveLoading` для остановки на нужном разрешении
3. Используйте CDN с хорошей скоростью
4. Уменьшите размер KTX2 файла:
   ```bash
   toktx --bcmp --clevel 4 --qlevel 128 texture.ktx2 input.png
   ```

---

## 📊 Мониторинг производительности

### Открыть Performance Monitor

**Chrome DevTools:**
1. **F12** → вкладка **Performance**
2. Нажмите **Record** (●)
3. Запустите загрузку текстуры
4. Остановите запись
5. Проверьте:
   - FPS не падает ниже 30
   - Main thread не блокируется надолго

### Проверить память

**Chrome DevTools:**
1. **F12** → вкладка **Memory**
2. **Take heap snapshot**
3. Загрузите текстуру
4. **Take heap snapshot** снова
5. Проверьте прирост памяти

**Ожидаемые значения:**
- Heap увеличивается на размер RGBA текстуры
- После загрузки старые уровни должны очиститься

---

## 🎯 Следующие шаги

### Milestone C - Производительность

1. **Web Worker для транскодинга**
   - Разблокировать main thread
   - FPS остаётся 60 при загрузке

2. **Расширенное кэширование**
   - Сохранение метаданных
   - Автоочистка старых кэшей

3. **Мониторинг памяти**
   - Автоматический контроль HEAPU8
   - Предупреждения при превышении лимитов

### Поддержка

- GitHub Issues: https://github.com/SashaRX/ktx2-progressive-loader-esm/issues
- KTX2 Spec: https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html
- PlayCanvas Docs: https://developer.playcanvas.com/

---

**Успешной интеграции! 🚀**

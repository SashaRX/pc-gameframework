# 🚀 Quick Start: ESM Version

Быстрый старт для интеграции KTX2 Progressive Loader с PlayCanvas Editor (ESM Scripts).

## Шаг 1: Сборка проекта

```bash
npm install
npm run build:esm
```

После успешной сборки в папке `build/esm/` будут файлы:

```
build/esm/
├── Ktx2LoaderScript.mjs          # Главный скрипт
├── ktx2-loader/
│   ├── Ktx2ProgressiveLoader.js  # Основной загрузчик
│   ├── KtxCacheManager.js        # Кэш менеджер
│   ├── types.js                  # TypeScript типы
│   └── utils/
│       ├── alignment.js          # Утилиты выравнивания
│       └── colorspace.js         # Парсинг цветового пространства
├── libktx.mjs                    # Библиотека транскодинга
└── libktx.wasm                   # WASM модуль
```

## Шаг 2: Загрузка в PlayCanvas Editor

### 2.1 Открыть PlayCanvas Editor

Перейдите в ваш проект на https://playcanvas.com/editor/

### 2.2 Загрузить файлы

**Вариант A: Drag & Drop (рекомендуется)**

1. Откройте папку `build/esm/` в файловом менеджере
2. Выделите ВСЕ файлы и папки
3. Перетащите их в панель **Assets** в PlayCanvas Editor
4. Дождитесь завершения загрузки

**Вариант B: Через меню Upload**

1. В PlayCanvas Editor → **Assets** панель
2. Правый клик → **Upload**
3. Выберите все файлы из `build/esm/`
4. Нажмите **Open**

### 2.3 Проверить типы файлов

Убедитесь, что типы файлов установлены правильно:

| Файл | Тип в Editor |
|------|-------------|
| `Ktx2LoaderScript.mjs` | **Script** ✅ |
| `ktx2-loader/*.js` | **Script** ✅ |
| `libktx.mjs` | **Script** ✅ |
| `libktx.wasm` | **Binary** ✅ |

Если тип неправильный:
1. Выберите файл в Assets
2. **Inspector** → **Type** → выберите правильный тип
3. Нажмите **Apply**

## Шаг 3: Добавить скрипт на Entity

### 3.1 Создать тестовую сцену

1. **Hierarchy** → Правый клик → **New Entity** → **Box** (или **Plane**)
2. Назовите entity: `TextureBox`

### 3.2 Добавить Script Component

1. Выберите `TextureBox` entity
2. **Inspector** → **Add Component** → **Script**

### 3.3 Добавить Ktx2LoaderScriptESM

1. В Script Component → **Add Script**
2. Найдите `Ktx2LoaderScriptESM` в списке
3. Нажмите на него для добавления

**Если скрипт не найден:**
- Нажмите **Refresh** в Assets панели
- Или найдите `Ktx2LoaderScript.mjs` в Assets → нажмите **Parse**

### 3.4 Настроить параметры

В **Inspector** заполните параметры скрипта:

**Обязательные:**
- **KTX2 URL**: `https://example.com/texture.ktx2`
  _(Замените на URL вашего KTX2 файла)_

**Рекомендуемые настройки для тестирования:**
- ✅ **Progressive Loading**: Включено
- ✅ **Verbose Logging**: Включено
- ✅ **Enable Cache**: Включено
- ⬜ **sRGB**: Выключено (включите для albedo/diffuse текстур)
- ⬜ **Adaptive Loading**: Выключено (можно включить позже)
- ⬜ **Use Web Worker**: Выключено (пока не реализовано)
- **Step Delay Ms**: `150` (можно уменьшить до 50-100 для быстрой загрузки)

## Шаг 4: Тестирование

### 4.1 Запустить сцену

1. Нажмите кнопку **Launch** (▶) в верхней панели Editor
2. Откроется новое окно с вашей сценой

### 4.2 Открыть консоль браузера

1. В окне со сценой нажмите **F12**
2. Перейдите на вкладку **Console**

### 4.3 Проверить логи

Вы должны увидеть примерно такой вывод:

```
[Ktx2LoaderScriptESM] Initializing...
[KTX2] Loading libktx module on main thread...
[KTX2] libktx module loaded successfully
[KTX2] Loader ready
[Ktx2LoaderScriptESM] Loader initialized

[KTX2] Probing: https://example.com/texture.ktx2
[KTX2] HEAD response: { fileSize: "4.25 MB", supportsRanges: true }

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
  dimensions: "1x1"
}

[KTX2] Uploaded level 11 to GPU: 1x1 (4.00 KB)
[Ktx2LoaderScriptESM] Progress: 1/12 (1x1, network)

... (прогрессивная загрузка продолжается) ...

[KTX2] Loading complete: {
  totalTime: "2.34s",
  levelsLoaded: 12,
  downloaded: "4.25 MB",
  transcoded: "16.00 MB"
}

[Ktx2LoaderScriptESM] Loading complete! {stats}
[Ktx2LoaderScriptESM] Texture loaded successfully
```

### 4.4 Визуальная проверка

На вашей модели (`TextureBox`) вы должны увидеть:

1. **Сначала** - очень размытую low-res текстуру (1x1, 2x2...)
2. **Постепенно** - текстура становится четче с каждым уровнем
3. **В конце** - финальная high-resolution текстура (2048x2048)

**Время загрузки зависит от:**
- Размера KTX2 файла
- Скорости интернета
- Параметра `stepDelayMs` (чем меньше, тем быстрее)

## Шаг 5: Подготовка KTX2 файла (если нужно)

### 5.1 Конвертация PNG/JPG → KTX2

Используйте [toktx](https://github.com/KhronosGroup/KTX-Software/releases):

```bash
# Basis универсальное сжатие
toktx --bcmp --genmipmap texture.ktx2 input.png

# UASTC высокое качество
toktx --uastc --uastc_quality 2 --genmipmap texture.ktx2 input.png
```

### 5.2 Размещение файла

**Требования к хостингу:**
✅ Должен поддерживать **HTTP Range requests**
✅ Должен разрешать **CORS**

**Рекомендуемые хостинги:**
- Cloudflare R2
- AWS S3 (с публичным доступом)
- Google Cloud Storage
- Vercel Blob
- CDN с Range поддержкой

**Проверка Range поддержки:**
```bash
curl -I https://ваш-сервер.com/texture.ktx2
```

Должен вернуть:
```
HTTP/2 200
Accept-Ranges: bytes
Access-Control-Allow-Origin: *
Content-Length: 4456789
```

### 5.3 Тестовые файлы

Для быстрого тестирования можно использовать публичные KTX2 файлы:

**Вариант 1: Khronos Sample Assets**
```
https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb
```
_(содержит KTX2 текстуры внутри)_

**Вариант 2: Собственный тестовый файл**

Создайте простой KTX2:
```bash
# Конвертировать любую PNG/JPG текстуру
toktx --bcmp --genmipmap test.ktx2 your_image.png

# Загрузить на CDN с Range поддержкой
```

## 🐛 Решение проблем

### Ошибка: "Ktx2LoaderScriptESM not found"

**Причина:** Скрипт не распарсен в Editor

**Решение:**
1. Assets → Найдите `Ktx2LoaderScript.mjs`
2. Нажмите **Parse** (справа от файла)
3. Дождитесь завершения (зелёная галочка)
4. Попробуйте снова добавить скрипт

### Ошибка: "libktx assets not found"

**Причина:** Файлы `libktx.mjs` или `libktx.wasm` не загружены

**Решение:**
1. Проверьте, что оба файла есть в Assets
2. `libktx.mjs` → Тип: **Script**
3. `libktx.wasm` → Тип: **Binary**
4. Нажмите **Refresh** в Assets
5. Перезапустите Launch

### Ошибка: "Failed to fetch [URL]"

**Причина:** Неправильный URL или CORS проблема

**Решение:**
1. Проверьте URL в браузере (должен открыться/скачаться)
2. Проверьте CORS заголовки:
   ```bash
   curl -I https://ваш-url.com/texture.ktx2
   ```
   Должен быть: `Access-Control-Allow-Origin: *`

### Текстура не появляется на модели

**Проверьте:**
1. Entity имеет **Model Component**
2. Model имеет **Material**
3. В консоли нет ошибок
4. URL корректный и доступен

**Решение:**
- Проверьте, что у entity есть Model component
- Убедитесь, что текстура применяется: в логах должно быть "Texture loaded successfully"

### Медленная загрузка

**Оптимизация:**
1. Уменьшите `stepDelayMs` до 50-100ms
2. Включите `adaptiveLoading` (остановка на нужном разрешении)
3. Используйте CDN с хорошей скоростью
4. Уменьшите качество KTX2:
   ```bash
   toktx --bcmp --clevel 4 --qlevel 128 texture.ktx2 input.png
   ```

## 📚 Следующие шаги

### Изучить API

Посмотрите файл `src/ktx2-loader/Ktx2ProgressiveLoader.ts` для:
- Программного использования
- Кастомных настроек
- Расширенных возможностей

### Автоматическая пересборка

Для разработки используйте watch mode:
```bash
npm run watch:esm
```

При изменении файлов в `src/` проект будет автоматически пересобираться.

### Загрузка в Editor при изменениях

Если настроен `playcanvas-sync`:
```bash
npm run watch-push:esm
```

При каждой пересборке файлы автоматически загрузятся в PlayCanvas Editor.

## ✅ Готово!

Теперь у вас настроен KTX2 Progressive Loader с ESM скриптами! 🎉

**Что дальше:**
- Экспериментируйте с параметрами
- Тестируйте на разных текстурах
- Изучайте логи для оптимизации
- Интегрируйте в свой проект

**Нужна помощь?**
- GitHub Issues: https://github.com/SashaRX/ktx2-progressive-loader-esm/issues
- KTX2 Spec: https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html

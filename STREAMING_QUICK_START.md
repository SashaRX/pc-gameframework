# Texture Streaming - Quick Start Guide

## 🚀 5-минутная настройка

Эта система управляет множеством KTX2 текстур автоматически на основе расстояния, приоритета и доступной памяти.

### Шаг 0: Сборка и загрузка

```bash
# Соберите проект
npm run build:esm

# Загрузите файлы из build/esm/ в PlayCanvas:
# - scripts/StreamingManagerScript.mjs
# - scripts/StreamedTextureScript.mjs
# - streaming/*.mjs (все файлы)
# - ktx2-loader/*.mjs (базовый загрузчик)
```

### Шаг 1: Добавить StreamingManager в сцену

1. Создайте **пустую entity** (например, назовите "StreamingManager")
2. Добавьте **Script Component**
3. Добавьте скрипт **`streamingManager`**
4. Настройте параметры:
   - `Max Memory MB`: 512 (сколько VRAM использовать)
   - `Max Concurrent`: 4 (сколько текстур грузить параллельно)
   - `Quality Preset`: "default" (или "mobile", "high-quality")
   - `Debug Logging`: true (включить логи для отладки)
   - `libktxModuleUrl`: (опционально) URL для libktx.mjs
   - `libktxWasmUrl`: (опционально) URL для libktx.wasm

**Готово!** Теперь у вас есть глобальный менеджер текстур.

---

### Шаг 2: Добавить текстуру к объекту

У вас есть entity с Model/Render компонентом? Добавьте к ней:

1. **Script Component** (если еще нет)
2. Добавьте скрипт **`streamedTexture`**
3. Настройте параметры:

**Основные настройки:**
- **Ktx Url**: `https://your-cdn.com/texture.ktx2` (ссылка на KTX2 файл)
- **Texture Id**: Уникальный ID (по умолчанию используется имя entity)
- **Category**: выберите категорию:
  - `persistent` - всегда загружена (UI, игрок)
  - `level` - загружается с уровнем (здания)
  - `dynamic` - по расстоянию (далёкие объекты)
- **Target Lod**: 5 (0=полное качество, 10=самое низкое)
- **User Priority**: 1.0 (0-2, чем больше тем важнее)

**Пример настроек для разных объектов:**

#### Игрок (всегда виден, важен)
- Category: `persistent`
- Target Lod: `0` (полное качество)
- User Priority: `2.0` (максимальный приоритет)

#### Здание в уровне
- Category: `level`
- Target Lod: `3` (среднее качество)
- User Priority: `1.0` (нормальный)

#### Далёкий объект на горизонте
- Category: `dynamic`
- Target Lod: `7` (низкое качество)
- User Priority: `0.5` (низкий приоритет)

---

### Шаг 3: Запустить и проверить

Запустите сцену! В консоли вы увидите:

```
[StreamingManager] Initializing...
[StreamingManager] Ready!
[StreamedTexture] Registering "Building-123" (level)
[StreamedTexture] Registered "Building-123" successfully
[Scheduler] Loaded "Building-123" in 245ms (1/4 active)
```

**Готово!** Текстура загружается автоматически.

---

## 🎮 Как это работает

### Автоматическая приоритизация

Система автоматически рассчитывает приоритет каждой текстуры:

```
priority = distance * category * userPriority
```

**Примеры:**

1. **Близкий объект (10 метров, dynamic)**
   - Приоритет: высокий → загружается первым

2. **Далёкий объект (100 метров, dynamic)**
   - Приоритет: низкий → загружается последним

3. **Persistent объект**
   - Приоритет: максимальный → загружается сразу

### Категории

**🔴 Persistent** - всегда в памяти
```
Используйте для:
- UI элементы
- Главный персонаж
- Оружие в руках
- HUD
```

**🟡 Level** - загружается при загрузке уровня
```
Используйте для:
- Геометрия уровня (стены, пол)
- Статичные здания
- Ландшафт
```

**🟢 Dynamic** - загружается/выгружается по расстоянию
```
Используйте для:
- Далёкие объекты
- Необязательные детали
- Фоновые элементы
```

---

## 📊 Мониторинг

### Смотреть статистику

Откройте консоль браузера (F12), вы увидите каждые 5 секунд:

```
[StreamingManager] Stats: {
  textures: "15/20 loaded",
  memory: "65.2% (334MB / 512MB)",
  loading: "2/4 active, 3 queued",
  categories: {
    persistent: "5/5",
    level: "8/10",
    dynamic: "2/5"
  }
}
```

**Что это значит:**
- `15/20 loaded` - загружено 15 из 20 зарегистрированных текстур
- `65.2%` - используется 65% от лимита памяти
- `2/4 active` - сейчас загружаются 2 текстуры из 4 возможных
- `3 queued` - 3 текстуры ждут в очереди

---

## 🔧 Управление вручную

### Принудительно загрузить

```javascript
// В вашем скрипте
const textureScript = this.entity.script.streamedTexture;
textureScript.load(); // Загрузить сейчас!
```

### Изменить приоритет

```javascript
// Повысить приоритет (например, игрок смотрит на объект)
textureScript.setPriority(2.0);

// Понизить приоритет
textureScript.setPriority(0.5);
```

### Выгрузить

```javascript
// Выгрузить из памяти (освободить VRAM)
textureScript.unload();
```

---

## 🌍 Пример: Открытый мир

Представим игру с открытым миром:

### 1. Создайте StreamingManager
- Одна entity в корне сцены
- `Max Memory MB`: 512

### 2. Добавьте streamedTexture к объектам

**UI элементы:**
```
Category: persistent
Target Lod: 0
Priority: 2.0
```

**Здания в городе:**
```
Category: level
Target Lod: 3
Priority: 1.0
```

**Деревья на горизонте:**
```
Category: dynamic
Target Lod: 7
Priority: 0.5
```

### 3. Запустите

Система автоматически:
- ✅ Загрузит UI сразу (persistent)
- ✅ Загрузит здания (level)
- ✅ Загрузит близкие деревья
- ⏳ Далёкие деревья будут загружаться по мере приближения
- 🗑️ Очень далёкие текстуры выгрузятся при нехватке памяти

---

## 🎯 Частые вопросы

### Q: Текстура не загружается?

**A:** Проверьте:
1. Есть ли StreamingManager в сцене?
2. Правильный ли URL? (проверьте в Network tab браузера)
3. Достаточно ли памяти? (смотрите stats)
4. Не слишком ли низкий приоритет?

### Q: Текстура загружается слишком медленно?

**A:** Попробуйте:
1. Повысить `userPriority` до 2.0
2. Изменить категорию на `level` или `persistent`
3. Увеличить `maxConcurrent` в StreamingManager
4. Установить `loadImmediately = true`

### Q: Текстура выгружается слишком быстро?

**A:**
1. Измените категорию на `persistent` (никогда не выгружается)
2. Или на `level` (выгружается только при смене уровня)
3. Увеличьте `Max Memory MB` в StreamingManager

### Q: Слишком много памяти используется?

**A:**
1. Уменьшите `Max Memory MB`
2. Увеличьте `Target Lod` (ниже качество = меньше памяти)
3. Измените категорию с `persistent` на `level` или `dynamic`

---

## 🚀 Готовые рецепты

### Рецепт 1: Мобильная игра (экономия памяти)

**StreamingManager настройки:**
```
Max Memory MB: 256
Max Concurrent: 2
Quality Preset: "mobile"
```

**Все текстуры:**
```
Target Lod: 5-7 (низкое качество)
```

### Рецепт 2: Desktop игра (максимальное качество)

**StreamingManager настройки:**
```
Max Memory MB: 1024
Max Concurrent: 6
Quality Preset: "high-quality"
```

**Важные текстуры:**
```
Target Lod: 0-1 (полное качество)
```

### Рецепт 3: Быстрая загрузка

**StreamingManager настройки:**
```
Max Concurrent: 8
Priority Update Interval: 0.3
```

**Важные текстуры:**
```
Load Immediately: true
User Priority: 2.0
```

---

## ✅ Чеклист для начала

- [ ] Добавил StreamingManager entity в сцену
- [ ] Добавил streamedTexture скрипт к объектам
- [ ] Указал правильные KTX2 URL
- [ ] Выбрал подходящие категории
- [ ] Запустил и проверил консоль (F12)
- [ ] Проверил, что текстуры загружаются
- [ ] Посмотрел статистику через 5 секунд

**Всё работает?** Отлично! 🎉

**Есть проблемы?** Смотрите "Частые вопросы" выше или пишите в консоль: `app.streamingManager.debug()`

---

## 📚 Дальнейшее чтение

- **STREAMING_USAGE.md** - полная документация с примерами кода
- **src/streaming/types.ts** - все типы и интерфейсы
- **Console (F12)** - смотрите логи в реальном времени

**Удачи!** 🚀

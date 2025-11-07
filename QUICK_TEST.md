# ⚡ Quick Test Guide

Быстрая проверка работоспособности World Streaming System.

---

## 🚀 Запуск автоматических тестов

```bash
# 1. Собрать проект
npm run build:esm

# 2. Запустить тесты
node test-streaming.mjs
```

### Ожидаемый результат

```
🎉 ALL TESTS PASSED!

✅ Components Tested:
   • Grid utilities (coordinate conversion, sector IDs)
   • Priority calculation (distance, direction, LOD)
   • Memory manager (budget enforcement, LRU eviction)
```

**Если все тесты прошли** = ✅ Система работает корректно на Node.js уровне

---

## 🎮 Тест в PlayCanvas Editor

### Минимальный тест (2 минуты)

1. **Откройте ваш PlayCanvas проект**

2. **Загрузите файлы** из `build/esm/`:
   - `streaming/` (вся папка)
   - `scripts/WorldStreamingScript.mjs`

3. **Создайте Entity** "StreamingManager"

4. **Добавьте скрипт** `worldStreaming`

5. **Настройте**:
   - Camera Entity Name: `Camera`
   - Verbose: ✓ (включить)
   - Debug Visualization: ✓

6. **Запустите сцену** (Play)

7. **Проверьте Console** (F12):

```
[WorldStreaming] Initializing...
[StreamingManager] Initialized with config: {...}
[WorldStreaming] Initialized successfully
```

**Без ошибок** = ✅ PlayCanvas интеграция работает

---

## 📊 Что тестируется

### Автоматические тесты (`test-streaming.mjs`)

| Компонент | Тест | Статус |
|-----------|------|--------|
| **Grid Utils** | Coordinate conversion | ✅ |
| **Grid Utils** | Sector ID generation | ✅ |
| **Grid Utils** | Negative coordinates | ✅ |
| **Priority** | Distance calculation | ✅ |
| **Priority** | Direction scoring | ✅ |
| **Priority** | LOD level selection | ✅ |
| **Memory** | Budget tracking | ✅ |
| **Memory** | LRU eviction | ✅ |

### PlayCanvas тесты (см. PLAYCANVAS_INTEGRATION_TEST.md)

| Тест | Описание |
|------|----------|
| **Тест 1** | Минимальная инициализация |
| **Тест 2** | Mock сектор (simple cube) |
| **Тест 3** | Автоматическая загрузка при движении |
| **Тест 4** | Память и приоритеты |
| **Тест 5** | KTX2 текстуры (опционально) |

---

## 🐛 Troubleshooting

### ❌ Ошибка: `Cannot find module`

**Решение:** Запустите `npm run build:esm` снова

### ❌ Тесты не проходят

**Решение:** Проверьте версию Node.js:
```bash
node --version  # Должна быть >= 14.0.0
```

### ❌ PlayCanvas: "streamingManager is null"

**Решение:**
1. Проверьте что файлы загружены
2. Проверьте Console на ошибки
3. Убедитесь что Camera существует

---

## 📚 Дальнейшие шаги

После успешных тестов:

1. **Создайте реальные секторы**
   - Смотрите `examples/streaming/sector-manifest-example.json`

2. **Добавьте KTX2 текстуры**
   - Используйте KTX-Software для создания

3. **Оптимизируйте параметры**
   - Grid Size (в зависимости от размера мира)
   - Memory Budget (в зависимости от платформы)

4. **Полная документация**
   - [STREAMING_SYSTEM.md](./STREAMING_SYSTEM.md) - Полное руководство
   - [PLAYCANVAS_INTEGRATION_TEST.md](./PLAYCANVAS_INTEGRATION_TEST.md) - Детальное тестирование

---

## ✅ Чек-лист готовности

- [ ] ✅ Автоматические тесты прошли (`node test-streaming.mjs`)
- [ ] ✅ PlayCanvas инициализация без ошибок
- [ ] ✅ Master materials зарегистрированы
- [ ] ✅ Секторы загружаются вручную
- [ ] ✅ Секторы загружаются автоматически при движении
- [ ] ✅ Memory budget соблюдается
- [ ] ✅ KTX2 текстуры загружаются (опционально)

---

**Готово к продакшену!** 🚀

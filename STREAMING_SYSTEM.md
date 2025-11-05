# World Streaming System

**Система прогрессивной загрузки секторов мира для PlayCanvas**

Интегрируется с KTX2 Progressive Loader для плавной загрузки больших открытых миров.

---

## 📋 Содержание

- [Обзор](#обзор)
- [Архитектура](#архитектура)
- [Быстрый старт](#быстрый-старт)
- [Конфигурация](#конфигурация)
- [Создание манифестов](#создание-манифестов)
- [API Reference](#api-reference)
- [Примеры](#примеры)

---

## Обзор

Streaming System обеспечивает:

✅ **Секторную загрузку** - мир делится на сектора (grid), загружаемые по мере приближения камеры
✅ **LOD управление** - автоматическое переключение уровней детализации для мешей и текстур
✅ **Управление памятью** - LRU выгрузка при превышении бюджета памяти
✅ **Приоритизация** - загрузка секторов по приоритету (расстояние, направление взгляда, скорость)
✅ **Материалы с инстансингом** - master materials с overrides для экономии памяти
✅ **Прогрессивные текстуры** - интеграция с KTX2 Progressive Loader

---

## Архитектура

```
StreamingManager (главный координатор)
    ├── SectorLoader[] (загрузчики секторов)
    │   ├── AssetSource (загрузка GLB/мешей)
    │   ├── MaterialFactory (создание материалов)
    │   └── TextureStreaming (KTX2 текстуры)
    └── MemoryManager (управление памятью)
```

### Компоненты

| Компонент | Назначение |
|-----------|------------|
| **StreamingManager** | Координирует загрузку/выгрузку секторов, отслеживает камеру |
| **SectorLoader** | Загружает отдельный сектор на основе манифеста |
| **AssetSource** | Загружает мешевые ассеты (GLB, Draco) |
| **MaterialFactory** | Создает инстансы материалов с overrides |
| **TextureStreaming** | Управляет прогрессивной загрузкой KTX2 текстур |
| **MemoryManager** | LRU выгрузка при превышении бюджета памяти |

---

## Быстрый старт

### 1. Добавьте скрипт в PlayCanvas Editor

Создайте Entity с скриптом `worldStreaming`:

```javascript
// В PlayCanvas Editor создайте Entity и добавьте скрипт "worldStreaming"
```

### 2. Настройте параметры скрипта

| Параметр | Значение | Описание |
|----------|----------|----------|
| Camera Entity Name | "Camera" | Имя камеры для отслеживания |
| Grid Size | 100 | Размер ячейки сетки (м) |
| View Distance | 300 | Дальность видимости (м) |
| Max Concurrent Loads | 3 | Макс. параллельных загрузок |
| Memory Budget MB | 500 | Бюджет памяти (МБ) |
| Priority Radius | 150 | Радиус высокой детализации (м) |

### 3. Создайте манифесты секторов

Манифест описывает содержимое сектора:

```json
{
  "sectorId": "x100_z200",
  "coordinates": { "x": 100, "z": 200 },
  "templateId": "sector_template_forest",
  "meshes": [...],
  "materials": [...],
  "textures": [...]
}
```

Полный пример: [sector-manifest-example.json](examples/streaming/sector-manifest-example.json)

### 4. Разместите манифесты

```
/assets/sectors/
  ├── x0_z0/manifest.json
  ├── x100_z0/manifest.json
  ├── x0_z100/manifest.json
  └── x100_z100/manifest.json
```

---

## Конфигурация

### Конфигурация StreamingManager

```typescript
streamingManager.initialize({
  gridSize: 100,              // Размер ячейки сетки
  viewDistance: 300,          // Дальность видимости
  maxConcurrentLoads: 3,      // Макс. одновременных загрузок
  memoryBudget: 500,          // Бюджет памяти (МБ)
  priorityRadius: 150,        // Радиус приоритетной загрузки
  debug: true,                // Debug режим
  verbose: false,             // Подробное логирование
});
```

### Конфигурация текстур

```typescript
streamingManager.initialize(config, {
  defaultMinLevel: 8,         // Начальный уровень мипмапов
  adaptiveMargin: 1.5,        // Margin для adaptive loading
  stepDelayMs: 100,           // Задержка между мипмапами
  enableCache: true,          // Включить IndexedDB кэш
  cacheTtlDays: 30,           // TTL кэша (дни)
});
```

---

## Создание манифестов

### Структура манифеста

#### 1. Базовая информация

```json
{
  "sectorId": "x100_z200",
  "coordinates": { "x": 100, "z": 200 },
  "templateId": "sector_template_forest_01",
  "metadata": {
    "biome": "forest",
    "tags": ["vegetation", "rocks"]
  }
}
```

#### 2. Мешевые ассеты с LOD

```json
{
  "meshes": [
    {
      "id": "tree_01",
      "targetEntity": "Tree_01",
      "lods": [
        {
          "level": 0,  // Высокая детализация
          "url": "https://cdn.example.com/meshes/tree_01_lod0.glb",
          "size": 245780,
          "draco": true,
          "distance": 50
        },
        {
          "level": 1,  // Средняя детализация
          "url": "https://cdn.example.com/meshes/tree_01_lod1.glb",
          "size": 98456,
          "distance": 150
        },
        {
          "level": 2,  // Низкая детализация
          "url": "https://cdn.example.com/meshes/tree_01_lod2.glb",
          "size": 12456,
          "distance": 300
        }
      ]
    }
  ]
}
```

#### 3. Материалы с инстансингом

```json
{
  "materials": [
    {
      "id": "mat_tree_bark",
      "masterId": "master_pbr_standard",
      "targetEntities": ["Tree_01"],
      "overrides": {
        "diffuse": [0.4, 0.3, 0.2],
        "metalness": 0.0,
        "gloss": 0.3
      }
    }
  ]
}
```

#### 4. KTX2 текстуры

```json
{
  "textures": [
    {
      "id": "tex_tree_bark_albedo",
      "url": "https://cdn.example.com/textures/tree_bark_albedo.ktx2",
      "targetEntity": "Tree_01",
      "materialProperty": "diffuseMap",
      "minLevel": 8,
      "priority": 7,
      "isSrgb": true
    }
  ]
}
```

---

## API Reference

### StreamingManager

```typescript
class StreamingManager {
  // Инициализация
  initialize(config: StreamingConfig, textureConfig?: TextureStreamingConfig): void;

  // Регистрация master materials
  registerMasterMaterial(id: string, material: pc.Material): void;

  // Обновление камеры
  updateCamera(position: pc.Vec3, direction: pc.Vec3, deltaTime?: number): void;

  // Ручное управление секторами
  async loadSectorByScript(sectorId: string, priority: number): Promise<void>;
  unloadSectorByScript(sectorId: string): void;

  // Получение статуса
  getSectorStatus(sectorId: string): SectorStatus;
  getMemoryUsage(): MemoryStats;
  getLoadedSectorCount(): number;

  // События
  on(event: StreamingEvent, callback: EventCallback): void;

  // Очистка
  destroy(): void;
}
```

### События

```typescript
enum StreamingEvent {
  SectorLoadStart = 'sector:load:start',
  SectorLoadComplete = 'sector:load:complete',
  SectorUnloaded = 'sector:unloaded',
  SectorLodChanged = 'sector:lod:changed',
  MemoryWarning = 'memory:warning',
  SectorLoadFailed = 'sector:load:failed',
}

// Использование
streamingManager.on(StreamingEvent.SectorLoadComplete, (event) => {
  console.log('Sector loaded:', event.sectorId, event.loadTime);
});
```

---

## Примеры

### Пример 1: Базовое использование

```typescript
import { StreamingManager } from './streaming/StreamingManager';

const app = /* pc.Application */;
const manager = new StreamingManager(app);

manager.initialize({
  gridSize: 100,
  viewDistance: 300,
  maxConcurrentLoads: 3,
  memoryBudget: 500,
  priorityRadius: 150,
});

// В update loop
manager.updateCamera(camera.getPosition(), camera.forward, dt);
```

### Пример 2: Регистрация master materials

```typescript
// Создайте master materials в редакторе и тегните их "master_material"

// Или программно:
const masterMaterial = new pc.StandardMaterial();
masterMaterial.diffuse = new pc.Color(0.5, 0.5, 0.5);
masterMaterial.metalness = 0.0;
masterMaterial.gloss = 0.5;
masterMaterial.update();

manager.registerMasterMaterial('master_pbr_standard', masterMaterial);
```

### Пример 3: Ручная загрузка секторов

```typescript
// Загрузить конкретный сектор
await manager.loadSectorByScript('x100_z200', 10);

// Выгрузить сектор
manager.unloadSectorByScript('x100_z200');

// Проверить статус
const status = manager.getSectorStatus('x100_z200');
// 'unloaded' | 'loading' | 'loaded_low' | 'loaded_medium' | 'loaded_high'
```

### Пример 4: Мониторинг памяти

```typescript
manager.on(StreamingEvent.MemoryWarning, () => {
  const stats = manager.getMemoryUsage();
  console.warn('Memory budget exceeded:', stats);

  // stats:
  // {
  //   totalUsedMB: 520,
  //   budgetMB: 500,
  //   sectorsLoaded: 15,
  //   sectorBreakdown: Map<string, number>
  // }
});
```

---

## Расчет приоритетов

Система вычисляет приоритет загрузки на основе:

1. **Расстояние** (0-1, где 1 = ближе)
2. **Направление взгляда** (0-1, где 1 = прямо впереди)
3. **Скорость движения** (0-1, предзагрузка по направлению движения)

```typescript
priority = distance * 0.5 + direction * 0.3 + velocity * 0.2
```

---

## LOD управление

### Уровни LOD

| LOD Level | Расстояние | Детализация |
|-----------|------------|-------------|
| 0 | 0 - detailDistance | Высокая |
| 1 | detailDistance - viewDistance * 0.6 | Средняя |
| 2 | viewDistance * 0.6 - viewDistance | Низкая |

### Автоматическое переключение

Система автоматически переключает LOD на основе расстояния от камеры до центра сектора.

---

## Производительность

### Рекомендации

1. **Grid Size**: 50-100м для открытых миров, 20-50м для плотных сцен
2. **View Distance**: 300-500м в зависимости от производительности
3. **Max Concurrent Loads**: 2-4 для баланса между скоростью и нагрузкой
4. **Memory Budget**: 300-500MB для мобильных, 500-1000MB для desktop

### Оптимизация

- Используйте Draco сжатие для мешей
- Используйте hardware compressed KTX2 текстуры
- Кэшируйте часто используемые секторы
- Предзагружайте секторы по направлению движения

---

## Отладка

### Debug режим

```typescript
manager.initialize({
  ...config,
  debug: true,
  verbose: true,
});

// События отладки
app.on('streaming:debug', (data) => {
  console.log(data.text);
  // Sectors Loaded: 5
  // Sectors Loading: 2
  // Memory: 245.67MB / 500MB
});
```

### Debug UI

```typescript
app.on('streaming:debug', ({ text, stats }) => {
  document.getElementById('debug-info').textContent = text;
});
```

---

## Лицензия

MIT License - см. [LICENSE](LICENSE)

---

## Автор

**SashaRX**
Интеграция с PlayCanvas KTX2 Progressive Loader

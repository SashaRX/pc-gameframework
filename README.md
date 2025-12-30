# pc-gameframework

PlayCanvas Game Framework - модульный фреймворк для создания игр на PlayCanvas Engine 2.12+.

## Текущее состояние (v0.1.0)

### Реализовано

| Модуль | Статус | Описание |
|--------|--------|----------|
| **KTX2 Progressive Loader** | ✅ Ready | Прогрессивная загрузка текстур (mip-by-mip) |
| **Meshoptimizer Decoder** | ✅ Ready | Декодер для EXT_meshopt_compression в GLB |
| **Texture Streaming** | ✅ Ready | Приоритетная загрузка текстур с memory budget |
| **GPU Format Detection** | ✅ Ready | Автоопределение BC/ASTC/ETC/PVRTC |

### В планах

| Модуль | Статус | Описание |
|--------|--------|----------|
| **Material System** | ⏳ Planned | Master/Instance материалы с JSON параметрами |
| **Cubemap Manager** | ⏳ Planned | Runtime генерация cubemap (4 tetra cameras) |
| **Sector Streaming** | ⏳ Planned | Загрузка секторов по позиции камеры |
| **Lightmap Loader** | ⏳ Planned | Загрузка lightmap для секторов |
| **PostFX System** | ⏳ Planned | HDR tonemapping, bloom, SMAA |

## Архитектура

```
src/
├── libs/                    # Внешние библиотеки (WASM/JS)
│   ├── libktx/              # KTX2 transcoder
│   │   ├── LibktxLoader.ts  # Singleton загрузчик
│   │   ├── libktx.mjs
│   │   └── libktx.wasm
│   └── meshoptimizer/       # Meshopt decoder v0.21
│       ├── MeshoptLoader.ts # Singleton загрузчик
│       └── meshopt_decoder.mjs
│
├── loaders/                 # Загрузчики ресурсов
│   ├── Ktx2ProgressiveLoader.ts
│   ├── KtxCacheManager.ts
│   ├── GpuFormatDetector.ts
│   ├── MemoryPool.ts
│   └── utils/
│
├── systems/                 # Игровые системы
│   └── streaming/           # Texture streaming system
│       ├── TextureStreamingManager.ts
│       ├── PriorityQueue.ts
│       ├── MemoryTracker.ts
│       └── CategoryManager.ts
│
├── scripts/                 # PlayCanvas Script Components
│   ├── Ktx2LoaderScript.ts
│   ├── StreamingManagerScript.ts
│   └── StreamedTextureScript.ts
│
├── shaders/                 # Shader chunks (будущее)
│
└── workers/                 # Web Workers
    └── ktx-transcode.worker.ts
```

## Планируемая архитектура

### PlaycanvasAssetProcessor (внешний инструмент)

Конвертирует ассеты для использования в игре:
- **Текстуры** → KTX2 (ETC1S/UASTC) с mipmap
- **Модели** → GLB + meshopt compression + LODs
- **Материалы** → JSON с параметрами (albedo, smoothness, etc.)

### Sectors (секторы уровня)

Секторы - это PlayCanvas templates содержащие:
- Модели (GLB с meshopt)
- Освещение
- Cubemap probes
- Lightmaps

Загружаются динамически по позиции камеры.

### Material System

**Master Materials** - базовые материалы с кастомными shader chunks:
- `pbr_opaque` - стандартный PBR
- `pbr_alpha` - с прозрачностью
- Компилируются один раз при старте

**Instance Materials** - JSON файлы с параметрами:
```json
{
  "master": "pbr_opaque",
  "params": {
    "albedo": [1, 0.8, 0.6],
    "smoothness": 0.7,
    "metalness": 0.0,
    "albedoMap": "content/textures/wood_albedo.ktx2",
    "normalMap": "content/textures/wood_normal.ktx2"
  }
}
```

При загрузке: clone master → apply uniforms.

### Cubemap System

Runtime генерация reflection probes:
- 4 tetra cameras (ортогональное хранение)
- Box projection
- Blending между probes

### PostFX Pipeline

- HDR rendering
- Tonemapping (ACES/Reinhard)
- Bloom с blur mipmap buffer
- SMAA антиалиасинг

## Установка и сборка

```bash
npm install
npm run build          # ESM сборка
npm run build-push     # Сборка + push в PlayCanvas
npm run cleanup        # Очистка orphaned файлов
npm run cleanup:dry    # Показать что будет удалено
```

## Использование

### KTX2 Progressive Loading

```typescript
import { Ktx2ProgressiveLoader } from 'pc-gameframework';

const loader = new Ktx2ProgressiveLoader(app, texture, {
  progressive: true,
  verbose: true,
  enableCache: true
});

await loader.load('https://example.com/texture.ktx2');
```

### Meshoptimizer Decoder

```typescript
import { MeshoptLoader } from 'pc-gameframework';

// Инициализация (singleton)
const decoder = await MeshoptLoader.getInstance().initialize(app);

// Декодирование буфера
decoder.decodeGltfBuffer(target, count, size, source, mode, filter);
```

### Texture Streaming Manager

```typescript
import { TextureStreamingManager } from 'pc-gameframework';

const manager = new TextureStreamingManager();
await manager.initialize(app, {
  memoryBudgetMB: 256,
  qualityPreset: 'balanced'
});

// Регистрация текстуры
manager.registerTexture(entity, 'diffuse', 'content/textures/albedo.ktx2', {
  category: 'level'
});
```

## Создание KTX2 файлов

### Color/Albedo текстуры

```bash
# UASTC (высокое качество)
toktx --t2 --encode uastc --uastc_quality 4 --uastc_rdo_l .5 \
  --uastc_rdo_d 65536 --zcmp 22 --genmipmap color.ktx2 input.png

# ETC1S (меньший размер)
toktx --t2 --encode etc1s --clevel 4 --qlevel 255 \
  --genmipmap color.ktx2 input.png
```

### Normal Maps

```bash
toktx --t2 --encode uastc --uastc_quality 4 --uastc_rdo_l .25 \
  --uastc_rdo_d 65536 --zcmp 22 --normal_mode \
  --assign_oetf linear --assign_primaries none \
  --genmipmap normal.ktx2 input.png
```

### ORM Maps (Roughness/Metallic)

```bash
toktx --t2 --encode uastc --uastc_quality 4 --uastc_rdo_l .5 \
  --uastc_rdo_d 65536 --zcmp 22 \
  --assign_oetf linear --assign_primaries none \
  --genmipmap orm.ktx2 input.png
```

## npm Scripts

| Команда | Описание |
|---------|----------|
| `npm run build` | ESM сборка |
| `npm run build:clean` | Очистка build/ + пересборка |
| `npm run watch` | Watch mode |
| `npm run push` | Push в PlayCanvas |
| `npm run build-push` | Сборка + push |
| `npm run cleanup` | Удалить orphaned файлы |
| `npm run cleanup:dry` | Dry-run очистки |

## Troubleshooting

**403 Forbidden при загрузке libktx**
- Используйте Asset Registry с типом Binary (не Script)
- Или внешние URL на raw.githubusercontent.com

**CORS ошибки**
- Неправильно: `github.com/.../file?raw=1` (редирект)
- Правильно: `raw.githubusercontent.com/.../file`

**Текстура пикселизированная**
- Проверьте консоль - загружаются ли все mip levels
- Включите verbose режим для диагностики

## Ссылки

- [KTX2 Specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)
- [KTX-Software](https://github.com/KhronosGroup/KTX-Software)
- [Meshoptimizer](https://github.com/zeux/meshoptimizer)
- [PlayCanvas Engine](https://playcanvas.com/)

---

**Version:** 0.1.0
**License:** MIT
**Author:** SashaRX

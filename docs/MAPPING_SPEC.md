# Спецификация mapping.json

## Назначение
Связывает оригинальные PlayCanvas asset ID с обработанными файлами на CDN. Структура папок повторяет иерархию редактора PlayCanvas.

---

## Processing (PlaycanvasAssetProcessor)

```
Скачивание через REST API
    ↓
Обработка:
├── Модели    → gltfpack → [name]_lod0.glb, _lod1.glb, _lod2.glb
├── Текстуры  → KTX2 + channel pack → albedo.ktx2, normal.ktx2, [name]_ogm.ktx2
└── Материалы → instance JSON (master + params + textures)
    ↓
Генерация mapping.json
    ↓
Upload на B2
```

---

## mapping.json

```json
{
  "version": "1.0.0",
  "generated": "2024-01-15T12:00:00Z",
  "baseUrl": "https://b2.example.com/game-assets",

  "masterMaterials": {
    "pbr_opaque": 99999,
    "pbr_alpha": 99998
  },

  "models": {
    "12345": {
      "name": "Building",
      "path": "Architecture/Buildings",
      "materials": [67890],
      "lods": [
        { "level": 0, "file": "Architecture/Buildings/Building_lod0.glb", "distance": 0 },
        { "level": 1, "file": "Architecture/Buildings/Building_lod1.glb", "distance": 25 },
        { "level": 2, "file": "Architecture/Buildings/Building_lod2.glb", "distance": 60 }
      ]
    }
  },

  "materials": {
    "67890": "Architecture/Materials/Concrete.json"
  },

  "textures": {
    "11111": "Architecture/Textures/concrete_albedo.ktx2",
    "22222": "Architecture/Textures/concrete_normal.ktx2",
    "concrete_ogm": {
      "file": "Architecture/Textures/concrete_ogm.ktx2",
      "sources": [33333, 44444, 55555]
    }
  }
}
```

### textures — два формата:
- **Число → строка**: `"11111": "path/file.ktx2"` — оригинальная текстура
- **Строка → объект**: `"concrete_ogm": { file, sources }` — packed текстура

**sources** — массив оригинальных asset ID которые упакованы (ao, gloss, metalness, [height])

---

## Material JSON

Файл `<path>/<name>.json`:

```json
{
  "master": "pbr_opaque",
  "params": {
    "diffuse": [1, 1, 1],
    "metalness": 0.0,
    "gloss": 0.7,
    "emissive": [0, 0, 0],
    "emissiveIntensity": 1.0,
    "opacity": 1.0
  },
  "textures": {
    "diffuseMap": 11111,
    "normalMap": 22222,
    "ogmMap": "concrete_ogm"
  }
}
```

### textures значения:
- Число `11111` — asset ID, искать в mapping.textures
- Строка `"concrete_ogm"` — ключ packed текстуры в mapping.textures

### Варианты конфигурации:

```json
// Вариант A: раздельные текстуры (мастер pbr_separate)
{
  "master": "pbr_separate",
  "textures": {
    "diffuseMap": 11111,
    "aoMap": 22222,
    "glossMap": 33333,
    "metalnessMap": 44444
  }
}

// Вариант B: packed OGM (мастер pbr_ogm)
{
  "master": "pbr_ogm",
  "textures": {
    "diffuseMap": 11111,
    "ogmMap": "concrete_ogm"
  }
}
```

### Суффикс packed текстуры определяет каналы:
- `_og.ktx2` — 2 канала (O+G)
- `_ogm.ktx2` — 3 канала (O+G+M)
- `_ogmh.ktx2` — 4 канала (O+G+M+H)

Кастомный shader chunk знает что делать с `ogmMap`.

---

## Построение путей

```
GET /api/projects/{project_id}/assets

Response:
{
  "id": 12345,
  "name": "Building",
  "type": "model",
  "parent": 99999
}
```

### Алгоритм:
```
getPath(asset):
  if asset.parent == null:
    return ""
  return getPath(folders[asset.parent]) + "/" + folder.name
```

### Пример:
```
Редактор:                         Path:
Assets/
├── Architecture/                 "Architecture"
│   ├── Buildings/                "Architecture/Buildings"
│   │   └── Building.fbx          "Architecture/Buildings"
│   └── Materials/                "Architecture/Materials"
│       └── Concrete              "Architecture/Materials"
```

---

## Маппинг master материалов

```
blendType → master:
  0 (NONE)         → "pbr_opaque"
  1 (NORMAL)       → "pbr_alpha"
  2 (ADDITIVE)     → "pbr_additive"
  3 (PREMULTIPLIED)→ "pbr_premul"
```

---

## Валидация

После генерации проверить:
1. Все `materials[]` в models существуют в `materials`
2. Все texture ID/ключи в material JSON существуют в `textures`
3. Все файлы реально существуют

---

## Runtime (браузер)

```
App Start
    ↓
Загрузка mapping.json
    ↓
Компиляция master materials
    ↓
Template.instantiate()
    ↓
Для каждого asset ID в template:
├── Model ID → загрузка LOD2 → показ
├── Material ID → instance JSON → clone master → apply params
└── Texture ID/key → KTX2 loader → assign to material
    ↓
LOD Manager: дистанция → переключение LOD0/LOD1
```

---

## Итоговая схема

```
┌─────────────────┐     ┌──────────────────┐      ┌─────────────────┐
│ PlayCanvas      │     │ Asset Processor  │      │ B2 Server       │
│ Editor          │     │ (.NET)           │      │                 │
├─────────────────┤     ├──────────────────┤      ├─────────────────┤
│ Templates       │────▶│ Models → GLB+LOD │────▶│ *.glb           │
│ Scripts         │     │ Textures → KTX2  │      │ *.ktx2          │
│ Master Materials│     │ Materials → JSON │      │ *.json          │
│                 │     │ Mapping → JSON   │      │ mapping.json    │
└─────────────────┘     └──────────────────┘      └─────────────────┘
        │                                               │
        ▼                                               ▼
┌───────────────────────────────────────────────────────────────────┐
│ Runtime Browser                                                   │
├───────────────────────────────────────────────────────────────────┤
│ 1. Load build (templates, scripts, masters)                       │
│ 2. Load mapping.json                                              │
│ 3. Compile master materials                                       │
│ 4. Template.instantiate() → resolve IDs via mapping               │
│ 5. Load assets from B2 (GLB + meshopt, KTX2 + libktx)             │
│ 6. Clone masters, apply instance params                           │
│ 7. LOD switching by distance                                      │
└───────────────────────────────────────────────────────────────────┘
```

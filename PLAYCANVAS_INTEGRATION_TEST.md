# 🧪 PlayCanvas Integration Testing Guide

Пошаговое руководство по тестированию World Streaming System в PlayCanvas Editor.

---

## 📋 Подготовка

### 1. Соберите проект

```bash
npm run build:esm
```

Проверьте, что файлы созданы:
```
build/esm/
├── streaming/
│   ├── StreamingManager.mjs
│   ├── SectorLoader.mjs
│   ├── ...
└── scripts/
    └── WorldStreamingScript.mjs
```

### 2. Загрузите файлы в PlayCanvas

В PlayCanvas Editor:

1. **Создайте папку** `streaming` в Assets
2. **Загрузите все .mjs файлы** из `build/esm/`:
   - `streaming/` (вся папка)
   - `scripts/WorldStreamingScript.mjs`
   - `ktx2-loader/` (если ещё не загружены)

---

## 🎯 Тест 1: Минимальная сцена (без реальных ассетов)

### Цель
Проверить, что система инициализируется без ошибок.

### Шаги

1. **Создайте новую сцену** в PlayCanvas

2. **Добавьте Entity** с именем "StreamingManager"

3. **Добавьте скрипт** `worldStreaming` к этому Entity

4. **Настройте параметры**:
   - Camera Entity Name: `Camera`
   - Grid Size: `100`
   - View Distance: `300`
   - Max Concurrent Loads: `3`
   - Memory Budget MB: `500`
   - Verbose: `true` ✓ (включить логирование)
   - Debug Visualization: `true` ✓

5. **Запустите сцену** (Play button)

6. **Откройте Console** (F12)

### Ожидаемый результат

```
[WorldStreaming] Initializing...
[StreamingManager] Initialized with config: {gridSize: 100, viewDistance: 300, ...}
[WorldStreaming] Initialized successfully
```

**Без ошибок** = ✅ Базовая инициализация работает

---

## 🎯 Тест 2: Тест с Mock сектором (простой cube)

### Цель
Проверить загрузку и выгрузку сектора.

### Подготовка

1. **Создайте Template** "TestSectorTemplate":
   - Добавьте Entity "Root"
   - Добавьте child Entity "TestCube" с Render Component (Box)
   - Сделайте Template из Root

2. **Создайте Master Material**:
   - Создайте Material "MasterPBR"
   - Назначьте тег `master_material`
   - Настройте базовые параметры (diffuse, metalness, etc.)

3. **Создайте mock manifest** `test-sector.json`:

```json
{
  "sectorId": "x0_z0",
  "coordinates": { "x": 0, "z": 0 },
  "templateId": "TestSectorTemplate",
  "meshes": [],
  "materials": [
    {
      "id": "mat_test",
      "masterId": "MasterPBR",
      "targetEntities": ["TestCube"],
      "overrides": {
        "diffuse": [1.0, 0.0, 0.0]
      }
    }
  ],
  "textures": []
}
```

4. **Загрузите manifest** в папку `/assets/sectors/x0_z0/manifest.json`

### Тестовый скрипт

Создайте скрипт `StreamingTester.mjs`:

```javascript
var StreamingTester = pc.createScript('streamingTester');

StreamingTester.prototype.initialize = function() {
    console.log('🧪 Streaming Tester: Starting...');

    // Найти StreamingManager
    const managerEntity = this.app.root.findByName('StreamingManager');
    if (!managerEntity) {
        console.error('❌ StreamingManager not found');
        return;
    }

    const script = managerEntity.script.worldStreaming;
    if (!script) {
        console.error('❌ worldStreaming script not found');
        return;
    }

    // Подписаться на события
    this.app.on('streaming:sector:loaded', (event) => {
        console.log('✅ Sector loaded:', event.sectorId);
    });

    this.app.on('streaming:sector:unloaded', (event) => {
        console.log('🗑️ Sector unloaded:', event.sectorId);
    });

    this.app.on('streaming:sector:failed', (event) => {
        console.error('❌ Sector load failed:', event.sectorId, event.error);
    });

    // Тест 1: Загрузить сектор вручную
    setTimeout(() => {
        console.log('🧪 Test 1: Manual sector load');
        script.loadSector('x0_z0', 10).then(() => {
            console.log('✅ Test 1: Sector load completed');

            // Проверить статус
            const status = script.getSectorStatus('x0_z0');
            console.log('📊 Sector status:', status);

            // Тест 2: Выгрузить сектор через 5 секунд
            setTimeout(() => {
                console.log('🧪 Test 2: Manual sector unload');
                script.unloadSector('x0_z0');
                console.log('✅ Test 2: Sector unload completed');
            }, 5000);
        }).catch((err) => {
            console.error('❌ Test 1 failed:', err);
        });
    }, 2000);
};

StreamingTester.prototype.update = function(dt) {
    // Debug info
    if (this.app.keyboard.wasPressed(pc.KEY_D)) {
        const managerEntity = this.app.root.findByName('StreamingManager');
        const script = managerEntity?.script.worldStreaming;
        if (script) {
            const memory = script.getMemoryUsage();
            console.log('📊 Memory:', memory);
        }
    }
};
```

### Запуск теста

1. Добавьте `StreamingTester` скрипт к любому Entity
2. Запустите сцену
3. Наблюдайте в Console

### Ожидаемый результат

```
🧪 Streaming Tester: Starting...
🧪 Test 1: Manual sector load
[SectorLoader] Loading manifest: /assets/sectors/x0_z0/manifest.json
[SectorLoader] Manifest loaded: {sectorId: "x0_z0", meshes: 0, ...}
[SectorLoader] Loading sector x0_z0, LOD: 2
✅ Sector loaded: x0_z0
✅ Test 1: Sector load completed
📊 Sector status: loaded_low
🧪 Test 2: Manual sector unload
[SectorLoader] Unloading sector: x0_z0
🗑️ Sector unloaded: x0_z0
✅ Test 2: Sector unload completed
```

---

## 🎯 Тест 3: Автоматическая загрузка при движении камеры

### Подготовка

Создайте несколько секторов:
- `x0_z0` (центр)
- `x100_z0` (справа)
- `x0_z100` (впереди)
- `xn100_z0` (слева, отрицательная координата)

Каждый с простым cube разного цвета.

### Тестовый скрипт движения камеры

```javascript
var CameraMover = pc.createScript('cameraMover');

CameraMover.attributes.add('speed', {
    type: 'number',
    default: 50
});

CameraMover.prototype.update = function(dt) {
    const camera = this.entity;

    // WASD движение
    if (this.app.keyboard.isPressed(pc.KEY_W)) {
        camera.translateLocal(0, 0, -this.speed * dt);
    }
    if (this.app.keyboard.isPressed(pc.KEY_S)) {
        camera.translateLocal(0, 0, this.speed * dt);
    }
    if (this.app.keyboard.isPressed(pc.KEY_A)) {
        camera.translateLocal(-this.speed * dt, 0, 0);
    }
    if (this.app.keyboard.isPressed(pc.KEY_D)) {
        camera.translateLocal(this.speed * dt, 0, 0);
    }

    // Показать позицию
    if (this.app.keyboard.wasPressed(pc.KEY_P)) {
        console.log('📍 Camera position:', camera.getPosition());
    }
};
```

### Запуск теста

1. Добавьте `CameraMover` к Camera
2. Убедитесь что `WorldStreaming` активен
3. Запустите сцену
4. Двигайтесь с WASD

### Ожидаемое поведение

- При движении камеры **автоматически загружаются** ближайшие секторы
- **Выгружаются** дальние секторы
- В Console видны логи загрузки/выгрузки
- Нажмите `D` чтобы посмотреть memory usage

---

## 🎯 Тест 4: Память и приоритеты

### Тестовый скрипт

```javascript
var MemoryTester = pc.createScript('memoryTester');

MemoryTester.prototype.initialize = function() {
    const managerEntity = this.app.root.findByName('StreamingManager');
    const script = managerEntity.script.worldStreaming;

    // Загрузить много секторов одновременно
    const sectors = [
        'x0_z0', 'x100_z0', 'x200_z0',
        'x0_z100', 'x100_z100', 'x200_z100',
        'x0_z200', 'x100_z200', 'x200_z200'
    ];

    console.log('🧪 Loading 9 sectors simultaneously...');

    sectors.forEach((sectorId, index) => {
        setTimeout(() => {
            script.loadSector(sectorId, 10 - index).catch((err) => {
                console.log('⚠️ Sector failed (expected):', sectorId);
            });
        }, index * 500);
    });

    // Проверка памяти каждую секунду
    setInterval(() => {
        const memory = script.getMemoryUsage();
        if (memory) {
            console.log('📊 Memory:',
                memory.totalUsedMB.toFixed(2), 'MB /',
                memory.budgetMB, 'MB |',
                'Sectors:', memory.sectorsLoaded
            );
        }
    }, 1000);
};
```

### Ожидаемый результат

- Загрузка идет **по очереди** (maxConcurrentLoads = 3)
- При превышении **memoryBudget** выгружаются старые секторы
- **Memory warning** события при превышении бюджета
- Приоритетные секторы **не выгружаются**

---

## 🎯 Тест 5: KTX2 текстуры (реальные ассеты)

### Требуется

1. **KTX2 текстура** (создайте с помощью [KTX-Software](https://github.com/KhronosGroup/KTX-Software))
2. **Manifest** с texture definitions
3. **libktx.mjs и libktx.wasm** загружены в проект

### Manifest пример

```json
{
  "sectorId": "x0_z0",
  "coordinates": { "x": 0, "z": 0 },
  "templateId": "TestSectorTemplate",
  "meshes": [],
  "materials": [],
  "textures": [
    {
      "id": "tex_test",
      "url": "https://your-cdn.com/textures/test.ktx2",
      "targetEntity": "TestCube",
      "materialProperty": "diffuseMap",
      "minLevel": 8,
      "priority": 7,
      "isSrgb": true
    }
  ]
}
```

### Ожидаемый результат

- Текстура загружается **прогрессивно** (от low-res к high-res)
- В Console видны логи `[TextureStreaming]`
- Видно постепенное улучшение качества

---

## 📊 Чек-лист проверки

### Базовая функциональность
- [ ] ✅ StreamingManager инициализируется без ошибок
- [ ] ✅ Master materials регистрируются
- [ ] ✅ Сектора загружаются вручную (loadSector)
- [ ] ✅ Сектора выгружаются (unloadSector)
- [ ] ✅ События загрузки/выгрузки срабатывают

### Автоматическая загрузка
- [ ] ✅ Секторы загружаются при движении камеры
- [ ] ✅ Секторы выгружаются при удалении камеры
- [ ] ✅ Приоритизация работает (ближние загружаются первыми)

### Память
- [ ] ✅ Memory budget соблюдается
- [ ] ✅ LRU eviction работает
- [ ] ✅ Memory warning события срабатывают

### Материалы
- [ ] ✅ Master materials применяются
- [ ] ✅ Material overrides работают
- [ ] ✅ Кэширование инстансов работает

### Текстуры (если есть KTX2)
- [ ] ✅ KTX2 текстуры загружаются прогрессивно
- [ ] ✅ Приоритизация текстур работает
- [ ] ✅ Кэширование текстур работает

---

## 🐛 Troubleshooting

### Ошибка: "Template not found"

**Причина:** Template ID не совпадает с реальным

**Решение:**
```javascript
// Получить ID template в Console
const asset = app.assets.find('TestSectorTemplate', 'template');
console.log('Template ID:', asset.id);
// Используйте этот ID в manifest
```

### Ошибка: "Master material not found"

**Причина:** Material не зарегистрирован или нет тега

**Решение:**
1. Убедитесь что material имеет тег `master_material`
2. Или зарегистрируйте программно:
```javascript
const material = app.assets.find('MasterPBR', 'material').resource;
streamingManager.registerMasterMaterial('master_pbr', material);
```

### Ошибка: "Failed to load manifest"

**Причина:** Файл не найден или неправильный путь

**Решение:**
1. Проверьте путь: `/assets/sectors/x0_z0/manifest.json`
2. Убедитесь что файл загружен в PlayCanvas
3. Или используйте внешний URL

### Сектора не загружаются автоматически

**Причина:** Камера не движется или manifest не найден

**Решение:**
1. Проверьте что `cameraEntityName` правильный
2. Проверьте что `viewDistance` достаточно большой
3. Используйте `verbose: true` для отладки

---

## 📝 Логирование

Включите подробное логирование:

```javascript
// В WorldStreamingScript
verbose: true

// Дополнительно в Console
localStorage.setItem('debug:streaming', 'true');
```

Полезные логи:
```
[StreamingManager] Loading sector: x100_z200
[SectorLoader] Loading manifest: /assets/sectors/x100_z200/manifest.json
[SectorLoader] Manifest loaded: {...}
[MaterialFactory] Created material instance: master_pbr#...
[TextureStreaming] Starting load: x100_z200:tex_01
[KTX2] Loading: https://cdn.example.com/texture.ktx2
```

---

## 🎓 Следующие шаги

После успешного тестирования:

1. **Создайте реальные секторы** с GLB мешами
2. **Настройте LOD систему** (3 уровня для каждого меша)
3. **Добавьте KTX2 текстуры** для всех материалов
4. **Оптимизируйте параметры**:
   - Grid Size (от размера мира)
   - View Distance (от производительности)
   - Memory Budget (от целевой платформы)
5. **Создайте инструменты** для автоматической генерации манифестов

---

## 📚 Дополнительные ресурсы

- [STREAMING_SYSTEM.md](./STREAMING_SYSTEM.md) - Полная документация
- [examples/streaming/](./examples/streaming/) - Примеры конфигураций
- [MILESTONES.md](./MILESTONES.md) - История разработки

---

**Удачного тестирования! 🚀**

# ⚡ Commands Cheatsheet

Быстрая справка по всем командам проекта.

## 📦 Установка

```bash
# Установить зависимости
npm install
```

## 🔨 Сборка

### ESM (Рекомендуется)
```bash
# Собрать ESM версию
npm run build:esm

# Автоматическая пересборка при изменениях
npm run watch:esm

# Собрать + загрузить в PlayCanvas
npm run build-push:esm

# Watch mode + автозагрузка в PlayCanvas
npm run watch-push:esm
```

### AMD (Legacy)
```bash
# Собрать AMD bundle
npm run build:amd

# Автоматическая пересборка
npm run watch:amd

# Собрать + загрузить в PlayCanvas
npm run build-push:amd

# Watch mode + автозагрузка
npm run watch-push:amd
```

### Default
```bash
# По умолчанию = ESM
npm run build

# Watch mode
npm run watch
```

## 📤 Загрузка в PlayCanvas

```bash
# Загрузить build/ в PlayCanvas Editor
npm run push

# Требует настройки pcconfig.json
```

## 📂 Структура Output

### ESM Build
```
build/esm/
├── Ktx2LoaderScript.mjs           # Главный скрипт
├── ktx2-loader/                   # Модули загрузчика
│   ├── Ktx2ProgressiveLoader.js
│   ├── KtxCacheManager.js
│   ├── types.js
│   └── utils/
│       ├── alignment.js
│       └── colorspace.js
├── libktx.mjs                     # Библиотека транскодинга
└── libktx.wasm                    # WASM модуль
```

### AMD Build
```
build/
├── main.bundle.js    # Single bundle
├── libktx.mjs
└── libktx.wasm
```

## 🧪 Тестирование

### Создание тестовых KTX2 файлов

```bash
# Basis LZ (универсальное сжатие)
toktx --bcmp --genmipmap texture.ktx2 input.png

# UASTC (высокое качество)
toktx --uastc --uastc_quality 2 --genmipmap texture.ktx2 input.png

# Низкое качество (малый размер)
toktx --bcmp --clevel 4 --qlevel 128 --genmipmap texture.ktx2 input.png
```

### Проверка HTTP Range Support

```bash
# Проверить Range поддержку сервера
curl -I https://your-server.com/texture.ktx2

# Должен вернуть:
# Accept-Ranges: bytes
# Access-Control-Allow-Origin: *
```

## 🔧 Разработка

### Структура проекта

```bash
# Посмотреть структуру исходников
tree src/

# Посмотреть build output
tree build/
```

### Git

```bash
# Статус
git status

# Коммит
git add .
git commit -m "feat: описание изменений"
git push

# Создать релиз
git tag v1.0.0
git push --tags
```

## 📚 Документация

### Доступные файлы

- `README.md` - Основная документация
- `SETUP_GUIDE.md` - Пошаговая настройка
- `QUICK_START_ESM.md` - Быстрый старт ESM
- `IMPLEMENTATION_SUMMARY.md` - Детали реализации
- `COMMANDS_CHEATSHEET.md` - Эта шпаргалка

### Открыть в браузере

```bash
# Markdown preview (если установлен gh-cli)
gh repo view --web

# Или просто открыть в GitHub
```

## 🐛 Отладка

### Проверить типы TypeScript

```bash
# Проверка типов без сборки
npx tsc --noEmit -p tsconfig.esm.json

# Или для AMD
npx tsc --noEmit -p tsconfig.debug.json
```

### Логи сборки

```bash
# Подробные логи
npm run build:esm --verbose

# Только ошибки
npm run build:esm 2>&1 | grep error
```

### Очистка build

```bash
# Удалить build директорию
rm -rf build/

# Пересобрать с нуля
npm run build:esm
```

## 🚀 Deployment

### Подготовка к релизу

```bash
# 1. Очистка
rm -rf build/ node_modules/

# 2. Свежая установка
npm install

# 3. Production build
npm run build:release

# 4. Проверка размеров
ls -lh build/

# 5. Тестирование
# Загрузите в PlayCanvas и протестируйте

# 6. Коммит
git add .
git commit -m "chore: release v1.0.0"
git tag v1.0.0
git push --tags
```

### Публикация в NPM (опционально)

```bash
# Логин
npm login

# Опубликовать
npm publish

# Или dry-run
npm publish --dry-run
```

## 📊 Статистика

### Размеры файлов

```bash
# Общий размер build/
du -sh build/

# Размеры отдельных файлов
ls -lh build/esm/

# Детальная статистика
find build/ -type f -exec ls -lh {} \; | awk '{print $5, $9}'
```

### Зависимости

```bash
# Список установленных пакетов
npm list

# Только production dependencies
npm list --prod

# Проверить устаревшие
npm outdated

# Обновить зависимости
npm update
```

## 🔍 Поиск

### Поиск в коде

```bash
# Найти TODO комментарии
grep -r "TODO" src/

# Найти использование функции
grep -r "probe(" src/

# Найти импорты
grep -r "import.*Ktx2" src/
```

## 💡 Полезные алиасы

Добавьте в `~/.bashrc` или `~/.zshrc`:

```bash
# Быстрые команды
alias ktx-build='npm run build:esm'
alias ktx-watch='npm run watch:esm'
alias ktx-push='npm run build-push:esm'
alias ktx-test='npm run build:esm && echo "✅ Build OK"'
```

## 🆘 Помощь

### Ошибки сборки

```bash
# Переустановка зависимостей
rm -rf node_modules/ package-lock.json
npm install

# Очистка кэша
npm cache clean --force

# Проверка версии Node.js
node --version  # Должно быть >= 16.x
```

### Проблемы с playcanvas-sync

```bash
# Проверить конфигурацию
cat pcconfig.json

# Тестовая загрузка одного файла
node node_modules/playcanvas-sync/bin/pcsync.js push build/esm/Ktx2LoaderScript.mjs

# Логи sync
npm run push --verbose
```

## 📋 Checklist перед коммитом

```bash
# ✅ Сборка без ошибок
npm run build:esm

# ✅ Типы корректны
npx tsc --noEmit

# ✅ Файлы на месте
ls build/esm/

# ✅ Git clean
git status

# ✅ Коммит
git add .
git commit -m "описание"
git push
```

## 🎯 Быстрый старт (один файл)

```bash
# Всё в одной команде
npm install && npm run build:esm && echo "✅ Готово! Файлы в build/esm/"
```

---

**Полезные ссылки:**
- [KTX2 Spec](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)
- [PlayCanvas Docs](https://developer.playcanvas.com/)
- [toktx Tool](https://github.com/KhronosGroup/KTX-Software/releases)

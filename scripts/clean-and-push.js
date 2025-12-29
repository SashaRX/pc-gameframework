#!/usr/bin/env node

/**
 * ПОЛНАЯ ЧИСТКА И ПУШ
 *
 * Этот скрипт:
 * 1. Чистит локальную папку build полностью
 * 2. Получает список ВСЕХ файлов в PlayCanvas
 * 3. Удаляет ВСЁ что не должно там быть
 * 4. Билдит проект
 * 5. Пушит только нужные файлы
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BUILD_DIR = 'build/esm';

// ============================================================================
// WHITELIST - только эти файлы/папки ДОЛЖНЫ быть в PlayCanvas
// Всё остальное будет УДАЛЕНО
// ============================================================================
const ALLOWED_PATHS = [
  // libs
  'libs/',
  'libs/libktx/',
  'libs/libktx/LibktxLoader.mjs',
  'libs/meshoptimizer/',
  'libs/meshoptimizer/MeshoptLoader.mjs',
  'libs/meshoptimizer/index.mjs',
  'libs/meshoptimizer/meshopt_decoder.mjs',

  // loaders
  'loaders/',
  'loaders/GpuFormatDetector.mjs',
  'loaders/Ktx2ProgressiveLoader.mjs',
  'loaders/KtxCacheManager.mjs',
  'loaders/MemoryPool.mjs',
  'loaders/ktx2-types.mjs',
  'loaders/utils/',
  'loaders/utils/alignment.mjs',
  'loaders/utils/colorspace.mjs',
  'loaders/worker-inline.mjs',

  // scripts
  'scripts/',
  'scripts/Ktx2LoaderScript.mjs',
  'scripts/StreamedTextureScript.mjs',
  'scripts/StreamingManagerScript.mjs',
  'scripts/OrbitCamera.mjs',  // Пользовательский скрипт

  // streaming
  'streaming/',
  'streaming/AssetManifest.mjs',
  'streaming/CacheManager.mjs',
  'streaming/StreamingManager.mjs',
  'streaming/index.mjs',
  'streaming/types.mjs',
  'streaming/loaders/',
  'streaming/loaders/MaterialLoader.mjs',
  'streaming/loaders/ModelLoader.mjs',
  'streaming/loaders/TextureLoader.mjs',
  'streaming/loaders/index.mjs',

  // systems
  'systems/',
  'systems/streaming/',
  'systems/streaming/CategoryManager.mjs',
  'systems/streaming/MemoryTracker.mjs',
  'systems/streaming/PriorityQueue.mjs',
  'systems/streaming/SimpleScheduler.mjs',
  'systems/streaming/TextureHandle.mjs',
  'systems/streaming/TextureRegistry.mjs',
  'systems/streaming/TextureStreamingManager.mjs',
  'systems/streaming/index.mjs',
  'systems/streaming/types.mjs',

  // workers
  'workers/',
  'workers/ktx-transcode.worker.mjs'
];

// Файлы которые ТОЧНО надо удалить (известные мусорные файлы)
const KNOWN_GARBAGE = [
  // Старые файлы в корне
  'Ktx2LoaderScript.mjs',
  'libktx.mjs',
  'libktx.wasm',
  'meshopt_decoder.mjs',
  'LibktxLoader.mjs',
  'MeshoptLoader.mjs',

  // Старые папки
  'ktx2-loader',
  'meshopt-loader',

  // Любые .wasm файлы
  'libs/libktx/libktx.wasm',
  'libs/libktx/libktx.mjs',
];

/**
 * Получить список файлов на сервере PlayCanvas которых нет локально
 * Используем diffAll чтобы найти "Remote Files Missing on Local"
 */
function getRemoteOnlyFiles() {
  console.log('📋 Получаю список файлов в PlayCanvas...\n');

  try {
    const output = execSync('node node_modules/playcanvas-sync/bin/pcsync.js diffAll', {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    // Ищем секцию "Remote Files Missing on Local"
    const lines = output.split('\n');
    const files = [];
    let inRemoteSection = false;

    for (const line of lines) {
      if (line.includes('Remote Files Missing on Local')) {
        inRemoteSection = true;
        continue;
      }
      if (line.includes('----') && inRemoteSection) {
        // Следующая секция - выходим
        break;
      }
      if (inRemoteSection && line.trim()) {
        files.push(line.trim());
      }
    }

    console.log(`   Найдено ${files.length} файлов только на сервере\n`);
    return files;
  } catch (error) {
    console.log('⚠️  Не удалось получить список файлов:', error.message);
    // Пробуем прочитать stdout даже если была ошибка
    if (error.stdout) {
      const lines = error.stdout.toString().split('\n');
      const files = [];
      let inRemoteSection = false;

      for (const line of lines) {
        if (line.includes('Remote Files Missing on Local')) {
          inRemoteSection = true;
          continue;
        }
        if (line.includes('----') && inRemoteSection) {
          break;
        }
        if (inRemoteSection && line.trim()) {
          files.push(line.trim());
        }
      }
      return files;
    }
    return [];
  }
}

/**
 * Удалить файл из PlayCanvas
 */
function removeFromPlayCanvas(filePath) {
  try {
    execSync(`node node_modules/playcanvas-sync/bin/pcsync.js rm "${filePath}"`, {
      cwd: process.cwd(),
      stdio: 'pipe'
    });
    console.log(`   🗑️  Удалён: ${filePath}`);
    return true;
  } catch (error) {
    // Файл может не существовать
    return false;
  }
}

/**
 * Проверить, разрешён ли путь
 */
function isPathAllowed(filePath) {
  // Нормализуем путь
  const normalized = filePath.replace(/\\/g, '/');

  // Проверяем точное совпадение или что путь начинается с разрешённой папки
  for (const allowed of ALLOWED_PATHS) {
    if (normalized === allowed || normalized === allowed.replace(/\/$/, '')) {
      return true;
    }
    // Если allowed это папка (кончается на /), проверяем что файл внутри
    if (allowed.endsWith('/') && normalized.startsWith(allowed)) {
      return true;
    }
  }

  return false;
}

/**
 * Очистить локальную папку build
 */
function cleanLocalBuild() {
  console.log('🧹 Чищу локальную папку build...\n');

  if (fs.existsSync('build')) {
    fs.rmSync('build', { recursive: true, force: true });
    console.log('   ✓ build/ удалена\n');
  } else {
    console.log('   ✓ build/ уже чистая\n');
  }
}

/**
 * Очистить PlayCanvas от мусора
 */
function cleanPlayCanvas() {
  console.log('🧹 Чищу PlayCanvas от мусора...\n');

  let removedCount = 0;

  // Сначала удаляем известный мусор
  console.log('   Удаляю известные мусорные файлы:');
  for (const garbage of KNOWN_GARBAGE) {
    if (removeFromPlayCanvas(garbage)) {
      removedCount++;
    }
  }

  // Получаем список файлов которые есть на сервере но нет локально
  const remoteOnlyFiles = getRemoteOnlyFiles();

  if (remoteOnlyFiles.length > 0) {
    console.log(`   Проверяю ${remoteOnlyFiles.length} файлов только на сервере...`);

    // Удаляем файлы которых нет в whitelist
    for (const file of remoteOnlyFiles) {
      // Удаляем если это мусор или не в whitelist
      const isGarbage = KNOWN_GARBAGE.includes(file);
      const isAllowed = isPathAllowed(file);

      if (isGarbage || !isAllowed) {
        console.log(`   ❌ Удаляю: ${file}${isGarbage ? ' (мусор)' : ' (не в whitelist)'}`);
        if (removeFromPlayCanvas(file)) {
          removedCount++;
        }
      } else {
        console.log(`   ✓ Оставляю: ${file}`);
      }
    }
  }

  console.log(`\n   ✓ Удалено ${removedCount} файлов\n`);
  return removedCount;
}

/**
 * Собрать проект
 */
function buildProject() {
  console.log('🔨 Собираю проект...\n');

  try {
    execSync('npm run build:esm', {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
    console.log('\n   ✓ Сборка завершена\n');
    return true;
  } catch (error) {
    console.error('\n   ❌ Ошибка сборки!\n');
    return false;
  }
}

/**
 * Рекурсивно найти все файлы
 */
function getAllFiles(dir, baseDir = dir) {
  const files = [];

  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      const relativePath = path.relative(baseDir, fullPath);
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Копировать raw файлы (не компилируемые TypeScript)
 */
function copyRawFiles() {
  const rawFiles = [
    {
      src: 'src/libs/meshoptimizer/meshopt_decoder.mjs',
      dest: 'build/esm/libs/meshoptimizer/meshopt_decoder.mjs'
    }
  ];

  for (const { src, dest } of rawFiles) {
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      console.log(`   ✓ Скопирован: ${src}`);
    }
  }
}

/**
 * Пушить файлы в PlayCanvas
 */
function pushFiles() {
  console.log('📤 Пушу файлы в PlayCanvas...\n');

  // Копируем raw файлы
  copyRawFiles();

  const files = getAllFiles(BUILD_DIR);

  if (files.length === 0) {
    console.error('   ❌ Нет файлов для пуша!');
    return false;
  }

  console.log(`   Найдено ${files.length} файлов:\n`);

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const pcPath = file.replace(/\\/g, '/');

    try {
      execSync(`node node_modules/playcanvas-sync/bin/pcsync.js push "${pcPath}"`, {
        cwd: process.cwd(),
        stdio: 'pipe'
      });
      console.log(`   ✓ ${pcPath}`);
      successCount++;
    } catch (error) {
      console.error(`   ❌ ${pcPath}: ${error.message}`);
      failCount++;
    }
  }

  console.log(`\n   ✅ Запушено: ${successCount}, ❌ Ошибок: ${failCount}\n`);
  return failCount === 0;
}

/**
 * MAIN
 */
function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           ПОЛНАЯ ЧИСТКА И ПУШ                                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n');

  // 1. Сначала билдим (чтобы diffAll работал)
  cleanLocalBuild();

  if (!buildProject()) {
    process.exit(1);
  }

  // 2. Теперь чистим PlayCanvas (diffAll будет работать)
  cleanPlayCanvas();

  // 3. Пушим
  if (!pushFiles()) {
    console.error('❌ Пуш завершился с ошибками');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎉 ГОТОВО! Проект очищен и запушен.');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main();

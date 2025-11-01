#!/usr/bin/env node
/**
 * Тестовый скрипт для проверки правильности сборки libktx.mjs
 *
 * Проверяет:
 * 1. Module.ready Promise существует
 * 2. Экспортированные функции доступны
 * 3. FS/TTY отключены
 * 4. Модуль инициализируется без ошибок
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Цвета для вывода
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(color, symbol, message) {
  console.log(`${color}${symbol}${colors.reset} ${message}`);
}

function pass(message) {
  log(colors.green, '✅', message);
}

function fail(message) {
  log(colors.red, '❌', message);
}

function warn(message) {
  log(colors.yellow, '⚠️ ', message);
}

function info(message) {
  log(colors.cyan, 'ℹ️ ', message);
}

async function runTests() {
  console.log('🧪 Запуск тестов libktx.mjs\n');

  let testsPassed = 0;
  let testsFailed = 0;

  // Тест 1: Проверка существования файла
  info('Тест 1: Проверка существования файлов');
  try {
    const libktxPath = join(projectRoot, 'lib', 'libktx.mjs');
    const wasmPath = join(projectRoot, 'lib', 'libktx.wasm');

    const mjsStats = statSync(libktxPath);
    const wasmStats = statSync(wasmPath);

    pass(`libktx.mjs найден (${(mjsStats.size / 1024).toFixed(2)} КБ)`);
    pass(`libktx.wasm найден (${(wasmStats.size / 1024).toFixed(2)} КБ)`);

    if (mjsStats.size > 500 * 1024) {
      warn('libktx.mjs больше 500 КБ - возможно FS/TTY включены');
    }

    testsPassed += 2;
  } catch (err) {
    fail(`Файлы не найдены: ${err.message}`);
    testsFailed += 2;
    return;
  }

  // Тест 2: Проверка содержимого на критические проблемы
  info('\nТест 2: Проверка содержимого файла');
  try {
    const libktxPath = join(projectRoot, 'lib', 'libktx.mjs');
    const code = readFileSync(libktxPath, 'utf8');

    // 2.1: Проверка createKtxModule
    if (code.includes('async function createKtxModule')) {
      pass('createKtxModule функция найдена');
      testsPassed++;
    } else {
      fail('createKtxModule функция не найдена');
      testsFailed++;
    }

    // 2.2: Проверка Module.ready
    if (code.includes('Module.ready')) {
      pass('Module.ready Promise найден');
      testsPassed++;
    } else {
      fail('Module.ready Promise НЕ НАЙДЕН (критическая проблема!)');
      testsFailed++;
    }

    // 2.3: Проверка readyPromiseResolve
    if (code.includes('readyPromiseResolve') && code.includes('readyPromiseReject')) {
      pass('readyPromiseResolve/Reject найдены');
      testsPassed++;
    } else {
      fail('readyPromiseResolve/Reject НЕ НАЙДЕНЫ');
      testsFailed++;
    }

    // 2.4: Проверка assignWasmExports
    if (code.includes('assignWasmExports')) {
      pass('assignWasmExports вызывается');
      testsPassed++;

      if (code.includes('function assignWasmExports') || code.includes('assignWasmExports=')) {
        pass('assignWasmExports определена');
        testsPassed++;
      } else {
        fail('assignWasmExports вызывается, но НЕ ОПРЕДЕЛЕНА!');
        testsFailed++;
      }
    } else {
      warn('assignWasmExports не используется (возможно норма для новой версии)');
      testsPassed++;
    }

    // 2.5: Проверка wasmImports
    if (code.includes('var info={a:wasmImports}') || code.includes('var info = { a: wasmImports }')) {
      if (code.includes('var wasmImports') || code.includes('let wasmImports')) {
        pass('wasmImports инициализирован');
        testsPassed++;
      } else {
        fail('wasmImports используется, но НЕ ИНИЦИАЛИЗИРОВАН!');
        testsFailed++;
      }
    } else {
      pass('wasmImports не используется (использует другой метод)');
      testsPassed++;
    }

    // 2.6: Проверка FS/TTY (должны быть отключены)
    if (code.includes('FS.init()') || code.includes('TTY.init()')) {
      fail('FS/TTY всё ещё включены (файл раздут!)');
      testsFailed++;
    } else {
      pass('FS/TTY отключены (оптимизированная сборка)');
      testsPassed++;
    }

  } catch (err) {
    fail(`Ошибка чтения файла: ${err.message}`);
    testsFailed++;
  }

  // Тест 3: Динамический импорт и проверка API
  info('\nТест 3: Динамический импорт модуля');
  try {
    const libktxPath = join(projectRoot, 'lib', 'libktx.mjs');
    const { default: createKtxModule } = await import(`file://${libktxPath}`);

    if (typeof createKtxModule === 'function') {
      pass('createKtxModule импортируется как функция');
      testsPassed++;
    } else {
      fail('createKtxModule не является функцией');
      testsFailed++;
      return;
    }

    // Создание модуля
    info('\nТест 4: Инициализация модуля');
    const wasmPath = join(projectRoot, 'lib', 'libktx.wasm');
    const Module = await createKtxModule({
      locateFile: (path) => {
        if (path === 'libktx.wasm') {
          return `file://${wasmPath}`;
        }
        return path;
      },
      print: () => {}, // Отключаем вывод
      printErr: () => {},
    });

    if (Module) {
      pass('Модуль создан');
      testsPassed++;
    } else {
      fail('Модуль не создан');
      testsFailed++;
      return;
    }

    // 4.1: Проверка Module.ready
    if (Module.ready && Module.ready instanceof Promise) {
      pass('Module.ready существует и является Promise');
      testsPassed++;

      // Ждём готовности модуля
      info('Ожидание готовности модуля...');
      try {
        await Module.ready;
        pass('Module.ready успешно резолвнулся');
        testsPassed++;
      } catch (err) {
        fail(`Module.ready отклонён с ошибкой: ${err.message}`);
        testsFailed++;
      }
    } else {
      fail('Module.ready НЕ СУЩЕСТВУЕТ или НЕ Promise!');
      testsFailed++;
    }

    // 4.2: Проверка экспортированных объектов
    info('\nТест 5: Проверка экспортов');

    const exports = ['ktxTexture', 'ErrorCode', 'TranscodeTarget', 'TranscodeFlags'];
    for (const exp of exports) {
      if (Module[exp] !== undefined) {
        pass(`Module.${exp} экспортирован`);
        testsPassed++;
      } else {
        fail(`Module.${exp} НЕ ЭКСПОРТИРОВАН!`);
        testsFailed++;
      }
    }

    // 4.3: Проверка C функций
    const cFunctions = ['_malloc', '_free'];
    for (const func of cFunctions) {
      if (typeof Module[func] === 'function') {
        pass(`${func} доступна`);
        testsPassed++;
      } else {
        warn(`${func} не доступна (возможно не экспортирована)`);
      }
    }

    // 4.4: Проверка HEAPU8
    if (Module.HEAPU8 && Module.HEAPU8 instanceof Uint8Array) {
      pass('HEAPU8 доступен');
      testsPassed++;
    } else {
      fail('HEAPU8 не доступен');
      testsFailed++;
    }

    // 4.5: Проверка что FS/TTY отключены
    info('\nТест 6: Проверка отсутствия FS/TTY');
    if (Module.FS === undefined) {
      pass('FS отключён');
      testsPassed++;
    } else {
      fail('FS всё ещё включён!');
      testsFailed++;
    }

    if (Module.TTY === undefined) {
      pass('TTY отключён');
      testsPassed++;
    } else {
      fail('TTY всё ещё включён!');
      testsFailed++;
    }

  } catch (err) {
    fail(`Ошибка импорта/инициализации: ${err.message}`);
    console.error(err.stack);
    testsFailed++;
  }

  // Итоги
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Результаты тестов:`);
  console.log(`   ${colors.green}✅ Пройдено: ${testsPassed}${colors.reset}`);
  console.log(`   ${colors.red}❌ Провалено: ${testsFailed}${colors.reset}`);

  if (testsFailed === 0) {
    console.log(`\n${colors.green}🎉 Все тесты пройдены! libktx.mjs собран правильно.${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}❌ Некоторые тесты провалены. Проверьте сборку!${colors.reset}`);
    console.log(`\nДля пересборки запустите:`);
    console.log(`   ./scripts/build-libktx.sh`);
    process.exit(1);
  }
}

// Запуск тестов
runTests().catch((err) => {
  console.error(`${colors.red}Критическая ошибка:${colors.reset}`, err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Быстрое исправление текущего libktx.mjs
 * Добавляет Module.ready Promise без полной пересборки
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const libktxPath = join(projectRoot, 'lib', 'libktx.mjs');

console.log('🔧 Быстрое исправление libktx.mjs\n');

try {
  let code = readFileSync(libktxPath, 'utf8');
  const originalSize = code.length;
  let changesCount = 0;

  // 1. Добавить Module.ready Promise после readyPromiseResolve,readyPromiseReject
  const readyVarsPattern = 'var readyPromiseResolve,readyPromiseReject;';
  if (code.includes(readyVarsPattern)) {
    if (!code.includes('Module.ready=new Promise')) {
      console.log('✅ Добавление Module.ready Promise...');
      code = code.replace(
        readyVarsPattern,
        readyVarsPattern + 'Module.ready=new Promise((resolve,reject)=>{readyPromiseResolve=resolve;readyPromiseReject=reject});'
      );
      changesCount++;
    } else {
      console.log('⚠️  Module.ready Promise уже существует');
    }
  } else {
    console.log('❌ Не найден readyPromiseResolve,readyPromiseReject');
  }

  // 2. Исправить onRuntimeInitialized для резолва Promise
  const runtimeInitOld = 'Module.onRuntimeInitialized=function(){Module["ktxTexture"]=Module.texture;Module["ErrorCode"]=Module.error_code;Module["TranscodeTarget"]=Module.transcode_fmt;Module["TranscodeFlags"]=Module.transcode_flag_bits}';

  if (code.includes(runtimeInitOld)) {
    console.log('✅ Исправление onRuntimeInitialized для резолва Promise...');
    const runtimeInitNew = 'Module.onRuntimeInitialized=function(){try{Module["ktxTexture"]=Module.texture;Module["ErrorCode"]=Module.error_code;Module["TranscodeTarget"]=Module.transcode_fmt;Module["TranscodeFlags"]=Module.transcode_flag_bits;if(readyPromiseResolve){readyPromiseResolve(Module)}}catch(err){console.error("[libktx] Runtime initialization failed:",err);if(readyPromiseReject){readyPromiseReject(err)}throw err}}';

    code = code.replace(runtimeInitOld, runtimeInitNew);
    changesCount++;
  } else {
    console.log('⚠️  onRuntimeInitialized уже исправлен или имеет другой формат');
  }

  // 3. Исправить locateFile (убрать хардкод import.meta.url)
  const locateFileOld = 'return new URL("libktx.wasm",import.meta.url).href';
  if (code.includes(locateFileOld)) {
    console.log('✅ Исправление locateFile...');
    code = code.replace(
      locateFileOld,
      'return scriptDirectory+"libktx.wasm"'
    );
    changesCount++;
  } else {
    console.log('⚠️  locateFile уже исправлен');
  }

  // Сохранение
  if (changesCount > 0) {
    writeFileSync(libktxPath, code);
    const newSize = code.length;
    const diff = newSize - originalSize;

    console.log(`\n✅ Файл исправлен! Внесено изменений: ${changesCount}`);
    console.log(`   Размер: ${originalSize} → ${newSize} (${diff > 0 ? '+' : ''}${diff} байт)`);
    console.log('\n📝 Изменения:');
    console.log('   1. Добавлен Module.ready Promise');
    console.log('   2. onRuntimeInitialized резолвит Promise');
    console.log('   3. locateFile использует scriptDirectory');
    console.log('\n🧪 Запустите тесты: node scripts/test-libktx.mjs');
  } else {
    console.log('\n⚠️  Изменения не требуются, файл уже исправлен');
  }
} catch (err) {
  console.error('❌ Ошибка:', err.message);
  process.exit(1);
}

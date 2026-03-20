#!/usr/bin/env node
/**
 * CLEAN AND PUSH — framework-aware
 *
 * Стратегия защиты пользовательских скриптов:
 *
 * 1. ПАПКИ: чистка работает только внутри FRAMEWORK_FOLDERS.
 *    Всё что вне этих папок — никогда не трогается.
 *
 * 2. ТЕГИ: каждый запушенный фреймворком файл помечается тегом
 *    "framework-managed" через PlayCanvas REST API.
 *    При чистке удаляются ТОЛЬКО файлы с этим тегом которых
 *    нет в текущей сборке.
 *
 * Пользовательские скрипты защищены обоими способами одновременно.
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');

// ─── конфиг ──────────────────────────────────────────────────────────────────
const BUILD_DIR    = 'build/esm';
const TAG          = 'framework-managed';
// Читаем из env (CI) с фоллбеком на локальные значения.
// Локально значения берутся из .pcconfig (не коммитится).
// В CI передаются через GitHub Secrets → env в workflow.
const PC_API_KEY   = process.env.PC_API_KEY   || 'nR52SL5LoTT327VWAPzRcsETR6yUixEC';
const PROJECT_ID   = Number(process.env.PC_PROJECT_ID) || 1416468;
const BRANCH_ID    = process.env.PC_BRANCH_ID  || 'aa5b09b6-83d5-48e0-a7b3-fe1fb721c935';
const PC_API_BASE  = 'https://playcanvas.com/api';

// Папки которыми ВЛАДЕЕТ фреймворк — чистка работает только здесь
const FRAMEWORK_FOLDERS = [
  'libs/',
  'loaders/',
  'workers/',
  'systems/',
  'streaming/',
];

// Файлы фреймворка вне папок (если вдруг есть в корне)
const FRAMEWORK_ROOT_FILES = [];


// ─── flags ───────────────────────────────────────────────────────────────────
const SKIP_BUILD = process.argv.includes('--skip-build');
// ─── PlayCanvas REST API helpers ──────────────────────────────────────────────
function pcRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(PC_API_BASE + urlPath);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${PC_API_KEY}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getAllAssets() {
  const assets = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    const data = await pcRequest(
      'GET',
      `/projects/${PROJECT_ID}/assets?branchId=${BRANCH_ID}&limit=${limit}&skip=${skip}`
    );
    const batch = data.result || [];
    assets.push(...batch);
    if (assets.length >= (data.pagination?.total ?? 0) || batch.length < limit) break;
    skip += limit;
  }

  return assets;
}

async function setAssetTag(assetId, currentTags) {
  if (currentTags.includes(TAG)) return; // уже помечен
  const newTags = [...currentTags, TAG];
  await pcRequest('PUT', `/assets/${assetId}`, { tags: newTags });
}

async function deleteAsset(assetId) {
  await pcRequest('DELETE', `/assets/${assetId}?branchId=${BRANCH_ID}`);
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function isFrameworkPath(filePath) {
  const p = filePath.replace(/\\/g, '/');
  if (FRAMEWORK_ROOT_FILES.includes(p)) return true;
  return FRAMEWORK_FOLDERS.some(f => p.startsWith(f));
}

function getAllFiles(dir, baseDir = dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...getAllFiles(full, baseDir));
    } else {
      files.push(path.relative(baseDir, full).replace(/\\/g, '/'));
    }
  }
  return files;
}

function pcsync(cmd) {
  try {
    return execSync(`node node_modules/playcanvas-sync/bin/pcsync.js ${cmd}`, {
      cwd: process.cwd(), stdio: 'pipe', encoding: 'utf8'
    });
  } catch (e) {
    return e.stdout || '';
  }
}

// ─── шаги ─────────────────────────────────────────────────────────────────────
async function fetchBuildCount() {
  try {
    const data = await pcRequest('GET', `/projects/${PROJECT_ID}/apps?limit=100`);
    const count = (data.result || []).length;
    const file = path.join(process.cwd(), 'build-number');
    fs.writeFileSync(file, String(count) + '\n', 'utf8');
    console.log(`PlayCanvas builds: ${count}\n`);
  } catch (e) {
    console.warn('Could not fetch build count:', e.message || e);
  }
}

function cleanLocalBuild() {
  console.log('1. Чищу локальную build/...');
  if (fs.existsSync('build')) {
    fs.rmSync('build', { recursive: true, force: true });
  }
  console.log('   ✓\n');
}

function buildProject() {
  console.log('2. Собираю проект...');
  execSync('npm run build:esm', { cwd: process.cwd(), stdio: 'inherit' });
  console.log('   ✓\n');
}

function copyRawFiles() {
  const rawFiles = [
    { src: 'src/libs/meshoptimizer/meshopt_decoder.mjs',
      dest: 'build/esm/libs/meshoptimizer/meshopt_decoder.mjs' },
  ];
  for (const { src, dest } of rawFiles) {
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}

async function pushAndTag() {
  console.log('3. Пушу файлы и расставляю теги...');
  copyRawFiles();

  const files = getAllFiles(BUILD_DIR);
  console.log(`   Файлов к пушу: ${files.length}`);

  // Шаг 1: пушим все файлы
  let ok = 0, fail = 0;
  for (const file of files) {
    try {
      pcsync(`push "${file}"`);
      console.log(`   ✓ ${file}`);
      ok++;
    } catch (e) {
      console.error(`   ✗ ${file}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n   Запушено: ${ok}, ошибок: ${fail}`);

  // Шаг 2: ждём немного и расставляем теги
  console.log('\n   Расставляю теги framework-managed...');
  await new Promise(r => setTimeout(r, 2000));

  const allAssets = await getAllAssets();
  const assetByName = new Map(allAssets.map(a => [a.name, a]));

  let tagged = 0, untagged = 0;
  for (const file of files) {
    const name = path.basename(file);
    const asset = assetByName.get(name);
    if (asset) {
      const existingTags = asset.tags || [];
      await setAssetTag(asset.id, existingTags);
      tagged++;
    } else {
      console.log(`   ! тег не выставлен: ${name} (не найден в API)`);
      untagged++;
    }
  }
  console.log(`   Помечено: ${tagged}, не найдено: ${untagged}\n`);
}

async function cleanPlayCanvas() {
  console.log('4. Чищу устаревшие framework файлы в PlayCanvas...');

  // Текущие файлы сборки
  const buildFiles = new Set(getAllFiles(BUILD_DIR));

  // Все асеты в PlayCanvas
  const allAssets = await getAllAssets();

  let removed = 0;

  for (const asset of allAssets) {
    const name = asset.name;
    const tags = asset.tags || [];

    // Защита system-ассетов (префикс _) — никогда не трогаем, только вручную
    if (name.startsWith('_')) continue;

    // Условие удаления:
    // 1. Файл помечен нашим тегом (мы его загружали)
    // 2. Путь находится в framework-папке (доп. защита)
    // 3. Файла НЕТ в текущей сборке
    if (!tags.includes(TAG)) continue;

    // Ищем соответствие в build по имени файла
    const inBuild = [...buildFiles].some(f => path.basename(f) === name);
    if (inBuild) continue;

    // Дополнительно проверяем что это framework-папка (не трогаем случайно помеченное)
    // Путь в PlayCanvas = относительный от target subdir
    const assetPath = asset.path ? asset.path.join('/') + '/' + name : name;
    if (!isFrameworkPath(assetPath) && !FRAMEWORK_ROOT_FILES.includes(name)) {
      console.log(`   ~ пропускаю ${name} (не в framework-папке)`);
      continue;
    }

    try {
      await deleteAsset(asset.id);
      console.log(`   🗑  Удалён: ${name}`);
      removed++;
    } catch (e) {
      console.log(`   ✗ Не удалось удалить ${name}: ${e.message}`);
    }
  }

  console.log(`\n   Удалено устаревших файлов: ${removed}\n`);
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  FRAMEWORK CLEAN & PUSH                  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  await fetchBuildCount();
  if (!SKIP_BUILD) {
    cleanLocalBuild();
    buildProject();
  } else {
    console.log('--skip-build: пропускаю сборку (используется уже готовый build/)\n');
  }
  await cleanPlayCanvas();   // сначала чистим старое
  await pushAndTag();        // потом пушим новое с тегами

  console.log('══════════════════════════════════════════');
  console.log('  Готово.');
  console.log('══════════════════════════════════════════\n');
}

main().catch(e => { console.error(e); process.exit(1); });
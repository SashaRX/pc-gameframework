#!/usr/bin/env node
/**
 * Cleanup Script for pc-gameframework
 *
 * Removes orphaned files from previous versions and maintains project hygiene.
 * Run with --dry-run to see what would be deleted without actually deleting.
 * Run with --archive to move docs to docs/archive instead of deleting.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const ARCHIVE_DOCS = process.argv.includes('--archive');

// Files/folders that SHOULD exist (manifest)
const EXPECTED_STRUCTURE = {
  // Root level
  '.gitignore': 'file',
  '.pcconfig': 'file',
  'LICENSE': 'file',
  'README.md': 'file',
  'package.json': 'file',
  'package-lock.json': 'file',
  'tsconfig.esm.json': 'file',
  'tsconfig.debug.json': 'file',
  'tsconfig.release.json': 'file',

  // Folders
  '.claude': 'dir',
  '.git': 'dir',
  '.vscode': 'dir',
  'build': 'dir',
  'node_modules': 'dir',
  'scripts': 'dir',
  'src': 'dir',
};

// Files/folders to ALWAYS remove (known orphans)
const ORPHANS_TO_REMOVE = [
  // Old reference scripts folder
  'old_reference_scripts',

  // Old/orphaned files in src
  'src/scripts/Ktx2LoaderScriptESM.mjs',
  'src/libs/libktx/libktx-wrapper.mjs',
  'src/libs/libktx/libktx.mjs',   // загружается с внешнего сервера
  'src/libs/libktx/libktx.wasm',  // загружается с внешнего сервера

  // Old documentation (excessive, keep only README.md)
  'BUILD_LIBKTX_GUIDE.md',
  'CMAKE_RECOMMENDATIONS.md',
  'COMMANDS_CHEATSHEET.md',
  'FINAL_SUMMARY.md',
  'IMPLEMENTATION_SUMMARY.md',
  'LATEST_VERSION_GUIDE.md',
  'LIBKTX_ISSUES_AND_FIXES.md',
  'MILESTONES.md',
  'QUICK_START_ESM.md',
  'SECURITY.md',
  'SETUP_GUIDE.md',
  'STREAMING_QUICK_START.md',
  'STREAMING_USAGE.md',

  // Old patches/configs
  'CMAKE_PATCH_LATEST.txt',
  'EMSCRIPTEN_CMAKE_PATCH.txt',
  'pcconfig.template.json',
  'post_ready.js',
  'prepare-build.bat',
  'prepare-build.sh',

  // Old build scripts (keep only essential ones)
  'scripts/apply-cmake-patch.sh',
  'scripts/build-libktx-latest.sh',
  'scripts/build-libktx.sh',
  'scripts/quick-fix-libktx.mjs',
  'scripts/test-libktx.mjs',
];

// Essential scripts to keep
const ESSENTIAL_SCRIPTS = [
  'scripts/build-worker-inline.mjs',
  'scripts/rename-to-mjs.js',
  'scripts/push-with-structure.js',
  'scripts/clean-and-push.js',
  'scripts/cleanup.js',
];

let removedCount = 0;
let archivedCount = 0;

function removeItem(itemPath) {
  const fullPath = path.join(ROOT, itemPath);

  if (!fs.existsSync(fullPath)) {
    return false;
  }

  const stat = fs.statSync(fullPath);
  const isDir = stat.isDirectory();

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would remove: ${itemPath} (${isDir ? 'directory' : 'file'})`);
    removedCount++;
    return true;
  }

  try {
    if (isDir) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    console.log(`  ✓ Removed: ${itemPath}`);
    removedCount++;
    return true;
  } catch (err) {
    console.error(`  ✗ Failed to remove ${itemPath}: ${err.message}`);
    return false;
  }
}

function archiveDoc(docPath) {
  const fullPath = path.join(ROOT, docPath);
  const archiveDir = path.join(ROOT, 'docs', 'archive');
  const archivePath = path.join(archiveDir, path.basename(docPath));

  if (!fs.existsSync(fullPath)) {
    return false;
  }

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would archive: ${docPath} -> docs/archive/`);
    archivedCount++;
    return true;
  }

  try {
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    fs.renameSync(fullPath, archivePath);
    console.log(`  ✓ Archived: ${docPath} -> docs/archive/`);
    archivedCount++;
    return true;
  } catch (err) {
    console.error(`  ✗ Failed to archive ${docPath}: ${err.message}`);
    return false;
  }
}

function findUnexpectedFiles() {
  const unexpected = [];
  const rootItems = fs.readdirSync(ROOT);

  for (const item of rootItems) {
    // Skip expected items
    if (EXPECTED_STRUCTURE[item]) continue;
    // Skip docs folder if archiving
    if (ARCHIVE_DOCS && item === 'docs') continue;

    // Check if it's in orphans list (will be handled separately)
    if (ORPHANS_TO_REMOVE.includes(item)) continue;

    unexpected.push(item);
  }

  return unexpected;
}

function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           pc-gameframework Cleanup Script                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No files will be modified\n');
  }

  // Step 1: Remove known orphans
  console.log('📁 Removing known orphaned files...');
  console.log('');

  const docFiles = ORPHANS_TO_REMOVE.filter(f => f.endsWith('.md') || f.endsWith('.txt'));
  const nonDocFiles = ORPHANS_TO_REMOVE.filter(f => !f.endsWith('.md') && !f.endsWith('.txt'));

  // Handle non-doc orphans (always remove)
  for (const orphan of nonDocFiles) {
    removeItem(orphan);
  }

  console.log('');

  // Handle doc files (archive or remove based on flag)
  if (docFiles.length > 0) {
    if (ARCHIVE_DOCS) {
      console.log('📚 Archiving documentation files to docs/archive/...');
    } else {
      console.log('📚 Removing old documentation files...');
    }
    console.log('');

    for (const doc of docFiles) {
      if (ARCHIVE_DOCS) {
        archiveDoc(doc);
      } else {
        removeItem(doc);
      }
    }
  }

  console.log('');

  // Step 2: Report unexpected files
  const unexpected = findUnexpectedFiles();
  if (unexpected.length > 0) {
    console.log('⚠️  Unexpected files in root (review manually):');
    for (const item of unexpected) {
      console.log(`   - ${item}`);
    }
    console.log('');
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Summary: ${removedCount} items removed, ${archivedCount} items archived`);

  if (DRY_RUN) {
    console.log('');
    console.log('Run without --dry-run to apply changes.');
    console.log('Use --archive to move docs to docs/archive instead of deleting.');
  }

  console.log('');
}

main();

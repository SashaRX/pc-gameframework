#!/usr/bin/env node

/**
 * Push files to PlayCanvas preserving folder structure
 *
 * This script explicitly pushes each file with its full path to ensure
 * the folder structure is preserved on PlayCanvas.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BUILD_DIR = 'build/esm';
const LIB_DIR = 'lib';

// Library files to push separately (relative to LIB_DIR)
const LIB_FILES = [
  'libktx.mjs',
  'libktx.wasm',
  'meshoptimizer/meshopt_decoder.mjs'
];

/**
 * Recursively find all files in a directory
 */
function getAllFiles(dir, baseDir = dir) {
  const files = [];

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      // Get relative path from base directory
      const relativePath = path.relative(baseDir, fullPath);
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Push a single file to PlayCanvas
 * @param {string} filePath - Path relative to PLAYCANVAS_TARGET_SUBDIR
 * @param {string} localDir - Local directory containing the file
 */
function pushFile(filePath, localDir = BUILD_DIR) {
  console.log(`📤 Pushing: ${filePath}`);

  try {
    // Use forward slashes for PlayCanvas paths
    const pcPath = filePath.replace(/\\/g, '/');
    const localPath = path.join(localDir, filePath);

    // Check file exists
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found: ${localPath}`);
    }

    execSync(`node node_modules/playcanvas-sync/bin/pcsync.js push "${pcPath}"`, {
      cwd: process.cwd(),
      stdio: 'inherit'
    });

    console.log(`✅ Pushed: ${filePath}\n`);
  } catch (error) {
    console.error(`❌ Failed to push ${filePath}:`, error.message);
    throw error;
  }
}

/**
 * Push lib files (libktx, meshopt) to PlayCanvas root
 */
function pushLibFiles() {
  console.log('\n📚 Pushing library files...\n');

  let successCount = 0;
  let failCount = 0;

  for (const file of LIB_FILES) {
    const localPath = path.join(LIB_DIR, file);
    // Push to PlayCanvas root (not in subdirectory)
    const pcPath = path.basename(file); // Just filename for root

    console.log(`📤 Pushing lib: ${file} -> ${pcPath}`);

    try {
      if (!fs.existsSync(localPath)) {
        console.log(`⚠️  Skipping ${file} (not found)`);
        continue;
      }

      // For lib files, we need to push directly with the source path
      execSync(`node node_modules/playcanvas-sync/bin/pcsync.js push "${localPath}" --target "${pcPath}"`, {
        cwd: process.cwd(),
        stdio: 'inherit'
      });

      console.log(`✅ Pushed: ${pcPath}\n`);
      successCount++;
    } catch (error) {
      // Try alternative approach - copy to build dir temporarily
      console.log(`⚠️  Trying alternative push for ${file}...`);
      try {
        const tempPath = path.join(BUILD_DIR, pcPath);
        fs.copyFileSync(localPath, tempPath);
        execSync(`node node_modules/playcanvas-sync/bin/pcsync.js push "${pcPath}"`, {
          cwd: process.cwd(),
          stdio: 'inherit'
        });
        console.log(`✅ Pushed: ${pcPath}\n`);
        successCount++;
      } catch (err) {
        console.error(`❌ Failed to push ${file}`);
        failCount++;
      }
    }
  }

  return { successCount, failCount };
}

/**
 * Main function
 */
function main() {
  console.log('🚀 Starting structured push to PlayCanvas...\n');

  if (!fs.existsSync(BUILD_DIR)) {
    console.error(`❌ Build directory not found: ${BUILD_DIR}`);
    console.error('Run "npm run build:esm" first');
    process.exit(1);
  }

  // Get all files
  const files = getAllFiles(BUILD_DIR);

  if (files.length === 0) {
    console.error('❌ No files found to push');
    process.exit(1);
  }

  console.log(`📦 Found ${files.length} files to push:\n`);
  files.forEach(file => console.log(`   - ${file}`));
  console.log('');

  // Push each file
  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    try {
      pushFile(file);
      successCount++;
    } catch (error) {
      failCount++;
    }
  }

  // Push library files (libktx, meshopt)
  const libResult = pushLibFiles();
  successCount += libResult.successCount;
  failCount += libResult.failCount;

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Successfully pushed: ${successCount} files`);

  if (failCount > 0) {
    console.log(`❌ Failed: ${failCount} files`);
    process.exit(1);
  }

  console.log('🎉 All files pushed successfully!');
}

// Run
main();

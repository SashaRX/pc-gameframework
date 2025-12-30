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

// Raw JS/WASM files to copy from src to build before push
// These are not compiled by TypeScript, just need to be copied
// NOTE: libktx.mjs/wasm загружаются с внешнего сервера, не копируем
const RAW_FILES_TO_COPY = [
  { src: 'src/libs/meshoptimizer/meshopt_decoder.mjs', dest: 'build/esm/libs/meshoptimizer/meshopt_decoder.mjs' }
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
 * Main function
 */
function main() {
  console.log('🚀 Starting structured push to PlayCanvas...\n');

  if (!fs.existsSync(BUILD_DIR)) {
    console.error(`❌ Build directory not found: ${BUILD_DIR}`);
    console.error('Run "npm run build:esm" first');
    process.exit(1);
  }

  // Copy raw JS files (not compiled by TypeScript) to build directory
  console.log('📋 Copying raw library files...\n');
  for (const { src, dest } of RAW_FILES_TO_COPY) {
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      console.log(`   ✓ Copied: ${src} -> ${dest}`);
    }
  }
  console.log('');

  // Get all built files
  let files = getAllFiles(BUILD_DIR);

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

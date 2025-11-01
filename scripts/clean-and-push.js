#!/usr/bin/env node

/**
 * Clean old files from PlayCanvas and push new structure
 *
 * This script removes old files from the root that should be in subdirectories,
 * then pushes the correct file structure.
 */

const { execSync } = require('child_process');

// Files to remove from PlayCanvas root (old locations)
const OLD_FILES_TO_REMOVE = [
  'Ktx2LoaderScript.mjs',
  'libktx.mjs',
  'libktx.wasm'
];

/**
 * Remove a file from PlayCanvas
 */
function removeFile(filePath) {
  console.log(`🗑️  Removing old file: ${filePath}`);

  try {
    execSync(`node node_modules/playcanvas-sync/bin/pcsync.js rm "${filePath}"`, {
      cwd: process.cwd(),
      stdio: 'pipe'
    });
    console.log(`✅ Removed: ${filePath}`);
  } catch (error) {
    // File might not exist, that's ok
    console.log(`⚠️  Could not remove ${filePath} (may not exist)`);
  }
}

/**
 * Main function
 */
function main() {
  console.log('🧹 Cleaning old files from PlayCanvas...\n');

  // Remove old files
  for (const file of OLD_FILES_TO_REMOVE) {
    removeFile(file);
  }

  console.log('\n✅ Cleanup complete!\n');
  console.log('📤 Now pushing files with correct structure...\n');

  // Run the push script
  try {
    execSync('node scripts/push-with-structure.js', {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('❌ Push failed:', error.message);
    process.exit(1);
  }
}

// Run
main();

const fs = require('fs');
const path = require('path');

const BUILD_DIR = 'build/esm';

/**
 * Pass 1: Rename all .js files to .mjs
 */
function renameAllJsToMjs(dir) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const fullPath = path.join(dir, file);

    if (fs.statSync(fullPath).isDirectory()) {
      renameAllJsToMjs(fullPath);
    } else if (file.endsWith('.js')) {
      const newPath = fullPath.replace(/\.js$/, '.mjs');
      fs.renameSync(fullPath, newPath);
    }
  });
}

/**
 * Pass 2: Fix imports in all .mjs files
 */
function fixImports(dir) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const fullPath = path.join(dir, file);

    if (fs.statSync(fullPath).isDirectory()) {
      fixImports(fullPath);
    } else if (file.endsWith('.mjs')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const fileDir = path.dirname(fullPath);

      // Replace imports that already have .js extension
      let updated = content.replace(/from '(\.[^']+)\.js'/g, "from '$1.mjs'");

      // Add .mjs extension to relative imports without extension
      updated = updated.replace(/from '(\.[^'"]+)'/g, (match, importPath) => {
        // Skip if already has extension
        if (importPath.endsWith('.mjs') || importPath.endsWith('.js')) return match;

        // Resolve the import path relative to the current file
        const resolvedPath = path.resolve(fileDir, importPath);

        // Check if it's a directory with index.mjs
        const indexPath = path.join(resolvedPath, 'index.mjs');

        if (fs.existsSync(indexPath)) {
          // It's a directory import - add /index.mjs
          return `from '${importPath}/index.mjs'`;
        } else {
          // It's a file import - add .mjs
          return `from '${importPath}.mjs'`;
        }
      });

      if (updated !== content) {
        fs.writeFileSync(fullPath, updated);
      }
    }
  });
}

// Create build/esm directory
fs.mkdirSync(BUILD_DIR, { recursive: true });

// Process build output
if (fs.existsSync('build/esm-temp')) {
  const tempFiles = fs.readdirSync('build/esm-temp');

  tempFiles.forEach(f => {
    const src = path.join('build/esm-temp', f);
    const dest = path.join(BUILD_DIR, f);

    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  });

  // Pass 1: Rename all .js to .mjs
  renameAllJsToMjs(BUILD_DIR);

  // Pass 2: Fix imports (now all .mjs files exist)
  fixImports(BUILD_DIR);

  fs.rmSync('build/esm-temp', { recursive: true });

  console.log('✅ Renamed all .js to .mjs and fixed directory imports');
}

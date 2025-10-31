const fs = require('fs');
const path = require('path');

function renameJsToMjs(dir) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const fullPath = path.join(dir, file);

    if (fs.statSync(fullPath).isDirectory()) {
      renameJsToMjs(fullPath);
    } else if (file.endsWith('.js')) {
      const newPath = fullPath.replace(/\.js$/, '.mjs');
      fs.renameSync(fullPath, newPath);

      const content = fs.readFileSync(newPath, 'utf8');

      // Replace imports that already have .js extension
      let updated = content.replace(/from '(\.[^']+)\.js'/g, "from '$1.mjs'");

      // Add .mjs extension to relative imports without extension
      // Match: from './something' or from '../something' but not if it already ends with .mjs
      updated = updated.replace(/from '(\.[^'"]+)'/g, (match, p1) => {
        // Skip if already has .mjs extension
        if (p1.endsWith('.mjs')) return match;
        return `from '${p1}.mjs'`;
      });

      fs.writeFileSync(newPath, updated);
    }
  });
}

// Create build/esm directory
fs.mkdirSync('build/esm', { recursive: true });

// Process build output
if (fs.existsSync('build/esm-temp')) {
  const tempFiles = fs.readdirSync('build/esm-temp');

  tempFiles.forEach(f => {
    const src = path.join('build/esm-temp', f);
    const dest = path.join('build/esm', f);

    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  });

  renameJsToMjs('build/esm');
  fs.rmSync('build/esm-temp', { recursive: true });

  console.log('✅ Renamed all .js to .mjs and added .mjs extensions to imports');
}

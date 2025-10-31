#!/bin/bash

# Prepare build for PlayCanvas upload
# This script builds the TypeScript and copies required libraries

echo "🔨 Building TypeScript..."
npm run build:debug

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "📦 Copying libktx files to build directory..."
cp lib/libktx.mjs build/
cp lib/libktx.wasm build/

echo "✅ Build preparation complete!"
echo ""
echo "📁 Files ready in build/:"
ls -lh build/

echo ""
echo "🚀 Next steps:"
echo "  1. Upload files from build/ to PlayCanvas Assets"
echo "  2. Or run: npm run push (if playcanvas-sync is configured)"
echo ""

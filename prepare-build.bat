@echo off
REM Prepare build for PlayCanvas upload
REM This script builds the TypeScript and copies required libraries

echo 🔨 Building TypeScript...
call npm run build:debug

if errorlevel 1 (
    echo ❌ Build failed!
    exit /b 1
)

echo 📦 Copying libktx files to build directory...
copy lib\libktx.mjs build\
copy lib\libktx.wasm build\

echo ✅ Build preparation complete!
echo.
echo 📁 Files ready in build/:
dir build\

echo.
echo 🚀 Next steps:
echo   1. Upload files from build/ to PlayCanvas Assets
echo   2. Or run: npm run push (if playcanvas-sync is configured)
echo.

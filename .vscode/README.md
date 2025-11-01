# VS Code Configuration for PlayCanvas Project

This directory contains VS Code workspace configuration optimized for PlayCanvas development.

## Recommended Extensions

The following extensions are recommended and will be suggested when you open this workspace:

1. **ESLint** (`dbaeumer.vscode-eslint`) - JavaScript/TypeScript linting
2. **Prettier** (`esbenp.prettier-vscode`) - Code formatting
3. **Error Lens** (`usernamehw.errorlens`) - Inline error highlighting

## Settings

- **TypeScript**: Configured to use workspace TypeScript version
- **Auto-save**: Enabled on focus change (helpful for watch mode)
- **Format on save**: Disabled (use ESLint for auto-fixing)
- **File associations**: `.mjs` files treated as JavaScript for syntax highlighting

## Tasks

Use `Ctrl+Shift+B` (Windows/Linux) or `Cmd+Shift+B` (Mac) to access build tasks:

- **Build ESM** (default) - Compile TypeScript to ESM modules
- **Watch ESM** - Watch mode for development
- **Build and Push ESM** - Build and sync to PlayCanvas Editor
- **Clean Build** - Remove build directory and rebuild

## No Conflicts

This configuration is designed to work seamlessly with:

- PlayCanvas ESM scripts
- TypeScript compilation
- npm scripts from package.json
- playcanvas-sync

There should be no conflicts with PlayCanvas development workflow.

## Tips

1. Use `npm run watch:esm` in terminal for continuous compilation
2. Use `Ctrl+Shift+P` > "Tasks: Run Task" to access all npm scripts
3. TypeScript errors will be highlighted in editor and Problems panel
4. Save files to auto-fix ESLint issues (if ESLint is configured)

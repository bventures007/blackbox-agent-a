// Static landing build: copies src/ to dist/ and injects the release manifest path. No bundler, no backend dependency.
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true }); mkdirSync('dist', { recursive: true });
cpSync('src', 'dist', { recursive: true });
copyFileSync('../../reference/prototype/styles.css', 'dist/prototype.css');
if (existsSync('../../release/manifest.json')) copyFileSync('../../release/manifest.json', 'dist/release.json');
console.log('landing built');

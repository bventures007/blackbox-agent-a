import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: { outDir: 'dist', sourcemap: false, target: 'es2022' }, server: { proxy: { '/api': { target: 'http://127.0.0.1:19080', changeOrigin: false } } } });

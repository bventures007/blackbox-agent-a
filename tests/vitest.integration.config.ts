import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['integration/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false, reporters: ['default', ['json', { outputFile: 'evidence/tmp/vitest-integration.json' }]] } });

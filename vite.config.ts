// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts'],
      inline: ['@noble/hashes', '@noble/secp256k1']
    },
    test: {
      interopDefault: false
    },
    resolve: {
      mainFields: ['module', 'exports', 'main']
    }
  }
});

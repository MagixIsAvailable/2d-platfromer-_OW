// vite.config.js
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom', // Use jsdom for DOM-related tests
    exclude: [...configDefaults.exclude],
  },
});
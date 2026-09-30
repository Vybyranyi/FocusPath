/// <reference types="vitest" />

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  envDir: path.resolve(__dirname, '..'),
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        /**
         * Libraries in a chunk of their own, apart from the app's code.
         *
         * Everything shipped as one file, so every deploy — even a one-line
         * copy change — gave it a new hash and every returning visitor
         * downloaded the whole ~270 kB again. Libraries change only when a
         * dependency does; the year-long cache on /assets/ then keeps them.
         *
         * One chunk, not one per library. Splitting React from the libraries
         * built on it made the two chunks import each other, and the page
         * died on load with React half-initialised. The emoji table is only
         * data, so it can stand apart safely.
         */
        manualChunks(id) {
          if (id.includes("react-apple-emojis/src/data.json")) return "emoji";
          if (id.includes("node_modules/")) return "vendor";
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    // Pinned east of UTC on purpose. Under UTC a whole class of date bugs is
    // invisible by definition: local midnight and UTC midnight are the same
    // instant, so converting one to the other silently does nothing. At UTC+3
    // it moves the day, which is exactly what shipped to users.
    env: { TZ: 'Europe/Kyiv' },
    coverage: {
      provider: "v8",
      reporter: ["text"],
      exclude: [
        "src/main.tsx",
        "src/App.tsx",
        "src/store/hooks.ts",
        "src/store/store.ts",
        "src/vite-env.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/setupTests.ts",
        "src/testUtils.tsx",
        "vite.config.ts",
        "eslint.config.js",
      ],

    },
  },
  resolve: {
    alias: {
      '@':          path.resolve(__dirname, './src'),
      '@assets':    path.resolve(__dirname, './src/assets'),
      '@components':path.resolve(__dirname, './src/components'),
      '@pages':     path.resolve(__dirname, './src/pages'),
      '@store':     path.resolve(__dirname, './src/store'),
      '@hooks':     path.resolve(__dirname, './src/hooks'),
      '@animation': path.resolve(__dirname, './src/animation'),
      '@api':       path.resolve(__dirname, './src/api'),
      '@shared':    path.resolve(__dirname, '../shared/src'),
    },
  },
});
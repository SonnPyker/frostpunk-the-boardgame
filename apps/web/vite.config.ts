import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static build: base './' so the same bundle works on Vercel, a sub-path or file hosting.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    // The engine is a workspace package outside apps/web: allow reading the monorepo root.
    fs: { allow: ['../..'] },
  },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return 'three';
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});

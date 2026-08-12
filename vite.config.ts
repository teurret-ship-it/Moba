import { defineConfig } from 'vite';

// Budżet pobrania z sekcji 2 planu: ≤15 MB cel / 20 MB twardy limit.
// Cała grafika jest generowana proceduralnie, więc bundle to praktycznie
// tylko Three.js + kod gry.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});

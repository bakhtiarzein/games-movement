import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5182 }, build: { target: 'es2022', chunkSizeWarningLimit: 900 } });

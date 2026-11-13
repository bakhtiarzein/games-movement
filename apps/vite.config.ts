import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Satu server untuk semua game: halaman depan di "/" dan tiap game di "/sword/", "/tennis/", "/golf/", "/lab/".
 * Folder apps/ menjadi akar Vite (multi-page). Tiap game tetap bisa dijalankan sendiri lewat `npm run dev:<game>`.
 */
const root = fileURLToPath(new URL('.', import.meta.url));
const GAMES = ['sword', 'tennis', 'golf', 'lab'];

/** "/golf" -> "/golf/": mode multi-halaman memberi 404 untuk alamat tanpa garis miring penutup. */
function trailingSlash(): Plugin {
  const redirect = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const [path, query] = (req.url ?? '').split('?');
    if (GAMES.includes(path.replace(/^\//, ''))) {
      res.statusCode = 302;
      res.setHeader('Location', `${path}/${query ? '?' + query : ''}`);
      res.end();
      return;
    }
    next();
  };
  return {
    name: 'games-trailing-slash',
    configureServer(server) { server.middlewares.use(redirect); },
    configurePreviewServer(server) { server.middlewares.use(redirect); },
  };
}

export default defineConfig({
  root,
  base: './',               // aman untuk hosting di sub-folder (mis. GitHub Pages)
  appType: 'mpa',           // alamat yang tidak ada = 404 (bukan jatuh ke halaman depan)
  plugins: [trailingSlash()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    outDir: resolve(root, '../dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        hub: resolve(root, 'index.html'),
        sword: resolve(root, 'sword/index.html'),
        tennis: resolve(root, 'tennis/index.html'),
        golf: resolve(root, 'golf/index.html'),
        lab: resolve(root, 'lab/index.html'),
      },
    },
  },
});

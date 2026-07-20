import { defineConfig } from 'vite';
import { resolve, extname } from 'path';
import { readdirSync, copyFileSync, existsSync, statSync } from 'fs';

const root = resolve(__dirname);

/** Tutte le pagine HTML nella root (esclusi backup) */
function htmlPages() {
  const skip = new Set(['index-old.html']);
  const pages = {};

  for (const name of readdirSync(root)) {
    if (!name.endsWith('.html')) continue;
    if (skip.has(name)) continue;
    const key = name.replace(/\.html$/i, '');
    pages[key] = resolve(root, name);
  }

  return pages;
}

/**
 * Copia in dist i file statici che Vite non bundleizza
 * (script senza type=module, css già linkati, icone, ecc.)
 */
function copyStaticAssetsPlugin() {
  const exts = new Set([
    '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.json'
  ]);
  const skipNames = new Set([
    'package.json',
    'package-lock.json',
    'vite.config.js',
    'config.json', // non pubblicare secret nel frontend; resta risorsa Tauri
  ]);

  return {
    name: 'copy-static-assets',
    closeBundle() {
      const outDir = resolve(root, 'dist');
      if (!existsSync(outDir)) return;

      for (const name of readdirSync(root)) {
        if (skipNames.has(name)) continue;
        const ext = extname(name).toLowerCase();
        if (!exts.has(ext)) continue;

        const src = resolve(root, name);
        if (!statSync(src).isFile()) continue;

        const dest = resolve(outDir, name);
        // Non sovrascrivere chunk già generati da Vite con lo stesso nome
        // (raro: di solito i chunk sono in assets/)
        if (existsSync(dest) && ext === '.js' && name.includes('-')) {
          continue;
        }
        try {
          copyFileSync(src, dest);
        } catch (err) {
          console.warn(`Copia statica fallita ${name}:`, err.message);
        }
      }

      // Assicura che le HTML siano in root di dist (Vite le mette già lì)
      console.log('✓ Asset statici copiati in dist/');
    },
  };
}

export default defineConfig({
  // Percorsi relativi: obbligatori per l'app Tauri installata
  base: './',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // WebView2 moderni: serve per top-level await (oauth-callback)
    target: 'esnext',
    rollupOptions: {
      input: htmlPages(),
    },
  },
  plugins: [copyStaticAssetsPlugin()],
});

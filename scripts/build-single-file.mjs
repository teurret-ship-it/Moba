/**
 * Build do jednego samodzielnego pliku HTML.
 *
 * Po co: sekcja 19 pkt 7 planu — „Daj to 5 osobom". Do tego potrzebny jest
 * link, który otwiera się na cudzym telefonie bez instalacji, konta i bez
 * serwera. Jeden plik HTML bez zewnętrznych żądań spełnia to wprost, a przy
 * okazji jest formatem, który przyjmują portale web z sekcji 8.
 *
 * Cała grafika jest proceduralna, więc nie ma czego dołączać poza kodem —
 * wynik to praktycznie sam Three.js.
 *
 *   node scripts/build-single-file.mjs
 *
 * Powstają dwa pliki:
 *   dist-single/arena.html           pełny dokument — do wysłania / na portal
 *   dist-single/arena.artifact.html  sam fragment (title + style + treść +
 *                                    script), bo hosting Artifactów dokleja
 *                                    szkielet <!doctype>/<head>/<body> sam
 */

import { build } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-single');

await build({
  configFile: false,
  root,
  base: './',
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: false,
    // Wszystko do jednego chunku — inline'owany moduł nie ma jak rozwiązać
    // importów między plikami.
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});

let html = await readFile(join(outDir, 'index.html'), 'utf8');

// --- wstaw CSS w miejsce <link rel="stylesheet"> ---
const cssMatch = html.match(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
if (!cssMatch) throw new Error('Nie znalazłem <link rel="stylesheet"> w buildzie');
const css = await readFile(join(outDir, cssMatch[1].replace(/^\.?\//, '')), 'utf8');
// UWAGA: zamiennik podajemy funkcją, nie stringiem. String.replace ze stringiem
// interpretuje `$&`, `$'`, `` $` `` i `$1` — a zminifikowany kod je zawiera,
// więc wstrzyknąłby sobie w środek fragment dopasowania (razem z `</script>`).
html = html.replace(cssMatch[0], () => `<style>\n${css}\n</style>`);

// --- wstaw JS w miejsce <script type="module" src="..."> ---
const jsMatch = html.match(/<script[^>]+type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
if (!jsMatch) throw new Error('Nie znalazłem <script type="module"> w buildzie');
const js = await readFile(join(outDir, jsMatch[1].replace(/^\.?\//, '')), 'utf8');

// </script> w treści kodu zamknęłoby tag przedwcześnie.
const safeJs = js.replace(/<\/script>/gi, () => '<\\/script>');
html = html.replace(jsMatch[0], () => `<script type="module">\n${safeJs}\n</script>`);

// --- wstaw manifest i ikonę jako data: ---
// Pojedynczy plik musi działać otwarty z dowolnego miejsca, także z dysku,
// więc manifest nie może wskazywać na sąsiedni plik. Ikona wchodzi w manifest
// jako data:, a manifest w dokument — też jako data:.
//
// To jest wariant awaryjny, nie główny: instalacja z pojedynczego pliku
// działa nierówno między przeglądarkami. Ścieżką docelową dla playtestu
// jest wersja hostowana (dist-single/index.html + manifest.webmanifest),
// gdzie wszystko leży osobno i po HTTPS.
const iconSvg = await readFile(join(outDir, 'icon.svg'), 'utf8');
const iconUrl = `data:image/svg+xml;base64,${Buffer.from(iconSvg, 'utf8').toString('base64')}`;
const manifest = JSON.parse(await readFile(join(outDir, 'manifest.webmanifest'), 'utf8'));
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: iconUrl }));
const manifestUrl =
  'data:application/manifest+json;base64,' +
  Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64');

html = html.replace(/<link[^>]+rel="manifest"[^>]*>/, () => `<link rel="manifest" href="${manifestUrl}" />`);
html = html.replace(/<link[^>]+rel="apple-touch-icon"[^>]*>/, () => `<link rel="apple-touch-icon" href="${iconUrl}" />`);

await mkdir(outDir, { recursive: true });

// --- pełny dokument ---
const fullPath = join(outDir, 'arena.html');
await writeFile(fullPath, html, 'utf8');
report(fullPath, html);

// --- fragment pod Artifact ---
// Fragment składamy z kawałków, które już mamy (css, safeJs), zamiast
// parsować gotowy dokument. Powód: Vite przenosi wejściowy <script
// type="module"> do <head>, więc wycięcie samego <body> gubi całą grę.
// Nazwa, nie podpis: w galerii Artifactów tytuł jest identyfikatorem strony,
// więc bez doklejonego „— prototyp". Wyjaśnienie idzie do opisu publikacji.
const title = 'Arena';

const bodyStart = html.indexOf('>', html.indexOf('<body')) + 1;
const bodyEnd = html.lastIndexOf('</body>');
if (bodyStart <= 0 || bodyEnd <= bodyStart) throw new Error('Nie wydzieliłem <body>');

// Skrypt doklejamy sami na końcu, więc usuwamy ewentualny z treści,
// żeby nie znalazł się w wyniku dwa razy.
const body = html
  .slice(bodyStart, bodyEnd)
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .trim();

const artifact = [
  `<title>${title}</title>`,
  `<style>\n${css}\n</style>`,
  body,
  `<script type="module">\n${safeJs}\n</script>`,
  '',
].join('\n');
const artifactPath = join(outDir, 'arena.artifact.html');
await writeFile(artifactPath, artifact, 'utf8');
report(artifactPath, artifact);

function report(path, content) {
  const kb = Buffer.byteLength(content, 'utf8') / 1024;
  console.log(`${path}  ${kb.toFixed(0)} kB`);
  // Budżet pobrania z sekcji 4: cel 15 MB, twardy limit 20 MB.
  if (kb > 15 * 1024) {
    console.error('UWAGA: przekroczony cel 15 MB z sekcji 4 planu');
    process.exit(1);
  }
}

// Capa 3 — Valida el contraste de la paleta contra WCAG AA.
//
// Lee los tokens de assets/styles.css (bloques `body.dark` y `body.light`) y
// comprueba cada color de texto contra el fondo sobre el que se pinta.
// Uso: node execution/check_contrast.mjs [--strict]
//   --strict devuelve código 1 si algo falla (útil para no publicar regresiones).
//
// Umbrales WCAG: 4.5:1 texto normal, 3:1 texto grande (>=18.66px bold o 24px)
// y elementos no textuales (bordes, barras).
import fs from 'node:fs';

const css = fs.readFileSync('assets/styles.css', 'utf8');

function tokens(selector) {
  const m = new RegExp(`body\\.${selector}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`No se encontró body.${selector}`);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[k] = v;
  return out;
}

const srgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = hex => {
  const [r, g, b] = srgb(hex).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const LANGS = ['en', 'ru', 'fr', 'de', 'es', 'it', 'ko', 'ja', 'el', 'la', 'ot'];

// [token, fondo, umbral, para qué se usa]
const pruebas = t => [
  ['text', 'bg', 4.5, 'texto principal'],
  ['text-2', 'bg', 4.5, 'autores, descripciones'],
  ['text-2', 'bg-2', 4.5, 'texto sobre tarjeta'],
  ['text-3', 'bg', 4.5, 'subtítulos, contadores, cabeceras de tabla'],
  ['text-3', 'bg-2', 4.5, 'metadatos de tarjeta'],
  ['heading', 'bg', 4.5, 'títulos'],
  ['accent', 'bg', 4.5, 'acento sobre fondo'],
  ['accent', 'bg-2', 4.5, 'acento sobre tarjeta/botón'],
  ['accent', 'bg-3', 4.5, 'acento en botón activo'],
  ['accent-2', 'bg', 4.5, 'rangos 11-25, enlaces de pie'],
  ['rank-muted', 'bg', 4.5, 'número de ranking'],
  // Los bordes aquí son separadores decorativos, no el afford de un control:
  // el botón se distingue por su fondo y su texto. Por eso 2:1 (visible) y no
  // el 3:1 que WCAG 1.4.11 exige a componentes de interfaz.
  ['border', 'bg', 2, 'bordes (decorativos)'],
  ...LANGS.map(l => [`lang-${l}`, 'bg', 4.5, `etiqueta de idioma (${l})`]),
];

let fallos = 0;
for (const tema of ['dark', 'light']) {
  const t = tokens(tema);
  console.log(`\n=== ${tema.toUpperCase()} ===`);
  for (const [fg, bg, min, uso] of pruebas(t)) {
    if (!t[fg] || !t[bg]) { console.log(`  ?  falta token ${fg} o ${bg}`); continue; }
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) fallos++;
    const marca = ok ? '  ok ' : '  XX ';
    console.log(`${marca}${r.toFixed(2).padStart(5)}:1  (min ${min})  ${fg} sobre ${bg} — ${uso}`);
  }
}

console.log(fallos ? `\n${fallos} combinaciones por debajo del mínimo.` : '\nTodo pasa AA.');
if (fallos && process.argv.includes('--strict')) process.exit(1);

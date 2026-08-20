// Capa 3 — Extrae los arrays G y E del index.html original y los normaliza
// a la "super base de datos": data/books.json + data/lists/*.json
import fs from 'node:fs';

const html = fs.readFileSync('.tmp/original.html', 'utf8');

function grabArray(name) {
  const start = html.indexOf(`const ${name}=[`);
  if (start < 0) throw new Error(`No se encontró const ${name}`);
  const open = html.indexOf('[', start);
  let depth = 0, i = open;
  for (; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') { depth--; if (depth === 0) break; }
  }
  const src = html.slice(open, i + 1);
  return eval(src); // fuente confiable: archivo local propio
}

const G = grabArray('G'); // [rank, title, author, rating, lang]
const E = grabArray('E'); // [rank, title, author, rating, lang, readMins]
console.log(`Guardian: ${G.length} · Economist: ${E.length}`);

// --- Identidad canónica de un libro -------------------------------------
const norm = s => s.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const slug = s => norm(s).replace(/\s+/g, '-');

// El apellido discrimina homónimos sin depender de la grafía completa
const lastName = a => {
  const parts = norm(a).split(' ');
  return parts[parts.length - 1];
};

const bookId = (title, author) => `${slug(title)}--${slug(lastName(author))}`;

// --- Merge --------------------------------------------------------------
const books = new Map();

function upsert(rank, title, author, rating, lang) {
  const id = bookId(title, author);
  const prev = books.get(id);
  if (!prev) {
    books.set(id, { id, title, author, lang, rating, year: null, coverId: null });
    return id;
  }
  // Conserva el título más largo (suele ser el más completo: "Moby-Dick" vs "Moby Dick")
  if (title.length > prev.title.length) prev.title = title;
  if (author.length > prev.author.length) prev.author = author;
  if (prev.rating == null) prev.rating = rating;
  else if (rating != null && Math.abs(prev.rating - rating) > 0.001) {
    console.warn(`  ! rating distinto para ${id}: ${prev.rating} vs ${rating}`);
  }
  if (prev.lang !== lang) console.warn(`  ! idioma distinto para ${id}: ${prev.lang} vs ${lang}`);
  return id;
}

const guardian = G.map(([rank, title, author, rating, lang]) => ({
  rank, bookId: upsert(rank, title, author, rating, lang),
}));

const economist = E.map(([rank, title, author, rating, lang, readMins]) => ({
  rank, bookId: upsert(rank, title, author, rating, lang), readMins,
}));

const all = [...books.values()].sort((a, b) => a.id.localeCompare(b.id));
console.log(`Libros únicos: ${all.length}`);

const shared = guardian.filter(g => economist.some(e => e.bookId === g.bookId));
console.log(`En ambas listas: ${shared.length}`);

fs.writeFileSync('data/books.json', JSON.stringify(all, null, 0).replace(/},/g, '},\n') + '\n');

const write = (file, meta, entries) =>
  fs.writeFileSync(`data/lists/${file}`, JSON.stringify({ ...meta, entries }, null, 0)
    .replace(/},\{/g, '},\n{') + '\n');

write('guardian-2026.json', {
  id: 'guardian-2026',
  name: 'Las 100 mejores novelas',
  source: 'The Guardian',
  year: 2026,
  blurb: 'Votación de 172 escritores, críticos y académicos.',
  columns: ['rank', 'book', 'lang', 'rating'],
}, guardian);

write('economist-500.json', {
  id: 'economist-500',
  name: 'Las 500 novelas más recomendadas',
  source: 'The Economist',
  year: 2024,
  blurb: 'Agregado de las listas de recomendación más citadas.',
  columns: ['rank', 'book', 'lang', 'rating', 'readMins'],
}, economist);

fs.writeFileSync('data/lists.json', JSON.stringify(
  [{ id: 'guardian-2026', file: 'guardian-2026.json' },
   { id: 'economist-500', file: 'economist-500.json' }], null, 2) + '\n');

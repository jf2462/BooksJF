// Capa 3 — Portadas desde Open Library.
//
// SOLO portadas. El año lo maneja enrich_years.mjs y las correcciones a mano
// apply_overrides.mjs: si este script también tocara `year`, machacaría los
// años buenos con los de Open Library, que son de reediciones arbitrarias
// (devuelve 1800 o 1999 para Middlemarch, que es de 1871). Antes lo hacía, y
// era una bomba de tiempo para la próxima importación.
//
// Solo consulta los libros que no estén ya en el caché.
import fs from 'node:fs';

const CACHE = '.tmp/openlibrary-cache.json';
const UA = { 'User-Agent': 'BooksJF/1.0 (proyecto personal; contacto via GitHub)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const books = JSON.parse(fs.readFileSync('data/books.json', 'utf8'));
const guardar = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

// Open Library corta conexiones de vez en cuando (ECONNRESET, timeouts de
// conexión). Sin reintento se pierden libros al azar y quedan sin portada.
async function conReintento(url, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return res;
      ultimo = new Error(`OL ${res.status}`);
    } catch (e) { ultimo = e; }
    await sleep(1500 * (i + 1));
  }
  throw ultimo;
}

async function consultar(book) {
  const url = 'https://openlibrary.org/search.json?' + new URLSearchParams({
    title: book.title, author: book.author, fields: 'cover_i,key', limit: '3',
  });
  const res = await conReintento(url);
  const { docs = [] } = await res.json();
  cache[book.id] = {
    coverId: docs.find(d => d.cover_i)?.cover_i ?? null,
    olKey: docs[0]?.key ?? null,
  };
}

const pendientes = books.filter(b => !(b.id in cache));
console.log(`Por consultar: ${pendientes.length} de ${books.length}`);

let n = 0;
for (const book of pendientes) {
  try { await consultar(book); }
  catch (e) { console.error(`  ! ${book.id}: ${e.message}`); }
  if (++n % 25 === 0) { guardar(); console.error(`  ${n}/${pendientes.length}`); }
  await sleep(220);
}
guardar();

// El caché se aplica a todos los libros, no solo a los recién consultados
for (const book of books) {
  const hit = cache[book.id];
  if (!hit) continue;
  book.coverId = hit.coverId;
  book.olKey = hit.olKey;
}

fs.writeFileSync('data/books.json', JSON.stringify(books, null, 0).replace(/},/g, '},\n') + '\n');
console.log(`Con portada: ${books.filter(b => b.coverId).length}/${books.length}`);

// Capa 3 — Segunda vuelta solo para los libros que quedaron sin año.
//
// Por qué hace falta: los pasos A y B de enrich_years.mjs dependen de que el
// título y el nombre del autor coincidan LITERAL con el label de Wikidata, y
// eso falla seguido: Wikidata escribe apóstrofes tipográficos (Philosopher's
// Stone) y "J. K. Rowling" con espacios, mientras las listas traen ASCII y
// "J.K. Rowling". Aquí resolvemos el autor con el buscador (tolerante) y luego
// emparejamos el título por solape de palabras, que ignora puntuación.
import fs from 'node:fs';

const CACHE = '.tmp/wikidata-years.json';
const QID_CACHE = '.tmp/wikidata-autor-qid.json';
const UA = { 'User-Agent': 'BooksJF/1.0 (proyecto personal; contacto via GitHub)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};

const cache = load(CACHE);
const qidCache = load(QID_CACHE);
const books = JSON.parse(fs.readFileSync('data/books.json', 'utf8'));

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or']);
const norm = s => s.toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/ +/g, ' ').trim();
const words = s => norm(s).split(' ').filter(w => w && !STOP.has(w));
const parseYear = v => { const m = /^(-?\d+)-/.exec(v); return m ? parseInt(m[1], 10) : null; };
const earliest = ys => { const c = ys.filter(Number.isFinite); return c.length ? Math.min(...c) : null; };

async function apiFetch(url, intentos = 5) {
  for (let i = 0; i < intentos; i++) {
    const res = await fetch(url, { headers: UA });
    if (res.status !== 429) return res;
    const espera = (parseInt(res.headers.get('retry-after') || '20', 10) + 2) * 1000;
    console.error(`    429, esperando ${espera / 1000}s`);
    await sleep(espera);
  }
  throw new Error('429 persistente');
}

async function sparql(query) {
  const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), { headers: UA });
  if (!res.ok) throw new Error(`WDQS ${res.status}`);
  return (await res.json()).results.bindings;
}

async function autorQid(nombre) {
  if (nombre in qidCache) return qidCache[nombre];
  const url = 'https://www.wikidata.org/w/api.php?' + new URLSearchParams({
    action: 'wbsearchentities', search: nombre, language: 'en',
    type: 'item', limit: '5', format: 'json',
  });
  const res = await apiFetch(url);
  const hits = (await res.json()).search || [];
  const qid = hits[0]?.id ?? null;
  qidCache[nombre] = qid;
  fs.writeFileSync(QID_CACHE, JSON.stringify(qidCache));
  return qid;
}

function sameWork(target, label) {
  const cand = new Set(words(label));
  if (!cand.size || !target.size) return false;
  const inter = [...target].filter(w => cand.has(w)).length;
  if (inter === target.size || inter === cand.size) return true;
  return inter / Math.max(target.size, cand.size) >= 0.7;
}

const pendientes = books.filter(b => b.year == null);
console.log(`Pendientes: ${pendientes.length}\n`);

let recuperados = 0;
for (const book of pendientes) {
  if (book.author === '-') { console.log(`  · ${book.title}: sin autor, se omite`); continue; }
  try {
    const qid = await autorQid(book.author);
    if (!qid) { console.log(`  · ${book.title}: no se resolvió el autor`); continue; }
    const rows = await sparql(`SELECT ?label ?date WHERE {
      ?item wdt:P50|wdt:P170 wd:${qid} ; wdt:P577 ?date .
      FILTER(DATATYPE(?date) = xsd:dateTime)
      ?item rdfs:label|skos:altLabel ?label . FILTER(LANG(?label)="en")
    } LIMIT 500`);
    const target = new Set(words(book.title));
    const year = earliest(rows.filter(r => sameWork(target, r.label.value)).map(r => parseYear(r.date.value)));
    if (year != null) {
      book.year = year;
      cache[book.id] = { year, via: 'D' };
      recuperados++;
      console.log(`  ✓ ${book.title} — ${year}`);
    } else {
      console.log(`  · ${book.title}: el autor existe pero ninguna obra coincide`);
    }
  } catch (e) {
    console.error(`  ! ${book.id}: ${e.message}`);
  }
  await sleep(400);
}

fs.writeFileSync(CACHE, JSON.stringify(cache));
const sin = books.filter(b => b.year == null);
console.log(`\nRecuperados: ${recuperados} · Con año: ${books.length - sin.length}/${books.length} · Sin año: ${sin.length}`);
fs.writeFileSync('data/books.json', JSON.stringify(books, null, 0).replace(/},/g, '},\n') + '\n');
fs.writeFileSync('.tmp/sin-ano.json', JSON.stringify(sin.map(b => `${b.title} — ${b.author}`), null, 1));

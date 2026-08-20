// Capa 3 — Enriquece data/books.json con año de publicación (Wikidata) y
// portada (Open Library). Cachea en .tmp/ para que re-ejecutar sea gratis.
//
// Por qué dos fuentes: el first_publish_year de Open Library es ruidoso
// (devuelve el año de una reedición cualquiera: 1800 o 1999 para Middlemarch,
// que es de 1871). Wikidata P577 sí trae la fecha de publicación original.
// Open Library en cambio es la mejor fuente gratuita de portadas.
import fs from 'node:fs';

const ONLY = process.argv.includes('--sample') ? 12 : Infinity;
const UA = { 'User-Agent': 'BooksJF/1.0 (proyecto personal; contacto vía GitHub)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const loadCache = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
const wdCache = loadCache('.tmp/wikidata-cache.json');
const olCache = loadCache('.tmp/openlibrary-cache.json');
const saveCaches = () => {
  fs.writeFileSync('.tmp/wikidata-cache.json', JSON.stringify(wdCache));
  fs.writeFileSync('.tmp/openlibrary-cache.json', JSON.stringify(olCache));
};

const books = JSON.parse(fs.readFileSync('data/books.json', 'utf8'));

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const lastName = a => { const p = norm(a).trim().split(/\s+/); return p[p.length - 1]; };
const sparqlStr = s => JSON.stringify(s); // JSON y SPARQL comparten las escapes que necesitamos

async function wikidataYear(book) {
  if (book.id in wdCache) return wdCache[book.id];
  const q = `SELECT ?item ?date ?authorLabel WHERE {
    ?item rdfs:label|skos:altLabel ${sparqlStr(book.title)}@en .
    ?item wdt:P31/wdt:P279* wd:Q7725634 .
    OPTIONAL { ?item wdt:P577 ?date . }
    OPTIONAL { ?item wdt:P50/rdfs:label ?authorLabel . FILTER(LANG(?authorLabel)="en") }
  } LIMIT 30`;
  const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: UA });
  if (!res.ok) throw new Error(`WD ${res.status}`);
  const rows = (await res.json()).results.bindings
    .map(b => ({
      qid: b.item.value.split('/').pop(),
      year: b.date ? parseInt(b.date.value.slice(0, 4), 10) : null,
      author: b.authorLabel?.value ?? '',
    }))
    .filter(r => r.year);

  const ln = lastName(book.author);
  // Preferimos el candidato cuyo autor coincide; si ninguno coincide, no
  // adivinamos: un año equivocado es peor que un año vacío.
  const matched = rows.filter(r => norm(r.author).includes(ln));
  const pool = matched.length ? matched : [];
  const hit = pool.length
    ? { year: Math.min(...pool.map(r => r.year)), qid: pool[0].qid, confident: true }
    : (rows.length ? { year: Math.min(...rows.map(r => r.year)), qid: rows[0].qid, confident: false }
                   : { year: null, qid: null, confident: false });
  wdCache[book.id] = hit;
  return hit;
}

async function openLibraryCover(book) {
  if (book.id in olCache) return olCache[book.id];
  const url = 'https://openlibrary.org/search.json?' + new URLSearchParams({
    title: book.title, author: book.author, fields: 'cover_i,key', limit: '3',
  });
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`OL ${res.status}`);
  const { docs = [] } = await res.json();
  const hit = { coverId: docs.find(d => d.cover_i)?.cover_i ?? null, olKey: docs[0]?.key ?? null };
  olCache[book.id] = hit;
  return hit;
}

let n = 0, dudosos = [];
for (const book of books.slice(0, ONLY)) {
  try {
    const wd = await wikidataYear(book);
    book.year = wd.year;
    book.wikidata = wd.qid;
    if (wd.year && !wd.confident) dudosos.push(book.id);
  } catch (e) { console.error(`  ! WD ${book.id}: ${e.message}`); }
  try {
    const ol = await openLibraryCover(book);
    book.coverId = ol.coverId;
    book.olKey = ol.olKey;
  } catch (e) { console.error(`  ! OL ${book.id}: ${e.message}`); }
  if (++n % 25 === 0) { saveCaches(); console.log(`${n}/${Math.min(ONLY, books.length)}`); }
  await sleep(150);
}
saveCaches();

const scope = books.slice(0, ONLY);
console.log(`\nProcesados: ${scope.length}`);
console.log(`Sin año: ${scope.filter(b => !b.year).length} · Sin portada: ${scope.filter(b => !b.coverId).length}`);
console.log(`Año sin confirmar autor: ${dudosos.length}`);
if (ONLY === Infinity) {
  fs.writeFileSync('data/books.json', JSON.stringify(books, null, 0).replace(/},/g, '},\n') + '\n');
  fs.writeFileSync('.tmp/revisar-anos.json', JSON.stringify(dudosos, null, 1));
} else {
  console.table(scope.map(b => ({ titulo: b.title.slice(0, 30), autor: b.author.slice(0, 20), año: b.year, portada: !!b.coverId })));
}

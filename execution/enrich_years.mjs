// Capa 3 — Año de publicación original desde Wikidata (P577).
//
// APRENDIZAJES (no borrar, cuestan tiempo de re-descubrir):
//  1. Open Library NO sirve para el año: first_publish_year devuelve el año de
//     una reedición arbitraria (1800 y 1999 para Middlemarch, que es de 1871).
//  2. NO filtrar por `wdt:P31/wdt:P279* wd:Q7725634` ("obra literaria"): muchas
//     novelas (Jane Eyre, Light in August, Herzog...) están tipadas como
//     "obra escrita" Q47461344, que es la SUPERCLASE. Ese filtro tumbaba 108 de 514.
//  3. Wikidata devuelve algunas fechas como "valor desconocido" = nodo en blanco
//     (genid). Sin FILTER por datatype, esos valores producen NaN y envenenan el
//     Math.min, tumbando libros que sí traían el año bueno (A Passage to India).
//  4bis. NO mandar origin=* a la API de wikidata.org: convierte la petición en
//     anónima/CORS y dispara 429 en pocas decenas de llamadas.
//  4. Las fechas AEC vienen como "-0800-01-01": hay que parsear con regex, no con
//     slice(0,4), que corta el signo.
import fs from 'node:fs';

const CACHE = '.tmp/wikidata-years.json';
const AUTHOR_CACHE = '.tmp/wikidata-authors.json';
const UA = { 'User-Agent': 'BooksJF/1.0 (proyecto personal; contacto via GitHub)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};

const cache = load(CACHE);
const authorCache = load(AUTHOR_CACHE);
const save = () => {
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  fs.writeFileSync(AUTHOR_CACHE, JSON.stringify(authorCache));
};

const books = JSON.parse(fs.readFileSync('data/books.json', 'utf8'));

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or']);
const norm = s => s.toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/ +/g, ' ').trim();
const words = s => norm(s).split(' ').filter(w => w && !STOP.has(w));
const lastName = a => { const p = norm(a).split(' '); return p[p.length - 1]; };

// "-0800-01-01T..." -> -800 ; "1847-01-01T..." -> 1847 ; nodo en blanco -> null
const parseYear = v => { const m = /^(-?\d+)-/.exec(v); return m ? parseInt(m[1], 10) : null; };
const earliest = ys => { const c = ys.filter(Number.isFinite); return c.length ? Math.min(...c) : null; };

async function sparql(query) {
  const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), { headers: UA });
  if (!res.ok) throw new Error(`WDQS ${res.status}`);
  return (await res.json()).results.bindings;
}


// La API de acción de wikidata.org (a diferencia del endpoint SPARQL) tiene un
// límite global agresivo: responde 429 con Retry-After tras pocas decenas de
// llamadas seguidas. Respetamos la cabecera en vez de reintentar a ciegas.
async function apiFetch(url, intentos = 4) {
  for (let i = 0; i < intentos; i++) {
    const res = await fetch(url, { headers: UA });
    if (res.status !== 429) return res;
    const espera = (parseInt(res.headers.get('retry-after') || '20', 10) + 2) * 1000;
    console.error();
    await sleep(espera);
  }
  throw new Error('429 persistente');
}

const DATE_OK = 'FILTER(DATATYPE(?date) = xsd:dateTime)';

// Paso A — título exacto (label o altLabel) + autor coincidente
async function byTitle(book) {
  const rows = await sparql(`SELECT ?date ?creatorLabel WHERE {
    ?item rdfs:label|skos:altLabel ${JSON.stringify(book.title)}@en .
    ?item wdt:P577 ?date . ${DATE_OK}
    ?item wdt:P50|wdt:P170 ?creator . ?creator rdfs:label ?creatorLabel .
    FILTER(LANG(?creatorLabel)="en")
  } LIMIT 60`);
  const ln = lastName(book.author);
  return earliest(rows.filter(r => norm(r.creatorLabel.value).includes(ln))
                      .map(r => parseYear(r.date.value)));
}

// ¿El título de la lista y el de Wikidata son la misma obra?
// Aceptamos solape alto o que uno contenga al otro ("Orlando" ⊂ "Orlando: A Biography").
function sameWork(target, label) {
  const cand = new Set(words(label));
  if (!cand.size || !target.size) return false;
  const inter = [...target].filter(w => cand.has(w)).length;
  if (inter === target.size || inter === cand.size) return true;
  return inter / Math.max(target.size, cand.size) >= 0.7;
}

// Paso B — todas las obras del autor, emparejando el título de forma laxa
// (cubre variantes de traducción y subtítulos)
async function byAuthor(book) {
  const key = norm(book.author);
  if (!(key in authorCache)) {
    const rows = await sparql(`SELECT ?label ?date WHERE {
      ?author rdfs:label|skos:altLabel ${JSON.stringify(book.author)}@en .
      ?item wdt:P50|wdt:P170 ?author ; wdt:P577 ?date . ${DATE_OK}
      ?item rdfs:label|skos:altLabel ?label . FILTER(LANG(?label)="en")
    } LIMIT 500`);
    authorCache[key] = rows.map(r => [r.label.value, parseYear(r.date.value)]);
  }
  const target = new Set(words(book.title));
  return earliest(authorCache[key].filter(([l]) => sameWork(target, l)).map(([, y]) => y));
}

// Paso C — buscador de Wikidata (tolera títulos que no calzan literal),
// verificando después autor y fecha sobre los candidatos que devuelve
async function bySearch(book) {
  const url = 'https://www.wikidata.org/w/api.php?' + new URLSearchParams({
    action: 'wbsearchentities', search: `${book.title} ${book.author}`,
    language: 'en', uselang: 'en', type: 'item', limit: '10', format: 'json',
  });
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`search ${res.status}`);
  const ids = ((await res.json()).search || []).map(s => s.id);
  if (!ids.length) return null;
  const rows = await sparql(`SELECT ?date ?creatorLabel WHERE {
    VALUES ?item { ${ids.map(i => 'wd:' + i).join(' ')} }
    ?item wdt:P577 ?date . ${DATE_OK}
    ?item wdt:P50|wdt:P170 ?creator . ?creator rdfs:label ?creatorLabel .
    FILTER(LANG(?creatorLabel)="en")
  } LIMIT 60`);
  const ln = lastName(book.author);
  return earliest(rows.filter(r => norm(r.creatorLabel.value).includes(ln))
                      .map(r => parseYear(r.date.value)));
}

const PASSES = [['A', byTitle], ['B', byAuthor], ['C', bySearch]];

let n = 0; const stats = { A: 0, B: 0, C: 0 };
for (const book of books) {
  if (!(book.id in cache) || cache[book.id].year == null) {
    let year = null, via = null;
    for (const [name, fn] of PASSES) {
      try { year = await fn(book); } catch (e) { console.error(`  ! ${name} ${book.id}: ${e.message}`); }
      if (year != null) { via = name; break; }
      await sleep(120);
    }
    cache[book.id] = { year, via };
    await sleep(120);
  }
  const hit = cache[book.id];
  book.year = hit.year;
  if (hit.via) stats[hit.via]++;
  if (++n % 50 === 0) { save(); console.error(`${n}/${books.length}`); }
}
save();

const sin = books.filter(b => b.year == null);
console.log(`\nCon año: ${books.length - sin.length}/${books.length}  (A: ${stats.A} · B: ${stats.B} · C: ${stats.C})`);
console.log(`Sin año: ${sin.length}`);
fs.writeFileSync('data/books.json', JSON.stringify(books, null, 0).replace(/},/g, '},\n') + '\n');
fs.writeFileSync('.tmp/sin-ano.json', JSON.stringify(sin.map(b => `${b.title} — ${b.author}`), null, 1));

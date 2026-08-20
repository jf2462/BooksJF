// Capa 3 — Audita los años sospechosos de data/books.json.
//
// Wikidata a veces guarda en P577 la fecha de una reedición o traducción en vez
// de la publicación original (In Search of Lost Time salía como 2000, siendo de
// 1913). Este script no corrige nada: solo señala qué revisar a mano.
//
// Heurística: si un autor tiene varias obras en el conjunto y una se desvía
// mucho del resto, o si el año es posterior a la muerte del autor según
// Wikidata, algo huele mal.
import fs from 'node:fs';

const UA = { 'User-Agent': 'BooksJF/1.0 (proyecto personal; contacto via GitHub)' };
const CACHE = '.tmp/wikidata-muertes.json';
const muertes = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const books = JSON.parse(fs.readFileSync('data/books.json', 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1. Dispersión dentro de la obra de un mismo autor
const porAutor = {};
for (const b of books) {
  if (b.author === '-' || !b.year) continue;
  (porAutor[b.author] ||= []).push(b);
}

const sospechosos = [];
for (const [autor, obras] of Object.entries(porAutor)) {
  if (obras.length < 2) continue;
  const anios = obras.map(o => o.year).sort((a, b) => a - b);
  const mediana = anios[Math.floor(anios.length / 2)];
  for (const o of obras) {
    // 60 años de separación respecto a la mediana de su propia obra es
    // imposible salvo en autores muy longevos; conviene mirarlo.
    if (Math.abs(o.year - mediana) > 60) {
      sospechosos.push({ ...o, motivo: `se aparta ${o.year - mediana} años de la mediana de ${autor} (${mediana})` });
    }
  }
}

// 2. Año posterior a la muerte del autor
const autoresUnicos = [...new Set(books.filter(b => b.year && b.author !== '-').map(b => b.author))];
console.log(`Consultando fecha de muerte de ${autoresUnicos.length} autores...`);
let n = 0;
for (const autor of autoresUnicos) {
  if (!(autor in muertes)) {
    const q = `SELECT ?muerte WHERE {
      ?a rdfs:label|skos:altLabel ${JSON.stringify(autor)}@en ; wdt:P570 ?muerte .
      FILTER(DATATYPE(?muerte) = xsd:dateTime)
    } LIMIT 5`;
    try {
      const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: UA });
      const rows = res.ok ? (await res.json()).results.bindings : [];
      const anios = rows.map(r => parseInt(/^(-?\d+)-/.exec(r.muerte.value)?.[1], 10)).filter(Number.isFinite);
      muertes[autor] = anios.length ? Math.max(...anios) : null;
    } catch (e) { muertes[autor] = null; }
    await sleep(130);
    if (++n % 40 === 0) { fs.writeFileSync(CACHE, JSON.stringify(muertes)); console.error(`  ${n}/${autoresUnicos.length}`); }
  }
}
fs.writeFileSync(CACHE, JSON.stringify(muertes));

for (const b of books) {
  const m = muertes[b.author];
  // +2 años de margen: hay obras póstumas publicadas al año siguiente
  if (b.year && m && b.year > m + 2) {
    sospechosos.push({ ...b, motivo: `publicado en ${b.year} pero ${b.author} murió en ${m}` });
  }
}

const unicos = [...new Map(sospechosos.map(s => [s.id, s])).values()]
  .sort((a, b) => a.author.localeCompare(b.author));

console.log(`\n${unicos.length} años sospechosos:\n`);
unicos.forEach(s => console.log(`  ${s.title} — ${s.author}: ${s.motivo}`));
fs.writeFileSync('.tmp/anos-sospechosos.json', JSON.stringify(unicos.map(s => ({ id: s.id, title: s.title, author: s.author, year: s.year, motivo: s.motivo })), null, 1));

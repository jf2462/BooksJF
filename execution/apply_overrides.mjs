// Capa 3 — Aplica data/year-overrides.json sobre data/books.json.
//
// Se ejecuta DESPUÉS de enrich_years.mjs: las correcciones a mano ganan siempre
// sobre lo que devuelva Wikidata. Es idempotente, se puede correr las veces que sea.
import fs from 'node:fs';

const books = JSON.parse(fs.readFileSync('data/books.json', 'utf8'));
const overrides = JSON.parse(fs.readFileSync('data/year-overrides.json', 'utf8'));

const porTitulo = new Map(books.map(b => [b.title, b]));
let aplicados = 0;
const noEncontrados = [];

for (const [titulo, o] of Object.entries(overrides)) {
  if (titulo.startsWith('_')) continue; // claves de documentación
  const b = porTitulo.get(titulo);
  if (!b) { noEncontrados.push(titulo); continue; }
  b.year = o.year;
  if (o.aprox) b.yearAprox = true; else delete b.yearAprox;
  aplicados++;
}

fs.writeFileSync('data/books.json', JSON.stringify(books, null, 0).replace(/},/g, '},\n') + '\n');

console.log(`Correcciones aplicadas: ${aplicados}`);
if (noEncontrados.length) {
  console.log(`\nNo se encontró estos títulos (¿cambió el título en la lista?):`);
  noEncontrados.forEach(t => console.log('  ' + t));
}
const sinAnio = books.filter(b => b.year == null).length;
console.log(`Libros sin año: ${sinAnio}/${books.length}`);

// Capa 3 — Consolida en los datos los duplicados declarados en book-aliases.json.
//
// Los importadores consultan los alias ANTES de dar de alta un libro, pero eso
// no arregla los duplicados que ya se colaron. Este script sí: funde el libro
// duplicado en el canónico (rellenando los campos vacíos con los del duplicado)
// y reescribe las referencias en todas las listas.
//
// Es idempotente: correrlo dos veces no cambia nada la segunda vez.
import fs from 'node:fs';

const alias = JSON.parse(fs.readFileSync('data/book-aliases.json', 'utf8'));
const books = JSON.parse(fs.readFileSync('data/books.json', 'utf8'));
const idx = JSON.parse(fs.readFileSync('data/lists.json', 'utf8'));

const pares = Object.entries(alias).filter(([k]) => !k.startsWith('_'));
const porId = new Map(books.map(b => [b.id, b]));

let fundidos = 0;
const eliminar = new Set();

for (const [duplicado, canonicoId] of pares) {
  const dup = porId.get(duplicado);
  const can = porId.get(canonicoId);
  if (!dup) continue;              // ya estaba consolidado
  if (!can) { console.warn(`  ! ${duplicado} apunta a ${canonicoId}, que no existe`); continue; }

  // El canónico manda; del duplicado solo tomamos lo que al canónico le falte.
  for (const campo of ['year', 'yearAprox', 'coverId', 'olKey', 'rating', 'country']) {
    if ((can[campo] === undefined || can[campo] === null) && dup[campo] != null) {
      can[campo] = dup[campo];
    }
  }
  eliminar.add(duplicado);
  fundidos++;
  console.log(`  ${duplicado}  ->  ${canonicoId}`);
}

if (!fundidos) { console.log('Nada que consolidar.'); process.exit(0); }

const restantes = books.filter(b => !eliminar.has(b.id));
fs.writeFileSync('data/books.json',
  JSON.stringify(restantes, null, 0).replace(/},/g, '},\n') + '\n');

let referencias = 0;
for (const { file } of idx) {
  const ruta = `data/lists/${file}`;
  const lista = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const vistos = new Set();
  const entries = [];
  for (const e of lista.entries) {
    const destino = alias[e.bookId] || e.bookId;
    if (destino !== e.bookId) referencias++;
    // Si la fusión deja el mismo libro dos veces en una lista, gana el mejor puesto
    if (vistos.has(destino)) {
      const previa = entries.find(x => x.bookId === destino);
      if (e.rank < previa.rank) previa.rank = e.rank;
      console.warn(`  ! ${file}: ${destino} estaba dos veces; se conserva el puesto ${previa.rank}`);
      continue;
    }
    vistos.add(destino);
    entries.push({ ...e, bookId: destino });
  }
  lista.entries = entries;
  fs.writeFileSync(ruta, JSON.stringify(lista, null, 0).replace(/},\{/g, '},\n{') + '\n');
}

console.log(`\nLibros fundidos: ${fundidos} · referencias reescritas: ${referencias}`);
console.log(`Base: ${restantes.length} libros`);

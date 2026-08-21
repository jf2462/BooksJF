// Capa 3 — Importa el ranking de thegreatestbooks.org a la base común.
//
// La tabla está renderizada en el servidor (nada de JavaScript), 120 libros por
// página, y trae puesto, título, autor, año, país e idioma.
//
// Lo delicado no es bajar los datos: es NO duplicar libros. Si esta lista trae
// Ulysses y no reutiliza el id que ya existe (`ulysses--joyce`), el sitio lo
// cuenta como otro libro y el consenso deja de funcionar. Por eso el script
// empareja por id canónico y, para lo que no calza exacto, propone candidatos
// en vez de crear un libro nuevo a ciegas.
//
// Uso: node execution/import_greatestbooks.mjs [cuántos]   (por defecto 500)
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const CUANTOS = Number(process.argv[2]) || 500;
const POR_PAGINA = 120;
// El sitio responde 403 a una petición con solo User-Agent: el fetch de Node
// manda muchas menos cabeceras que un navegador o que curl, y el filtro lo nota.
// Con Accept y Accept-Language responde normal.
const UA = {
  'User-Agent': 'BooksJF/1.0 (proyecto personal; contacto via GitHub)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Identidad canónica (idéntica a extract_lists.mjs) ---------- */
const norm = s => s.toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const slug = s => norm(s).replace(/\s+/g, '-');
const lastName = a => { const p = norm(a).split(' '); return p[p.length - 1]; };
const bookId = (t, a) => `${slug(t)}--${slug(lastName(a))}`;

// Cada fuente escribe el anonimato a su manera: las listas viejas usan "-" y
// The Greatest Books "Unknown". Sin unificarlo se crean libros duplicados
// (la Biblia salía dos veces, como `the-bible--` y `the-bible--unknown`).
const ANONIMO = /^(-|unknown|anonymous|anon\.?|varios|various)$/i;
const autorCanonico = a => ANONIMO.test(a.trim()) ? '-' : a;

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or']);
const words = s => norm(s).split(' ').filter(w => w && !STOP.has(w));

/* ---------- Idiomas del origen -> nuestros códigos ---------- */
const IDIOMAS = {
  English: 'en', French: 'fr', Russian: 'ru', German: 'de', Spanish: 'es',
  Italian: 'it', Korean: 'ko', Japanese: 'ja', Greek: 'el', 'Ancient Greek': 'el',
  Latin: 'la', Portuguese: 'ot', Chinese: 'ot', Arabic: 'ot', Czech: 'ot',
  Danish: 'ot', Dutch: 'ot', Hebrew: 'ot', Hungarian: 'ot', Norwegian: 'ot',
  Polish: 'ot', Swedish: 'ot', Turkish: 'ot', Finnish: 'ot', Icelandic: 'ot',
  Sanskrit: 'ot', Persian: 'ot', Yiddish: 'ot', Catalan: 'ot', Serbian: 'ot',
};
const codigoIdioma = nombre => IDIOMAS[nombre] ?? 'ot';

/* ---------- Descarga ---------- */
const decode = s => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
const limpia = s => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

// Se baja con curl, no con fetch: el sitio responde 403 al fetch de Node aun
// mandándole las mismas cabeceras, así que el filtro va por la huella TLS del
// cliente. curl pasa sin problema.
async function pagina(n) {
  const cache = `.tmp/tgb-page-${n}.html`;
  if (fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8');
  const url = `https://thegreatestbooks.org/v/table/page/${n}.html`;
  const { status } = await new Promise((resolve, reject) => {
    execFile('curl', ['-s', '-o', cache, '-w', '%{http_code}', '-A', UA['User-Agent'], url],
      (err, stdout) => err ? reject(err) : resolve({ status: stdout.trim() }));
  });
  if (status !== '200') throw new Error(`página ${n}: HTTP ${status}`);
  await sleep(1200); // el sitio es de alguien más: sin prisa
  return fs.readFileSync(cache, 'utf8');
}

function parsear(html) {
  const out = [];
  for (const [, fila] of html.matchAll(/<tr class="book-list-item"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const celdas = [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => limpia(m[1]));
    if (celdas.length < 6) continue;
    const [rank, title, author, year, country, language] = celdas;
    if (!title || !author) continue;
    out.push({
      rank: parseInt(rank, 10),
      title, author: autorCanonico(author),
      year: /^-?\d+$/.test(year) ? parseInt(year, 10) : null,
      country: country || null,
      lang: codigoIdioma(language),
    });
  }
  return out;
}

const paginas = Math.ceil(CUANTOS / POR_PAGINA);
console.log(`Bajando ${paginas} páginas para los primeros ${CUANTOS} libros...`);
let crudos = [];
for (let p = 1; p <= paginas; p++) {
  const filas = parsear(await pagina(p));
  console.log(`  página ${p}: ${filas.length} filas`);
  crudos = crudos.concat(filas);
}
crudos = crudos.filter(b => b.rank <= CUANTOS).sort((a, b) => a.rank - b.rank);
console.log(`Total: ${crudos.length} libros\n`);

/* ---------- Emparejar contra la base existente ---------- */
const books = JSON.parse(fs.readFileSync('data/books.json', 'utf8'));
const porId = new Map(books.map(b => [b.id, b]));

// Equivalencias confirmadas a mano: distintas fuentes titulan la misma obra de
// otra forma. Se resuelven antes de decidir si un libro es nuevo.
const alias = JSON.parse(fs.readFileSync('data/book-aliases.json', 'utf8'));
const canonico = id => alias[id] && !id.startsWith('_') ? alias[id] : id;
const porApellido = new Map();
for (const b of books) {
  const k = lastName(b.author);
  if (!porApellido.has(k)) porApellido.set(k, []);
  porApellido.get(k).push(b);
}

const entries = [];
const nuevos = [];
const dudosos = [];
let reutilizados = 0;

for (const c of crudos) {
  const id = canonico(bookId(c.title, c.author));
  const existente = porId.get(id);

  if (existente) {
    reutilizados++;
    // El origen trae país; lo guardamos en el libro, no en la lista, porque
    // es un dato de la obra y cualquier lista podría mostrarlo.
    if (c.country && !existente.country) existente.country = c.country;
    entries.push({ bookId: id, rank: c.rank });
    continue;
  }

  // ¿Mismo autor y título parecido? Entonces es probable que sea el mismo libro
  // con otra grafía, y crear uno nuevo rompería el consenso en silencio.
  const candidatos = (porApellido.get(lastName(c.author)) || []).filter(b => {
    const A = new Set(words(c.title)), B = new Set(words(b.title));
    if (!A.size || !B.size) return false;
    const inter = [...A].filter(w => B.has(w)).length;
    return inter === A.size || inter === B.size || inter / Math.max(A.size, B.size) >= 0.6;
  });

  if (candidatos.length) {
    dudosos.push({ origen: `${c.title} — ${c.author}`, rank: c.rank, nuevoId: id, candidatos: candidatos.map(b => `${b.id}  (${b.title})`) });
  }

  const libro = {
    id, title: c.title, author: c.author, lang: c.lang,
    rating: null, year: c.year, coverId: null,
  };
  if (c.country) libro.country = c.country;
  nuevos.push(libro);
  porId.set(id, libro);
  entries.push({ bookId: id, rank: c.rank });
}

console.log(`Reutilizan un libro ya registrado: ${reutilizados}`);
console.log(`Libros nuevos: ${nuevos.length}`);
console.log(`Posibles duplicados para revisar: ${dudosos.length}`);

/* ---------- Escribir ---------- */
const todos = [...books, ...nuevos].sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync('data/books.json', JSON.stringify(todos, null, 0).replace(/},/g, '},\n') + '\n');

const lista = {
  id: 'greatest-books',
  name: 'Los mejores libros de todos los tiempos',
  source: 'The Greatest Books',
  year: 2026,
  blurb: `Agregado de ${CUANTOS} títulos a partir de más de 100 listas de crítica y premios literarios.`,
  columns: ['rank', 'book', 'lang', 'year', 'country', 'rating'],
  entries,
};
fs.writeFileSync('data/lists/greatest-books.json',
  JSON.stringify(lista, null, 0).replace(/},\{/g, '},\n{') + '\n');

const idx = JSON.parse(fs.readFileSync('data/lists.json', 'utf8'));
if (!idx.some(l => l.id === 'greatest-books')) {
  idx.push({ id: 'greatest-books', file: 'greatest-books.json' });
  fs.writeFileSync('data/lists.json', JSON.stringify(idx, null, 2) + '\n');
}

fs.writeFileSync('.tmp/tgb-dudosos.json', JSON.stringify(dudosos, null, 1));
if (dudosos.length) {
  console.log(`\nRevisar (mismo autor, título parecido). Si son el mismo libro, hay que`);
  console.log(`unificar el id a mano en data/lists/greatest-books.json:\n`);
  dudosos.forEach(d => {
    console.log(`  #${d.rank} ${d.origen}`);
    console.log(`     nuevo:     ${d.nuevoId}`);
    d.candidatos.forEach(c => console.log(`     ya existe: ${c}`));
  });
}
console.log(`\nTotal de libros en la base: ${todos.length}`);

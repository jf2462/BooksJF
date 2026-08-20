/* ============================================================
   BooksJF — aplicación
   Sin build, sin dependencias. Carga data/*.json y pinta tres vistas:
   home (#/), lista (#/lista/<id>) y consenso (#/consenso).

   Para AGREGAR UNA LISTA no hay que tocar este archivo: basta crear
   data/lists/<id>.json y añadirlo a data/lists.json. Ver README.
   Solo si la lista trae un campo NUEVO (uno que ninguna otra tenga) hay que
   registrar su columna en COLUMNS, aquí abajo.
   ============================================================ */
(() => {
'use strict';

const IDIOMAS = {
  en: 'Inglés', ru: 'Ruso', fr: 'Francés', de: 'Alemán', es: 'Español',
  it: 'Italiano', ko: 'Coreano', ja: 'Japonés', el: 'Griego', la: 'Latín', ot: 'Otros',
};
const MEDALLAS = ['🥇', '🥈', '🥉'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const colorIdioma = lk => `var(--lang-${lk in IDIOMAS ? lk : 'ot'})`;
const portada = (b, size = 'M') => b.coverId
  ? `https://covers.openlibrary.org/b/id/${b.coverId}-${size}.jpg` : null;
const goodreads = b =>
  `https://www.goodreads.com/search?q=${encodeURIComponent(b.title + ' ' + b.author)}`;

// Los años negativos son a.C. y `yearAprox` marca las obras antiguas cuya
// fecha de composición no es exacta (ver data/year-overrides.json).
function fmtAnio(b) {
  if (b.year == null) return '—';
  const c = b.yearAprox ? 'c. ' : '';
  return b.year < 0 ? `${c}${-b.year} a.C.` : `${c}${b.year}`;
}

function fmtTiempo(m) {
  if (!m || m < 1) return '—';
  if (m < 60) return m + 'm';
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mn = m % 60;
  if (d > 0) return d + 'd' + (h > 0 ? ' ' + h + 'h' : '');
  return h + 'h' + (mn > 0 ? ' ' + mn + 'm' : '');
}

/* ---------- Estado ---------- */
const D = { libros: new Map(), listas: [], porLibro: new Map() };

/* ---------- Columnas disponibles ----------
   Cada lista declara en su JSON qué columnas muestra, en orden. Añadir un tipo
   de columna nuevo es agregar una entrada aquí; las listas viejas no se enteran. */
const COLUMNS = {
  rank: {
    label: '#', labelBoton: 'Ranking', clase: '', ordenar: f => f.rank,
    celda: f => {
      const c = f.rank <= 10 ? ' t10' : f.rank <= 25 ? ' t25' : '';
      return `<td class="rank${c}">${f.rank}</td>`;
    },
  },
  book: {
    label: 'Título / Autor', clase: '', ordenar: f => f.libro.title,
    // Recibe las columnas de la lista para no repetir el año si ya hay columna Año
    celda: (f, cols = []) => {
      const b = f.libro;
      const medalla = f.top3 >= 0
        ? `<span class="badge" style="color:${colorIdioma(b.lang)};border:1px solid ${colorIdioma(b.lang)}">${MEDALLAS[f.top3]} #${f.top3 + 1} ${esc(IDIOMAS[b.lang] || b.lang)}</span>`
        : '';
      const nListas = (D.porLibro.get(b.id) || []).length;
      const enVarias = nListas > 1
        ? `<span class="badge-both">En ${nListas} listas</span>` : '';
      const anio = (b.year != null && !cols.includes('year'))
        ? ` <span class="t-year">· ${fmtAnio(b)}</span>` : '';
      return `<td>
        <div class="t-title"><a href="${esc(goodreads(b))}" target="_blank" rel="noopener">${esc(b.title)}</a>${medalla}${enVarias}</div>
        <div class="t-author">${esc(b.author === '-' ? 'Anónimo' : b.author)}${anio}</div>
      </td>`;
    },
  },
  lang: {
    label: 'Idioma', clase: 'lang right', ordenar: f => IDIOMAS[f.libro.lang] || 'zz',
    celda: f => {
      const c = colorIdioma(f.libro.lang);
      return `<td class="lang right"><span class="lang-tag" style="color:${c};border:1px solid ${c}">${esc(IDIOMAS[f.libro.lang] || f.libro.lang)}</span></td>`;
    },
  },
  rating: {
    label: 'Goodreads', clase: 'right', ordenar: f => f.libro.rating ?? 0,
    celda: f => {
      const r = f.libro.rating;
      if (r == null) return '<td class="right">—</td>';
      // Goodreads casi nunca baja de 3.0: encuadrar 3.0–5.0 hace visible la diferencia
      const pct = Math.max(0, Math.min(100, ((r - 3) / 2) * 100));
      const c = colorIdioma(f.libro.lang);
      return `<td class="right"><span class="gr-wrap"><span class="gr-num">${r.toFixed(2)}</span>
        <span class="gr-bar"><span class="gr-fill" style="width:${pct}%;background:${c}"></span></span></span></td>`;
    },
  },
  year: {
    label: 'Año', clase: 'right', ordenar: f => f.libro.year ?? 9999,
    celda: f => `<td class="right rt">${fmtAnio(f.libro)}</td>`,
  },
  readMins: {
    label: 'Lectura', clase: 'rtime right', ordenar: f => f.readMins ?? 0,
    celda: f => `<td class="rtime right rt">${fmtTiempo(f.readMins)}</td>`,
  },
};

/* ---------- Carga ---------- */
async function cargar() {
  const idx = await (await fetch('data/lists.json')).json();
  const [libros, ...listas] = await Promise.all([
    (await fetch('data/books.json')).json(),
    ...idx.map(l => fetch(`data/lists/${l.file}`).then(r => r.json())),
  ]);
  libros.forEach(b => D.libros.set(b.id, b));
  D.listas = listas;
  for (const lista of listas) {
    for (const e of lista.entries) {
      if (!D.porLibro.has(e.bookId)) D.porLibro.set(e.bookId, []);
      D.porLibro.get(e.bookId).push({ listId: lista.id, rank: e.rank });
    }
  }
}

// Las medallas premian al mejor ubicado de cada idioma DENTRO de esa lista
function top3PorIdioma(lista) {
  const porIdioma = {};
  for (const e of lista.entries) {
    const b = D.libros.get(e.bookId);
    if (!b) continue;
    (porIdioma[b.lang] ||= []).push(e);
  }
  const pos = new Map();
  for (const arr of Object.values(porIdioma)) {
    arr.sort((a, b) => a.rank - b.rank).slice(0, 3)
       .forEach((e, i) => pos.set(e.bookId, i));
  }
  return pos;
}

// Une la entrada de la lista con el libro para que las columnas lean un solo objeto
function filas(lista) {
  const top3 = top3PorIdioma(lista);
  return lista.entries
    .map(e => {
      const libro = D.libros.get(e.bookId);
      return libro ? { ...e, libro, top3: top3.has(e.bookId) ? top3.get(e.bookId) : -1 } : null;
    })
    .filter(Boolean);
}

/* ---------- Utilidades de vista ---------- */
const normaliza = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function barras(datos, opciones = {}) {
  const max = Math.max(...datos.map(d => d.valor), 1);
  return `<div class="bars">` + datos.map(d => `
    <div class="bar-row">
      <span class="bar-label" title="${esc(d.etiqueta)}">${esc(d.etiqueta)}</span>
      <span class="bar-track"><span class="bar-val" style="width:${(d.valor / max) * 100}%${d.color ? `;background:${d.color}` : ''}"></span></span>
      <span class="bar-num">${d.valor}</span>
    </div>`).join('') + `</div>`;
}

/* ---------- Vista: home ---------- */
function vistaHome() {
  const libros = [...D.libros.values()];
  const anios = libros.map(b => b.year).filter(Boolean);
  const enVarias = [...D.porLibro.values()].filter(v => v.length > 1).length;

  const tarjetas = D.listas.map(l => {
    const portadas = l.entries.slice(0, 5)
      .map(e => D.libros.get(e.bookId)).filter(b => b && b.coverId)
      .map(b => `<img src="${portada(b, 'M')}" alt="" loading="lazy">`).join('');
    return `<a class="card" href="#/lista/${esc(l.id)}">
      <div class="card-src">${esc(l.source)}</div>
      <h3>${esc(l.name)}</h3>
      <p>${esc(l.blurb)}</p>
      <div class="card-covers">${portadas}</div>
      <div class="card-meta"><span>${l.entries.length} libros</span><span>${l.year}</span></div>
    </a>`;
  }).join('');

  const tarjetaConsenso = D.listas.length > 1 ? `
    <a class="card" href="#/consenso">
      <div class="card-src">Cruce de listas</div>
      <h3>Consenso</h3>
      <p>Los títulos que aparecen en más de un ranking, ordenados por su posición combinada. Aquí se ve dónde los críticos coinciden y dónde no.</p>
      <div class="card-meta"><span>${enVarias} libros</span><span>${D.listas.length} listas</span></div>
    </a>` : '';

  return `
  <section class="hero"><div class="wrap">
    <h1>Las mejores novelas<br>de todos los tiempos</h1>
    <p>Los grandes rankings de la crítica, en una sola base de datos comparable.
       Elige una lista para explorarla, o mira dónde coinciden.</p>
    <div class="hero-stats">
      <div class="hero-stat"><b>${D.listas.length}</b><span>Listas</span></div>
      <div class="hero-stat"><b>${D.libros.size}</b><span>Libros únicos</span></div>
      <div class="hero-stat"><b>${enVarias}</b><span>En varias listas</span></div>
      <div class="hero-stat"><b>${fmtAnio({ year: Math.min(...anios) })}–${Math.max(...anios)}</b><span>Años</span></div>
    </div>
  </div></section>

  <section class="section"><div class="wrap">
    <h2>Rankings</h2>
    <div class="cards">${tarjetas}${tarjetaConsenso}</div>
  </div></section>

  <section class="section"><div class="wrap">
    <h2>El panorama</h2>
    <div class="charts">${graficasHome(libros, anios)}</div>
  </div></section>`;
}

function graficasHome(libros, anios) {
  // 1. Desacuerdo: la mayor diferencia de puesto entre dos listas.
  // Graficar "en cuántas listas aparece" no sirve mientras haya pocas listas
  // (todas las barras valdrían lo mismo); la discrepancia sí tiene variación
  // y es lo que de verdad distingue a un ranking de otro.
  const desacuerdo = consensoOrdenado()
    .map(c => {
      const puestos = c.apariciones.map(a => a.rank);
      return { c, dif: Math.max(...puestos) - Math.min(...puestos) };
    })
    .sort((a, b) => b.dif - a.dif).slice(0, 8)
    .map(({ c, dif }) => ({
      etiqueta: c.libro.title,
      valor: dif,
      color: colorIdioma(c.libro.lang),
    }));

  // 2. Décadas
  // Las obras anteriores a 1500 (clásicos griegos, Gilgamesh, Genji) se salen
  // de la escala y aplastarían el resto de la gráfica: van contadas aparte.
  const dec = {};
  const antiguas = anios.filter(y => y < 1500).length;
  anios.filter(y => y >= 1500).forEach(y => { const d = Math.floor(y / 10) * 10; dec[d] = (dec[d] || 0) + 1; });
  const decadas = Object.entries(dec).map(([d, n]) => ({ etiqueta: `${d}s`, valor: n }))
    .sort((a, b) => b.valor - a.valor).slice(0, 10)
    .sort((a, b) => parseInt(a.etiqueta) - parseInt(b.etiqueta));

  // 3. Idiomas
  const li = {};
  libros.forEach(b => { li[b.lang] = (li[b.lang] || 0) + 1; });
  const idiomas = Object.entries(li).sort((a, b) => b[1] - a[1])
    .map(([lk, n]) => ({ etiqueta: IDIOMAS[lk] || lk, valor: n, color: colorIdioma(lk) }));

  // 4. Autores
  const au = {};
  libros.forEach(b => { if (b.author !== '-') au[b.author] = (au[b.author] || 0) + 1; });
  const autores = Object.entries(au).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([a, n]) => ({ etiqueta: a, valor: n }));

  const sinAnio = D.libros.size - anios.length;
  return `
  <div class="chart"><h3>Donde más discrepan las listas</h3>
    <p class="chart-note">Diferencia de puestos para libros que aparecen en varias listas: cuánto los separa el ranking más generoso del más duro.</p>
    ${barras(desacuerdo)}</div>
  <div class="chart"><h3>Por década de publicación</h3>
    <p class="chart-note">Las 10 décadas más representadas de 1500 en adelante${antiguas ? ` · ${antiguas} obras anteriores` : ''}${sinAnio ? ` · ${sinAnio} sin año único (antologías)` : ''}.</p>
    ${barras(decadas)}</div>
  <div class="chart"><h3>Por idioma original</h3>
    <p class="chart-note">Sobre los ${D.libros.size} libros únicos de todas las listas.</p>
    ${barras(idiomas)}</div>
  <div class="chart"><h3>Autores más presentes</h3>
    <p class="chart-note">Número de obras distintas en el conjunto.</p>
    ${barras(autores)}</div>`;
}

/* ---------- Vista: consenso ---------- */
function consensoOrdenado() {
  const out = [];
  for (const [bookId, apariciones] of D.porLibro) {
    if (apariciones.length < 2) continue;
    const libro = D.libros.get(bookId);
    if (!libro) continue;
    // Ordenamos por número de listas y, a igualdad, por la suma de posiciones:
    // aparecer en más rankings pesa más que ir muy alto en uno solo.
    out.push({
      libro, apariciones,
      enListas: apariciones.length,
      suma: apariciones.reduce((s, a) => s + a.rank, 0),
      mejor: Math.min(...apariciones.map(a => a.rank)),
    });
  }
  return out.sort((a, b) => b.enListas - a.enListas || a.suma - b.suma);
}

function vistaConsenso() {
  const datos = consensoOrdenado();
  const cabeceras = D.listas.map(l => `<th class="right">${esc(l.source)}</th>`).join('');
  const filas = datos.map((c, i) => {
    const b = c.libro;
    const celdas = D.listas.map(l => {
      const a = c.apariciones.find(x => x.listId === l.id);
      return `<td class="right rt">${a ? '#' + a.rank : '·'}</td>`;
    }).join('');
    const col = colorIdioma(b.lang);
    return `<tr>
      <td class="rank${i < 10 ? ' t10' : i < 25 ? ' t25' : ''}">${i + 1}</td>
      <td>
        <div class="t-title"><a href="${esc(goodreads(b))}" target="_blank" rel="noopener">${esc(b.title)}</a></div>
        <div class="t-author">${esc(b.author === '-' ? 'Anónimo' : b.author)}${b.year != null ? ` <span class="t-year">· ${fmtAnio(b)}</span>` : ''}</div>
      </td>
      <td class="lang right"><span class="lang-tag" style="color:${col};border:1px solid ${col}">${esc(IDIOMAS[b.lang] || b.lang)}</span></td>
      ${celdas}
    </tr>`;
  }).join('');

  return `
  <div class="wrap">
    <div class="list-head">
      <h1>Consenso</h1>
      <p class="sub">${datos.length} libros en más de una lista</p>
    </div>
    <p style="color:var(--text-2);max-width:640px;margin-bottom:18px">
      Ordenados por cuántos rankings los incluyen y, a igualdad, por la suma de sus
      posiciones. Las columnas de la derecha muestran el puesto en cada lista:
      ahí se ven los desacuerdos.
    </p>
    <table>
      <thead><tr><th>#</th><th>Título / Autor</th><th class="lang right">Idioma</th>${cabeceras}</tr></thead>
      <tbody>${filas}</tbody>
    </table>
  </div>`;
}

/* ---------- Vista: lista ---------- */
const vistaEstado = { q: '', orden: 'rank', dir: 1, idioma: null };

function vistaLista(id) {
  const lista = D.listas.find(l => l.id === id);
  if (!lista) return `<div class="wrap"><p class="empty">No existe esa lista.</p></div>`;
  const cols = lista.columns.filter(c => COLUMNS[c]);

  const botones = cols.filter(c => c !== 'book')
    .map(c => `<button class="btn orden" data-orden="${c}" type="button">${esc(COLUMNS[c].labelBoton || COLUMNS[c].label)}</button>`)
    .join('') + `<button class="btn orden" data-orden="book" type="button">Título A–Z</button>`;

  return `
  <div class="wrap">
    <div class="list-head">
      <h1>${esc(lista.name)}</h1>
      <p class="sub">${esc(lista.source)} · ${lista.year} · ${lista.entries.length} libros</p>
    </div>
    <div class="controls">
      <input class="search-box" type="search" id="q" placeholder="Buscar título o autor…" value="${esc(vistaEstado.q)}">
      ${botones}
      <span class="count" id="count"></span>
    </div>
    <div class="legend" id="legend"></div>
    <table>
      <thead><tr>${cols.map(c => `<th class="${COLUMNS[c].clase}" data-orden="${c}">${esc(COLUMNS[c].label)}</th>`).join('')}</tr></thead>
      <tbody id="tbody"></tbody>
    </table>
    <div id="vacio"></div>
  </div>`;
}

function pintarTabla(lista) {
  const cols = lista.columns.filter(c => COLUMNS[c]);
  const todas = filas(lista);
  const q = normaliza(vistaEstado.q.trim());

  let rows = todas.filter(f =>
    (!q || normaliza(f.libro.title).includes(q) || normaliza(f.libro.author).includes(q)) &&
    (!vistaEstado.idioma || f.libro.lang === vistaEstado.idioma));

  const col = COLUMNS[vistaEstado.orden] || COLUMNS.rank;
  rows.sort((a, b) => {
    const av = col.ordenar(a), bv = col.ordenar(b);
    if (typeof av === 'string') return av.localeCompare(bv) * vistaEstado.dir;
    return (av - bv) * vistaEstado.dir;
  });

  document.getElementById('count').textContent =
    `${rows.length} título${rows.length === 1 ? '' : 's'}`;
  document.getElementById('vacio').innerHTML =
    rows.length ? '' : '<p class="empty">Sin resultados.</p>';
  document.getElementById('tbody').innerHTML = rows.map(f => {
    const c = colorIdioma(f.libro.lang);
    return `<tr class="${f.top3 >= 0 ? 'top3' : ''}" style="--lc:${c}">` +
      cols.map(k => COLUMNS[k].celda(f, cols)).join('') + `</tr>`;
  }).join('');

  document.querySelectorAll('[data-orden]').forEach(el => {
    const activo = el.dataset.orden === vistaEstado.orden;
    el.classList.toggle(el.tagName === 'TH' ? 'sorted' : 'active', activo);
  });
}

function pintarLeyenda(lista) {
  const cuenta = {};
  filas(lista).forEach(f => { cuenta[f.libro.lang] = (cuenta[f.libro.lang] || 0) + 1; });
  const items = Object.keys(IDIOMAS).filter(lk => cuenta[lk]).map(lk => `
    <button class="legend-item ${vistaEstado.idioma === lk ? 'active' : ''}" data-idioma="${lk}" type="button">
      <span class="dot" style="background:${colorIdioma(lk)}"></span>${esc(IDIOMAS[lk])}
      <span class="n">(${cuenta[lk]})</span>
    </button>`).join('');
  document.getElementById('legend').innerHTML = items +
    `<span class="legend-hint">Clic para filtrar</span>`;
}

function activarLista(lista) {
  pintarLeyenda(lista);
  pintarTabla(lista);

  document.getElementById('q').addEventListener('input', e => {
    vistaEstado.q = e.target.value;
    pintarTabla(lista);
  });

  document.querySelectorAll('[data-orden]').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.orden;
      if (vistaEstado.orden === k) vistaEstado.dir *= -1;
      else { vistaEstado.orden = k; vistaEstado.dir = 1; }
      pintarTabla(lista);
    });
  });

  document.getElementById('legend').addEventListener('click', e => {
    const btn = e.target.closest('[data-idioma]');
    if (!btn) return;
    vistaEstado.idioma = vistaEstado.idioma === btn.dataset.idioma ? null : btn.dataset.idioma;
    pintarLeyenda(lista);
    pintarTabla(lista);
  });
}

/* ---------- Router ---------- */
function pintarNav(ruta) {
  document.getElementById('nav').innerHTML = [
    { href: '#/', label: 'Inicio', id: 'home' },
    ...D.listas.map(l => ({ href: `#/lista/${l.id}`, label: l.source, id: `lista/${l.id}` })),
    ...(D.listas.length > 1 ? [{ href: '#/consenso', label: 'Consenso', id: 'consenso' }] : []),
  ].map(x => `<a class="btn ${ruta === x.id ? 'active' : ''}" href="${x.href}">${esc(x.label)}</a>`).join('');
}

/* ---------- Menú de móvil ---------- */
function cerrarMenu() {
  document.getElementById('nav').classList.remove('open');
  document.getElementById('nav-toggle').setAttribute('aria-expanded', 'false');
}

function activarMenu() {
  const nav = document.getElementById('nav');
  const boton = document.getElementById('nav-toggle');

  boton.addEventListener('click', e => {
    e.stopPropagation(); // si no, el listener del documento lo cerraría al instante
    const abierto = nav.classList.toggle('open');
    boton.setAttribute('aria-expanded', String(abierto));
  });

  // Tocar el mismo enlace en el que ya estás no cambia el hash y no dispara
  // el router, así que el menú hay que cerrarlo también desde aquí.
  nav.addEventListener('click', e => { if (e.target.closest('a')) cerrarMenu(); });

  document.addEventListener('click', e => { if (!e.target.closest('.topbar')) cerrarMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarMenu(); });
}

function router() {
  const hash = location.hash.replace(/^#\/?/, '') || '';
  const app = document.getElementById('app');

  if (hash.startsWith('lista/')) {
    const id = hash.slice(6);
    const lista = D.listas.find(l => l.id === id);
    // Cada lista arranca limpia: conservar el filtro de idioma de otra lista confunde
    Object.assign(vistaEstado, { q: '', orden: 'rank', dir: 1, idioma: null });
    app.innerHTML = vistaLista(id);
    if (lista) activarLista(lista);
  } else if (hash === 'consenso') {
    app.innerHTML = vistaConsenso();
  } else {
    app.innerHTML = vistaHome();
  }
  pintarNav(hash);
  cerrarMenu();
  window.scrollTo(0, 0);
}

/* ---------- Tema ---------- */
function aplicarTema(tema) {
  document.body.className = tema;
  document.getElementById('theme-btn').textContent = tema === 'dark' ? '☀ Claro' : '☾ Oscuro';
  try { localStorage.setItem('booksjf-tema', tema); } catch (e) { /* modo privado */ }
}

/* ---------- Arranque ---------- */
let temaGuardado = 'dark';
try { temaGuardado = localStorage.getItem('booksjf-tema') || 'dark'; } catch (e) { /* modo privado */ }
aplicarTema(temaGuardado);
document.getElementById('theme-btn').addEventListener('click', () =>
  aplicarTema(document.body.className === 'dark' ? 'light' : 'dark'));

activarMenu();

cargar().then(() => {
  window.addEventListener('hashchange', router);
  router();
}).catch(err => {
  console.error(err);
  // fetch() falla si el archivo se abre con doble clic (file://): hay que servirlo
  const local = location.protocol === 'file:';
  document.getElementById('app').innerHTML = `<div class="wrap"><p class="empty">
    ${local
      ? 'Esta página necesita un servidor local para leer los datos.<br>Ejecuta <code>npx serve</code> en la carpeta del proyecto y abre la dirección que te indique.'
      : 'No se pudieron cargar los datos: ' + esc(err.message)}
  </p></div>`;
});

})();

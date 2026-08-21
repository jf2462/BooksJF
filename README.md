# BooksJF

Rankings de las mejores novelas de todos los tiempos (The Guardian, The Economist, …)
en una sola base de datos comparable.

**Sitio:** https://jf2462.github.io/BooksJF/

Sin build, sin dependencias, sin framework. Es HTML + CSS + un archivo de JavaScript
que lee JSON. Se publica solo con GitHub Pages desde `main`.

---

## Cómo agregar una lista nueva

Este es el caso de uso principal. Son dos archivos y **no hay que tocar código**.

### 1. Crea `data/lists/<id>.json`

```json
{
  "id": "nyt-2025",
  "name": "Los 100 mejores libros del siglo XXI",
  "source": "The New York Times",
  "year": 2025,
  "blurb": "Votación de 503 escritores y críticos.",
  "columns": ["rank", "book", "lang", "year", "rating"],
  "entries": [
    { "bookId": "my-brilliant-friend--ferrante", "rank": 1 },
    { "bookId": "the-warmth-of-other-suns--wilkerson", "rank": 2 }
  ]
}
```

`columns` decide qué muestra la tabla y en qué orden. Las disponibles son:

| columna     | qué muestra                                    |
|-------------|------------------------------------------------|
| `rank`      | el puesto                                      |
| `book`      | título, autor, medallas y badges               |
| `lang`      | etiqueta de idioma, con filtro en la leyenda   |
| `year`      | año de publicación                             |
| `rating`    | nota de Goodreads con barra                    |
| `country`   | nacionalidad del autor                         |
| `readMins`  | tiempo estimado de lectura                     |

**Cada lista lleva solo las columnas que tenga.** El Guardian no trae tiempo de
lectura y el Economist sí; ninguna necesita saber de la otra. Si tu lista trae un
dato que ninguna otra tiene, hay que registrar esa columna una sola vez en
`COLUMNS`, al inicio de `assets/app.js`.

### 2. Añádela a `data/lists.json`

```json
[
  { "id": "guardian-2026", "file": "guardian-2026.json" },
  { "id": "economist-500", "file": "economist-500.json" },
  { "id": "nyt-2025",      "file": "nyt-2025.json" }
]
```

Con eso ya aparece en el home, en el menú y en el cálculo del consenso.

### 3. Registra los libros que sean nuevos

Los `bookId` apuntan a `data/books.json`, la base común. El formato del id es
`titulo-en-kebab-case--apellido`. Si el libro ya está en otra lista, **reutiliza su
id**: así es como el sitio sabe que es el mismo libro y calcula el consenso.

Cuando dos fuentes titulan la misma obra distinto ("Rainbow" y "The Rainbow"), la
equivalencia se declara en `data/book-aliases.json` y los importadores la respetan.
Es lo que evita que se cuelen libros duplicados. Si alguno ya se coló, se declara
el alias y se corre:

```bash
node execution/apply_aliases.mjs
```

que funde el duplicado en el canónico y reescribe las referencias de todas las listas.

Para los libros nuevos, agrégalos a `data/books.json` con título, autor, idioma y
Goodreads, y deja `year` y `coverId` en `null`. Luego:

```bash
node execution/enrich_years.mjs
```

```bash
node execution/apply_overrides.mjs
```

El primero busca el año en Wikidata (solo consulta los que falten, el resto está
cacheado). El segundo aplica las correcciones a mano de `data/year-overrides.json`.

---

## Ver el sitio en local

`index.html` **no funciona con doble clic**: lee los datos con `fetch()`, que el
navegador bloquea en `file://`. Hay que servirlo:

```bash
node execution/serve.mjs
```

Y abrir http://127.0.0.1:8765/

---

## Estructura

```
index.html               cascarón de la página
assets/styles.css        todos los estilos y los tokens de color
assets/app.js            la aplicación: carga de datos, rutas y vistas
data/lists.json          índice de listas
data/lists/*.json        una lista por archivo (puesto + campos propios)
data/books.json          base común de libros únicos
data/year-overrides.json correcciones de año revisadas a mano
data/book-aliases.json   equivalencias entre ids de un mismo libro
execution/               scripts de mantenimiento de datos
legacy/                  la versión original de una sola página, como respaldo
```

## Scripts

| script                  | para qué                                                  |
|-------------------------|-----------------------------------------------------------|
| `serve.mjs`             | servidor local para previsualizar                         |
| `enrich_years.mjs`      | busca el año de publicación en Wikidata                   |
| `enrich_books.mjs`      | busca portadas en Open Library                            |
| `apply_overrides.mjs`   | aplica las correcciones de año hechas a mano              |
| `apply_aliases.mjs`     | funde los libros duplicados declarados en book-aliases    |
| `audit_years.mjs`       | señala años sospechosos para revisarlos                   |
| `check_contrast.mjs`    | valida que la paleta cumpla WCAG AA en ambos temas        |
| `import_greatestbooks.mjs` | importa el ranking de thegreatestbooks.org             |
| `extract_lists.mjs`     | migración inicial desde el `index.html` viejo (histórico) |

Todos se ejecutan desde la raíz del proyecto y guardan caché en `.tmp/`, que no se
sube al repositorio.

## Datos

- **Rankings**: de sus respectivas publicaciones.
- **Año de publicación**: Wikidata (P577). Ver los comentarios de
  `execution/enrich_years.mjs`: hay varias trampas documentadas ahí.
- **Portadas**: Open Library (se guarda solo el id; las imágenes se cargan de su CDN).
- **Goodreads**: la nota viene de las listas originales; el enlace es una búsqueda.

De 596 libros, 592 tienen año y 545 tienen portada. Los 4 sin año son antologías
sin un año único (*Collected Poems*, *The Complete Works of Plato*), y se muestran
con "—". Los libros que solo aparecen en The Greatest Books no traen nota de
Goodreads, porque esa fuente no la publica.

## Listas actuales

| lista | libros | fuente |
|-------|--------|--------|
| Las 100 mejores novelas | 100 | The Guardian, 2026 |
| Las 500 novelas más recomendadas | 500 | The Economist, 2024 |
| Los mejores libros de todos los tiempos | 500 | The Greatest Books, 2026 |

420 libros aparecen en más de una lista (84 en las tres). La vista de consenso
permite filtrar por esa cantidad y recalcula el promedio de puestos con cada filtro. Para volver a importar la tercera:

```bash
node execution/import_greatestbooks.mjs 500
```

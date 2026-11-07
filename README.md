# Punskas Lexicon

Standalone dictionary tool for the Punskas (Punsk) dialect: search, preview inflection tables, and (in editor mode) create/edit/export entries. Open `index.html` in a browser — no server required.

Part of the **COLINGUA** platform.

---

## COLING / COLINGUA project

The **COLINGUA** platform is an outcome of the project **COLING: Minority Languages, Major Opportunities. Collaborative Research, Community Engagement and Innovative Educational Tools**.

The project aimed to promote and develop sustainable methods for the revitalization and maintenance of languages.

### Funding

COLING received funding from the **Marie Skłodowska-Curie RISE – HORIZON 2020** programme for the period January 2018 to December 2021 (extended to September 2023) — project number: **778384**.

The research was funded by science funding from the Ministry of Science and Education (Poland) in 2018–2023 awarded for an internationally co-financed project under agreement no. **4089/H2020/2018/2**.

### Partners

The CoLing project involves five academic institutions and two NGOs from four European countries, in cooperation with six institutions in the USA and Mexico.

**Europe (participants):**

- University of Warsaw, Faculty of “Artes Liberales”, Poland
- Adam Mickiewicz University in Poznań, Faculty of Modern Languages and Literatures, Poland
- University of Groningen, the Netherlands
- Leiden University, the Netherlands
- Fryske Akademy, Leeuwarden, the Netherlands
- Gruppo di Azione Locale per lo Sviluppo Rurale dell’Area Grecanica, Italy
- LgSC, Latvia

**USA and Mexico:**

- University of North Carolina at Chapel Hill, USA
- University of Texas at Austin, USA
- Yale University, USA
- Smithsonian Institution, USA
- ARENET, The Americas Research Network
- Instituto de Docencia e Investigación Etnológica de Zacatecas, Mexico

---

## How to use

### 1. Online (GitHub Pages)

Search the lexicon in your browser (viewer mode, no installation):

**→ [Open Punskas Lexicon](https://YOUR_USER.github.io/YOUR_REPO/)**

> After enabling GitHub Pages, replace the link above with your site URL (Settings → Pages). If the `Punskas` folder is the repository root, use `https://YOUR_USER.github.io/YOUR_REPO/`; if it lives in a subfolder, use `…/Punskas/`.

### 2. Locally

1. Download or clone the repository.
2. Open `index.html` in a browser (double-click — no server needed).
3. On first run in editor mode, confirm import of the bundled seed data.
4. Mode: set `config.js` (`mode: 'editor'` | `'viewer'`) or use query parameters, e.g. `index.html?mode=viewer`.

### 3. Embed on your website

```html
<iframe
  src="https://YOUR_USER.github.io/YOUR_REPO/?mode=viewer&chrome=0"
  style="width:100%;height:800px;border:0"
  title="Punskas Lexicon"
></iframe>
```

The `chrome=0` parameter hides the page header so the iframe shows lexicon content only. You can also point the `src` at a local copy of the files instead of the Pages URL.

---

## Files

| File | Role |
|------|------|
| `index.html` | App shell |
| `app.js` | UI, search, CRUD, storage |
| `styles.css` | Layout (similar to original admin UI) |
| `config.js` | Mode and chrome (`mode`, `showChrome`) |
| `data.js` | Bundled seed (`window.PUNSKAS_SEED`) for `file://` |
| `data.json` | Same payload for import/export |
| `Backup/` | Raw table dumps (source); rebuild with `node build-data.js` |
| `config.viewer.example.js` | Sample read-only config |

## Modes

### Editor (default `config.js`)

1. Double-click `index.html`.
2. On first run, confirm import of bundled seed into **IndexedDB**.
3. Search, preview, create, edit, delete.
4. **Data ▾** → **Export Data (JSON)** / **Import Data (JSON)** (same v1 format).
5. **Help** (viewer) / **User Manual** (editor) — how the lexicon works.

Changes stay in this browser (IndexedDB). Copy `index.html` + JS/CSS + exported JSON to another machine, then Import.

### Viewer (read-only / embed)

Option A — replace config:

```js
// config.js
window.PUNSKAS_CONFIG = {
  mode: 'viewer',
  showChrome: true,
  dataFile: 'data.json'
};
```

Option B — query string (overrides config):

- `index.html?mode=viewer`
- `index.html?mode=viewer&chrome=0` — content only (iframe embed)
- `index.html?mode=editor` — force editor

If `config.js` is missing, the app starts in **viewer** mode.

Viewer loads `data.js` into memory and does not write IndexedDB. Editing controls are hidden.

### Embed example

```html
<iframe
  src="punskas/index.html?mode=viewer&chrome=0"
  style="width:100%;height:800px;border:0"
  title="Punskas Lexicon"
></iframe>
```

## Rebuild data from Backup

```bash
node build-data.js
```

Writes `data.json` and `data.js` from `Backup/*.json`.

## Data format (v1)

```json
{
  "version": 1,
  "exportedAt": "...",
  "languages": [],
  "types": [],
  "inflections": [],
  "translations": [],
  "examples": []
}
```

## Feature checklist

**Shared**

- [x] Search forms (contains, case-insensitive)
- [x] Last modified lemmas (50)
- [x] Preview: translations, POS grids, examples, highlight
- [x] Parts of speech: noun, adjective, verb, adverb, pronoun, preposition
- [x] `showChrome` / embed mode

**Editor only**

- [x] Add by POS
- [x] Create / Edit
- [x] Delete lemma (cascade)
- [x] Import / Export JSON
- [x] IndexedDB persistence
- [x] First-run seed prompt

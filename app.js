(function () {
  'use strict';

  const DB_NAME = 'punskas-lexicon';
  const DB_STORE = 'document';
  const DB_KEY = 'main';
  const LAST_MODIFIED_LIMIT = 50;

  const DEFAULT_CONFIG = {
    mode: 'viewer',
    showChrome: true,
    dataFile: 'data.json'
  };

  const POS_BUTTONS = [
    { pos: 'noun', label: '+ Add Noun', cls: 'btn-primary' },
    { pos: 'adjective', label: '+ Add Adjective', cls: 'btn-warning' },
    { pos: 'verb', label: '+ Add Verb', cls: 'btn-success' },
    { pos: 'adverb', label: '+ Add Adverb', cls: 'btn-danger' },
    { pos: 'pronoun', label: '+ Add Pronoun', cls: 'btn-info' },
    { pos: 'preposition', label: '+ Add Preposition', cls: 'btn-default' }
  ];

  /** @type {{ mode: string, showChrome: boolean, dataFile: string }} */
  let config = { ...DEFAULT_CONFIG };
  /** @type {any} */
  let data = emptyDoc();
  /** @type {{ name: string, params: Record<string,string> }} */
  let route = { name: 'list', params: {} };
  let searchPhrase = '';
  let indexes = null;

  // ---------- utils ----------

  function emptyDoc() {
    return {
      version: 1,
      exportedAt: null,
      languages: [],
      types: [],
      inflections: [],
      translations: [],
      examples: []
    };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isEditor() {
    return config.mode === 'editor';
  }

  function unique(arr) {
    return [...new Set(arr.filter((x) => x != null && x !== ''))];
  }

  function nextId(list) {
    let max = 0;
    for (const item of list) if (item.id > max) max = item.id;
    return max + 1;
  }

  function cloneDoc(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  function normalizeImported(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid JSON root');
    if (!Array.isArray(raw.languages) || !Array.isArray(raw.types) || !Array.isArray(raw.inflections)) {
      throw new Error('Missing languages/types/inflections');
    }
    return {
      version: raw.version || 1,
      exportedAt: raw.exportedAt || nowIso(),
      languages: raw.languages,
      types: raw.types,
      inflections: raw.inflections,
      translations: raw.translations || [],
      examples: raw.examples || []
    };
  }

  // ---------- config ----------

  function loadConfig() {
    const base = window.__PUNSKAS_NO_CONFIG__
      ? { ...DEFAULT_CONFIG }
      : { ...DEFAULT_CONFIG, ...(window.PUNSKAS_CONFIG || {}) };

    const q = new URLSearchParams(location.search);
    if (q.has('mode')) {
      const m = q.get('mode');
      if (m === 'editor' || m === 'viewer') base.mode = m;
    }
    if (q.has('chrome')) {
      const c = q.get('chrome');
      base.showChrome = !(c === '0' || c === 'false' || c === 'no');
    }
    if (q.has('showChrome')) {
      const c = q.get('showChrome');
      base.showChrome = !(c === '0' || c === 'false' || c === 'no');
    }
    return base;
  }

  // ---------- indexes ----------

  function rebuildIndexes() {
    const typeById = new Map();
    for (const t of data.types) typeById.set(t.id, t);

    const infById = new Map();
    for (const i of data.inflections) infById.set(i.id, i);

    const byLemma = new Map();
    for (const i of data.inflections) {
      if (!byLemma.has(i.lemmaId)) byLemma.set(i.lemmaId, []);
      byLemma.get(i.lemmaId).push(i);
    }

    const trByInf = new Map();
    for (const t of data.translations) {
      if (!trByInf.has(t.inflectionId)) trByInf.set(t.inflectionId, []);
      trByInf.get(t.inflectionId).push(t);
    }

    const exByInf = new Map();
    for (const e of data.examples) {
      if (!exByInf.has(e.inflectionId)) exByInf.set(e.inflectionId, []);
      exByInf.get(e.inflectionId).push(e);
    }

    indexes = { typeById, infById, byLemma, trByInf, exByInf };
  }

  function getType(id) {
    return indexes.typeById.get(id);
  }

  function isLemmaRow(inf) {
    const t = getType(inf.typeId);
    return !!(t && t.isLemma) || inf.id === inf.lemmaId;
  }

  function schemaForPos(pos) {
    return data.types
      .filter((t) => t.partOfSpeech === pos)
      .sort((a, b) => a.position - b.position);
  }

  // ---------- IndexedDB ----------

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(doc) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(doc, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function persist() {
    if (!isEditor()) return;
    data.exportedAt = nowIso();
    await idbSet(cloneDoc(data));
  }

  // ---------- routing ----------

  function parseHash() {
    const raw = (location.hash || '#/').replace(/^#\/?/, '');
    const [path, query = ''] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = {};
    const qs = new URLSearchParams(query);
    qs.forEach((v, k) => { params[k] = v; });

    if (!parts.length || parts[0] === 'list') {
      return { name: 'list', params };
    }
    if (parts[0] === 'preview' && parts[1]) {
      return { name: 'preview', params: { ...params, id: parts[1] } };
    }
    if (parts[0] === 'edit' && parts[1]) {
      return { name: 'edit', params: { ...params, id: parts[1] } };
    }
    if (parts[0] === 'create' && parts[1]) {
      return { name: 'create', params: { ...params, pos: parts[1] } };
    }
    if (parts[0] === 'help') {
      return { name: 'help', params };
    }
    return { name: 'list', params };
  }

  function navigate(hash) {
    location.hash = hash;
  }

  function listReturnUrl() {
    if (searchPhrase) return '#/list?q=' + encodeURIComponent(searchPhrase);
    return '#/list';
  }

  // ---------- search / list data ----------

  function lastModifiedLemmas(limit) {
    const lemmas = data.inflections.filter(isLemmaRow);
    lemmas.sort((a, b) => {
      const am = a.modified || a.created || '';
      const bm = b.modified || b.created || '';
      if (am === bm) return b.id - a.id;
      return am < bm ? 1 : -1;
    });
    return lemmas.slice(0, limit);
  }

  function searchInflections(phrase) {
    const p = phrase.toLowerCase();
    return data.inflections.filter((i) => (i.word || '').toLowerCase().includes(p));
  }

  // ---------- export / import ----------

  function downloadJson(doc, filename) {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'PunskasData.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportData() {
    const doc = cloneDoc(data);
    doc.exportedAt = nowIso();
    downloadJson(doc, 'PunskasData.json');
  }

  function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(normalizeImported(JSON.parse(String(reader.result))));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function applyImported(doc) {
    data = doc;
    rebuildIndexes();
    await persist();
    render();
  }

  // ---------- render helpers ----------

  function translationLangs() {
    return data.languages.filter((l) => l.useForTranslation);
  }

  function exampleLangs() {
    return data.languages.filter((l) => l.useForExample);
  }

  function renderChrome() {
    const chrome = document.getElementById('chrome');
    const badge = document.getElementById('modeBadge');
    document.body.classList.toggle('embed', !config.showChrome);
    chrome.classList.toggle('hidden', !config.showChrome);
    badge.textContent = isEditor()
      ? 'Editor mode — changes are saved in this browser'
      : 'Viewer mode — read only';
  }

  function actionButtons(inf) {
    const lemmaId = inf.lemmaId;
    let html = `<a class="btn btn-primary btn-sm" href="#/preview/${inf.id}">Preview</a>`;
    if (isEditor()) {
      html += ` <a class="btn btn-warning btn-sm" href="#/edit/${lemmaId}">Edit</a>`;
    }
    return html;
  }

  function toolbarRightActions() {
    let html = '<div class="toolbar-right">';
    if (isEditor()) {
      html += `<div class="dropdown" id="dataMenu">
        <button type="button" class="btn btn-primary" data-action="toggle-data-menu" aria-haspopup="true" aria-expanded="false">Data ▾</button>
        <div class="dropdown-menu" role="menu">
          <button type="button" class="dropdown-item" data-action="export" role="menuitem">Export Data (JSON)</button>
          <button type="button" class="dropdown-item" data-action="import" role="menuitem">Import Data (JSON)</button>
        </div>
      </div>`;
    } else if (!data.inflections.length) {
      html += '<button type="button" class="btn btn-primary" data-action="import">Load data file</button>';
    }
    html += `<a class="btn btn-default" href="#/help">${isEditor() ? 'User Manual' : 'Help'}</a>`;
    html += '</div>';
    return html;
  }

  function renderHelp() {
    const publicHelp = `
      <h2>Help — Punskas Lexicon</h2>
      <p>This is a dictionary of the Punskas (Punsk) dialect. You can search word forms and open a lemma to see translations, inflection tables, and usage examples.</p>

      <h3>Search</h3>
      <ul>
        <li>Type part of a word in <strong>Search for...</strong> and press <strong>Search</strong>.</li>
        <li>Matching is case-insensitive and finds the text anywhere in the word (e.g. <code>tus</code> finds forms ending with that ending).</li>
        <li>Without a search phrase, the list shows recently modified lemmas.</li>
        <li>Green rows mark <strong>lemmas</strong> (dictionary base forms). Other rows are declined/conjugated forms.</li>
      </ul>

      <h3>Preview</h3>
      <ul>
        <li>Click <strong>Preview</strong> to open the full entry for that word’s lemma.</li>
        <li>You will see translations (PL, BLR, RUS, LT, DE, EN when filled), the inflection grid for the part of speech, and example sentences (DZU / PL / EN).</li>
        <li>The form you opened from the list is highlighted in the table when possible.</li>
      </ul>

      <h3>Parts of speech</h3>
      <ul>
        <li><strong>Noun / pronoun</strong> — cases × singular/plural (pronouns may also have gender).</li>
        <li><strong>Adjective</strong> — masculine/feminine, cases, numbers, and degrees (positive / comparative / superlative).</li>
        <li><strong>Verb</strong> — tense × person × number.</li>
        <li><strong>Adverb</strong> — degrees.</li>
        <li><strong>Preposition</strong> — single related form.</li>
      </ul>`;

    const editorHelp = `
      <h3>Editor mode</h3>
      <p>You are in <strong>editor</strong> mode. Changes are stored in this browser (IndexedDB) until you export them.</p>
      <ul>
        <li><strong>+ Add …</strong> — create a new lemma for that part of speech. Fill lemma, comment, translations, inflection cells, and examples, then <strong>Save Changes</strong>.</li>
        <li><strong>Edit</strong> — change an existing lemma and its forms. Empty inflection cells remove that form on save.</li>
        <li><strong>Delete</strong> — removes the lemma and all linked forms, translations, and examples (after confirmation).</li>
        <li><strong>Examples</strong> — use <strong>Add Example</strong> for more rows; each row has its own index (#). Leave a row empty to skip it.</li>
        <li><strong>Data ▾ → Export Data (JSON)</strong> — download a full backup file you can keep or move with the tool.</li>
        <li><strong>Data ▾ → Import Data (JSON)</strong> — replace local data with a previously exported file (same format as Export / <code>data.json</code>).</li>
        <li>On first launch with empty storage, the app may ask to import the bundled seed data.</li>
      </ul>
      <p class="muted">Tip: after editing on one computer, Export JSON and Import it on another (together with the HTML/JS files).</p>`;

    return `
      <div class="nav-actions">
        <a class="btn btn-default" href="${listReturnUrl()}">Back To List</a>
      </div>
      <div class="help-page">
        ${publicHelp}
        ${isEditor() ? editorHelp : '<p class="muted">This view is read-only. Editing is available only in editor mode.</p>'}
      </div>`;
  }

  function renderList() {
    const rows = searchPhrase ? searchInflections(searchPhrase) : lastModifiedLemmas(LAST_MODIFIED_LIMIT);
    const title = searchPhrase
      ? `Search results for: '${esc(searchPhrase)}' <a class="btn btn-default btn-sm" href="#/list">Cancel Search</a>`
      : 'Last modified lemmas';

    let toolbar = '';
    if (isEditor()) {
      toolbar = '<div class="toolbar">' +
        POS_BUTTONS.map((b) =>
          `<a class="btn ${b.cls}" href="#/create/${b.pos}">${esc(b.label)}</a>`
        ).join('') +
        toolbarRightActions() +
        '</div><hr />';
    } else {
      toolbar = '<div class="toolbar">' + toolbarRightActions() + '</div><hr />';
    }

    let body = '';
    if (!rows.length) {
      body = '<div class="empty">No entries found.</div>';
    } else {
      body = `<table>
        <thead><tr>
          <th>Id</th><th>Word</th><th>Part of Speech</th><th>Lemma</th>
          <th>Inflection Info</th><th>Comment</th><th></th>
        </tr></thead><tbody>` +
        rows.map((inf) => {
          const type = getType(inf.typeId);
          const lemma = indexes.infById.get(inf.lemmaId);
          const comment = inf.comment || '';
          const commentShort = comment.length > 50 ? esc(comment.slice(0, 50)) + '...' : esc(comment);
          return `<tr class="${isLemmaRow(inf) ? 'lemma-row' : ''}">
            <td>${inf.id}</td>
            <td>${esc(inf.word)}</td>
            <td>${esc(type && type.partOfSpeech)}</td>
            <td>${esc(lemma && lemma.word)}</td>
            <td>${esc(type && type.label)}</td>
            <td>${commentShort}</td>
            <td class="actions">${actionButtons(inf)}</td>
          </tr>`;
        }).join('') +
        '</tbody></table>';
    }

    return `
      ${toolbar}
      <form id="searchForm" class="search-row">
        <input type="text" name="q" placeholder="Search for..." value="${esc(searchPhrase)}" />
        <button class="btn btn-primary" type="submit">Search</button>
      </form>
      <div class="meta-row"><h4>${title}</h4>
        <span class="status">${data.inflections.length} forms · ${data.inflections.filter(isLemmaRow).length} lemmas</span>
      </div>
      ${body}`;
  }

  function renderTranslationsTable(lemmaId, editable) {
    const langs = translationLangs();
    const existing = indexes.trByInf.get(lemmaId) || [];
    const byLang = new Map(existing.map((t) => [t.languageId, t.text]));

    if (!langs.length) return '';

    if (!editable) {
      return `<div class="section"><h4>Lemma Translations</h4>
        <table><thead><tr>${langs.map((l) => `<th class="center">${esc(l.name)}</th>`).join('')}</tr></thead>
        <tbody><tr>${langs.map((l) => `<td class="center">${esc(byLang.get(l.id) || '')}</td>`).join('')}</tr></tbody>
        </table></div>`;
    }

    return `<div class="section"><h4>Lemma Translations</h4>
      <table><thead><tr>${langs.map((l) => `<th class="center">${esc(l.name)}</th>`).join('')}</tr></thead>
      <tbody><tr>${langs.map((l) =>
        `<td><input class="grid-input" name="tr_${l.id}" value="${esc(byLang.get(l.id) || '')}" /></td>`
      ).join('')}</tr></tbody></table></div>`;
  }

  function renderExamples(lemmaId, editable, selectedWord) {
    const langs = exampleLangs();
    if (!langs.length) return '';
    const rows = indexes.exByInf.get(lemmaId) || [];
    const byPos = new Map();
    for (const e of rows) {
      if (!byPos.has(e.position)) byPos.set(e.position, {});
      byPos.get(e.position)[e.languageId] = e.text;
    }
    const positions = [...byPos.keys()].sort((a, b) => a - b);

    if (!editable) {
      if (!positions.length) return '';
      return `<div class="section"><h4>Examples</h4>
        <table><thead><tr>${langs.map((l) => `<th>${esc(l.name)}</th>`).join('')}</tr></thead>
        <tbody>${positions.map((p) => {
          const vals = byPos.get(p);
          return `<tr>${langs.map((l) => {
            const text = vals[l.id] || '';
            const hl = selectedWord && text.toLowerCase().includes(String(selectedWord).toLowerCase());
            return `<td class="${hl ? 'highlight' : ''}">${esc(text)}</td>`;
          }).join('')}</tr>`;
        }).join('')}</tbody></table></div>`;
    }

    // Always show at least one empty row (position 0) when creating / no examples yet.
    const editPositions = positions.length ? positions : [0];

    return `<div class="section"><h4>Examples</h4>
      <div id="examplesEditor">
        <table><thead><tr><th>#</th>${langs.map((l) => `<th>${esc(l.name)}</th>`).join('')}<th></th></tr></thead>
        <tbody id="exampleRows">
          ${editPositions.map((p) => exampleEditRow(p, langs, byPos.get(p) || {})).join('')}
        </tbody></table>
        <button type="button" class="btn btn-default btn-sm" data-action="add-example">Add Example</button>
      </div></div>`;
  }

  function exampleEditRow(pos, langs, vals) {
    return `<tr data-pos="${pos}">
      <td>${pos}</td>
      ${langs.map((l) =>
        `<td><input class="grid-input" name="ex_${pos}_${l.id}" value="${esc(vals[l.id] || '')}" /></td>`
      ).join('')}
      <td><button type="button" class="btn btn-danger btn-sm" data-action="remove-example">×</button></td>
    </tr>`;
  }

  function renderNounLikeGrid(schema, forms, selectedId, editable, withGender) {
    const nonLemma = schema.filter((t) => !t.isLemma);
    const numbers = unique(nonLemma.map((t) => t.number));
    const cases = unique(nonLemma.map((t) => t.case));
    const genders = withGender ? unique(nonLemma.map((t) => t.gender)) : [null];

    let html = `<div class="section"><h4>Inflection</h4><table>
      <thead><tr><th class="center">case/number</th>${numbers.map((n) => `<th class="center">${esc(n)}</th>`).join('')}</tr></thead><tbody>`;

    for (const cas of cases) {
      html += `<tr><td class="center">${esc(cas)}</td>`;
      for (const num of numbers) {
        html += '<td class="center">';
        if (withGender && genders.some(Boolean)) {
          html += '<div class="inflection-cell">';
          for (const g of genders) {
            const type = nonLemma.find((t) => t.case === cas && t.number === num && t.gender === g);
            html += cellContent(type, forms, selectedId, editable);
          }
          html += '</div>';
        } else {
          const type = nonLemma.find((t) => t.case === cas && t.number === num && !t.gender);
          html += cellContent(type, forms, selectedId, editable);
        }
        html += '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  function cellContent(type, forms, selectedId, editable) {
    if (!type) return '<span class="muted">—</span>';
    const form = forms.find((i) => i.typeId === type.id);
    const selected = form && form.id === selectedId;
    if (editable) {
      return `<input class="grid-input" name="inf_${type.id}" value="${esc(form ? form.word : '')}" placeholder="${esc(type.label)}" title="${esc(type.label)}" />`;
    }
    return `<span class="${selected ? 'highlight' : ''}" style="display:inline-block;padding:4px 6px;${selected ? 'background:var(--highlight)' : ''}">${esc(form ? form.word : '')}</span>`;
  }

  function renderAdjectiveGrid(schema, forms, selectedId, editable) {
    const nonLemma = schema.filter((t) => !t.isLemma);
    const genders = unique(nonLemma.map((t) => t.gender));
    const numbers = unique(nonLemma.map((t) => t.number));
    const cases = unique(nonLemma.map((t) => t.case));
    const degrees = unique(nonLemma.map((t) => t.degree));

    let html = '';
    for (const gender of genders) {
      html += `<div class="section"><h4>Inflection: ${esc(gender)}</h4><table>
        <thead><tr><th class="center">case/number</th>`;
      for (const num of numbers) {
        html += `<th class="center" colspan="${degrees.length}">${esc(num)}</th>`;
      }
      html += '</tr><tr><th></th>';
      for (const num of numbers) {
        for (const deg of degrees) html += `<th class="center">${esc(deg)}</th>`;
      }
      html += '</tr></thead><tbody>';

      for (const cas of cases) {
        html += `<tr><td class="center">${esc(cas)}</td>`;
        for (const num of numbers) {
          for (const deg of degrees) {
            const type = nonLemma.find((t) => t.gender === gender && t.number === num && t.case === cas && t.degree === deg);
            html += `<td class="center">${cellContent(type, forms, selectedId, editable)}</td>`;
          }
        }
        html += '</tr>';
      }
      html += '</tbody></table></div>';
    }
    return html;
  }

  function renderVerbGrid(schema, forms, selectedId, editable) {
    const nonLemma = schema.filter((t) => !t.isLemma);
    const tenses = unique(nonLemma.map((t) => t.tense));
    let html = '';
    for (const tense of tenses) {
      const slice = nonLemma.filter((t) => t.tense === tense);
      const numbers = unique(slice.map((t) => t.number));
      const persons = unique(slice.map((t) => t.person));
      html += `<div class="section"><h4>Inflection: ${esc(tense)}</h4><table>
        <thead><tr><th class="center">person/number</th>${numbers.map((n) => `<th class="center">${esc(n)}</th>`).join('')}</tr></thead><tbody>`;
      for (const person of persons) {
        html += `<tr><td class="center">${esc(person)}</td>`;
        for (const num of numbers) {
          const type = slice.find((t) => t.person === person && t.number === num);
          html += `<td class="center">${cellContent(type, forms, selectedId, editable)}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table></div>';
    }
    return html;
  }

  function renderAdverbGrid(schema, forms, selectedId, editable) {
    const nonLemma = schema.filter((t) => !t.isLemma);
    const degrees = unique(nonLemma.map((t) => t.degree));
    // UI shows one field per degree (first matching type), matching original app
    let html = `<div class="section"><h4>Inflection</h4><table><thead><tr>`;
    for (const deg of degrees) html += `<th class="center">${esc(deg)}</th>`;
    html += '</tr></thead><tbody><tr>';
    for (const deg of degrees) {
      const type = nonLemma.find((t) => t.degree === deg);
      html += `<td class="center">${cellContent(type, forms, selectedId, editable)}</td>`;
    }
    html += '</tr></tbody></table></div>';
    return html;
  }

  function renderPrepositionGrid(schema, forms, selectedId, editable) {
    const type = schema.find((t) => !t.isLemma);
    return `<div class="section"><h4>Inflection</h4><table><thead><tr><th class="center">${esc(type && type.label || 'Preposition')}</th></tr></thead>
      <tbody><tr><td class="center">${cellContent(type, forms, selectedId, editable)}</td></tr></tbody></table></div>`;
  }

  function renderInflectionGrids(pos, schema, forms, selectedId, editable) {
    if (pos === 'noun') return renderNounLikeGrid(schema, forms, selectedId, editable, false);
    if (pos === 'pronoun') return renderNounLikeGrid(schema, forms, selectedId, editable, true);
    if (pos === 'adjective') return renderAdjectiveGrid(schema, forms, selectedId, editable);
    if (pos === 'verb') return renderVerbGrid(schema, forms, selectedId, editable);
    if (pos === 'adverb') return renderAdverbGrid(schema, forms, selectedId, editable);
    if (pos === 'preposition') return renderPrepositionGrid(schema, forms, selectedId, editable);
    return '<p class="muted">Unknown part of speech.</p>';
  }

  function renderPreview() {
    const id = Number(route.params.id);
    const selected = indexes.infById.get(id);
    if (!selected) return `<div class="empty">Lemma/form not found.</div><a class="btn btn-default" href="${listReturnUrl()}">Back To List</a>`;

    const lemma = indexes.infById.get(selected.lemmaId) || selected;
    const type = getType(lemma.typeId);
    const pos = type && type.partOfSpeech;
    const schema = schemaForPos(pos);
    const forms = indexes.byLemma.get(lemma.id) || [];

    let actions = `<div class="nav-actions">
      <a class="btn btn-default" href="${listReturnUrl()}">Back To List</a>`;
    if (isEditor()) {
      actions += `<a class="btn btn-warning" href="#/edit/${lemma.id}">Edit</a>`;
      actions += `<button type="button" class="btn btn-danger" data-action="delete" data-id="${lemma.id}">Delete</button>`;
    }
    actions += '</div>';

    return `
      ${actions}
      <h2>Lemma: ${esc(lemma.word)}</h2>
      ${lemma.comment ? `<p><strong>Comment:</strong> ${esc(lemma.comment)}</p>` : ''}
      ${renderTranslationsTable(lemma.id, false)}
      ${renderInflectionGrids(pos, schema, forms, selected.id, false)}
      ${renderExamples(lemma.id, false, selected.word)}`;
  }

  function renderEditForm(mode) {
    const isCreate = mode === 'create';
    let lemma = null;
    let pos = route.params.pos;
    let forms = [];
    let comment = '';

    if (isCreate) {
      if (!pos) pos = 'noun';
    } else {
      const id = Number(route.params.id);
      lemma = indexes.infById.get(id);
      if (!lemma) return `<div class="empty">Not found.</div>`;
      const type = getType(lemma.typeId);
      pos = type.partOfSpeech;
      forms = indexes.byLemma.get(lemma.id) || [];
      comment = lemma.comment || '';
    }

    const schema = schemaForPos(pos);
    const lemmaType = schema.find((t) => t.isLemma);
    const lemmaWord = lemma ? lemma.word : '';

    return `
      <form id="entryForm">
        <div class="nav-actions">
          <button type="submit" class="btn btn-primary">Save Changes</button>
          <a class="btn btn-default" href="${listReturnUrl()}">Back To List</a>
          ${!isCreate && isEditor() ? `<button type="button" class="btn btn-danger" data-action="delete" data-id="${lemma.id}">Delete</button>` : ''}
        </div>
        <h2>${isCreate ? 'Create new ' + esc(pos) : 'Edit: ' + esc(lemmaWord)}</h2>
        <input type="hidden" name="pos" value="${esc(pos)}" />
        <input type="hidden" name="lemmaId" value="${lemma ? lemma.id : ''}" />
        <div class="form-group">
          <label>Lemma</label>
          <input type="text" name="inf_${lemmaType ? lemmaType.id : ''}" value="${esc(lemmaWord)}" required maxlength="50" />
        </div>
        <div class="form-group">
          <label>Comment</label>
          <textarea name="comment" maxlength="1000">${esc(comment)}</textarea>
        </div>
        ${renderTranslationsTable(lemma ? lemma.id : 0, true)}
        ${renderInflectionGrids(pos, schema, forms, null, true)}
        ${renderExamples(lemma ? lemma.id : 0, true)}
      </form>`;
  }

  // ---------- CRUD ----------

  function collectForm(form) {
    const fd = new FormData(form);
    const pos = String(fd.get('pos') || '');
    const lemmaIdRaw = String(fd.get('lemmaId') || '');
    const comment = String(fd.get('comment') || '');
    const inflections = {};
    const translations = {};
    const examples = [];

    for (const [key, value] of fd.entries()) {
      if (key.startsWith('inf_')) inflections[Number(key.slice(4))] = String(value);
      else if (key.startsWith('tr_')) translations[Number(key.slice(3))] = String(value);
      else if (key.startsWith('ex_')) {
        const parts = key.split('_');
        examples.push({ position: Number(parts[1]), languageId: Number(parts[2]), text: String(value) });
      }
    }
    return {
      pos,
      lemmaId: lemmaIdRaw ? Number(lemmaIdRaw) : null,
      comment,
      inflections,
      translations,
      examples
    };
  }

  async function saveEntry(form) {
    const payload = collectForm(form);
    const schema = schemaForPos(payload.pos);
    const lemmaType = schema.find((t) => t.isLemma);
    if (!lemmaType) throw new Error('No lemma type for ' + payload.pos);

    const lemmaWord = (payload.inflections[lemmaType.id] || '').trim();
    if (!lemmaWord) {
      alert('Lemma is required');
      return;
    }

    const stamp = nowIso();
    let lemmaId = payload.lemmaId;

    if (!lemmaId) {
      lemmaId = nextId(data.inflections);
      data.inflections.push({
        id: lemmaId,
        word: lemmaWord,
        comment: payload.comment,
        lemmaId,
        typeId: lemmaType.id,
        created: stamp,
        modified: stamp
      });
    } else {
      const lemma = indexes.infById.get(lemmaId);
      if (!lemma) throw new Error('Lemma missing');
      lemma.word = lemmaWord;
      lemma.comment = payload.comment;
      lemma.modified = stamp;
    }

    // upsert inflection forms (skip empty on create keep slots for filled only; empty clears existing)
    for (const type of schema) {
      if (type.isLemma) continue;
      const word = (payload.inflections[type.id] || '').trim();
      let form = data.inflections.find((i) => i.lemmaId === lemmaId && i.typeId === type.id);
      if (!word) {
        if (form) data.inflections = data.inflections.filter((i) => i.id !== form.id);
        continue;
      }
      if (form) {
        form.word = word;
        form.modified = stamp;
      } else {
        data.inflections.push({
          id: nextId(data.inflections),
          word,
          comment: '',
          lemmaId,
          typeId: type.id,
          created: stamp,
          modified: stamp
        });
      }
    }

    // translations
    data.translations = data.translations.filter((t) => t.inflectionId !== lemmaId);
    for (const [langId, text] of Object.entries(payload.translations)) {
      const t = String(text || '').trim();
      if (!t) continue;
      data.translations.push({
        id: nextId(data.translations),
        inflectionId: lemmaId,
        languageId: Number(langId),
        text: t
      });
    }

    // examples
    data.examples = data.examples.filter((e) => e.inflectionId !== lemmaId);
    const byPos = new Map();
    for (const e of payload.examples) {
      if (!byPos.has(e.position)) byPos.set(e.position, []);
      byPos.get(e.position).push(e);
    }
    for (const [pos, items] of byPos) {
      const any = items.some((i) => (i.text || '').trim());
      if (!any) continue;
      for (const item of items) {
        const text = (item.text || '').trim();
        if (!text) continue;
        data.examples.push({
          id: nextId(data.examples),
          inflectionId: lemmaId,
          languageId: item.languageId,
          text,
          position: Number(pos)
        });
      }
    }

    rebuildIndexes();
    await persist();
    navigate('#/preview/' + lemmaId);
  }

  async function deleteLemma(lemmaId) {
    if (!confirm('Delete this lemma and all its forms, translations, and examples?')) return;
    data.inflections = data.inflections.filter((i) => i.lemmaId !== lemmaId);
    data.translations = data.translations.filter((t) => t.inflectionId !== lemmaId);
    data.examples = data.examples.filter((e) => e.inflectionId !== lemmaId);
    rebuildIndexes();
    await persist();
    searchPhrase = '';
    navigate('#/list');
  }

  // ---------- main render / events ----------

  function render() {
    renderChrome();
    route = parseHash();
    if (route.name === 'list') {
      searchPhrase = route.params.q ? String(route.params.q) : '';
    }

    const view = document.getElementById('view');
    if (route.name === 'help') view.innerHTML = renderHelp();
    else if (route.name === 'preview') view.innerHTML = renderPreview();
    else if (route.name === 'edit') {
      if (!isEditor()) { navigate('#/preview/' + route.params.id); return; }
      view.innerHTML = renderEditForm('edit');
    } else if (route.name === 'create') {
      if (!isEditor()) { navigate('#/list'); return; }
      view.innerHTML = renderEditForm('create');
    } else view.innerHTML = renderList();

    bindViewEvents();
  }

  function bindViewEvents() {
    const searchForm = document.getElementById('searchForm');
    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = new FormData(searchForm).get('q');
        searchPhrase = String(q || '').trim();
        if (searchPhrase) navigate('#/list?q=' + encodeURIComponent(searchPhrase));
        else navigate('#/list');
      });
    }

    const entryForm = document.getElementById('entryForm');
    if (entryForm) {
      entryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await saveEntry(entryForm);
        } catch (err) {
          alert('Save failed: ' + err.message);
        }
      });
    }

    document.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        const action = el.getAttribute('data-action');
        if (action === 'toggle-data-menu') {
          e.stopPropagation();
          const menu = document.getElementById('dataMenu');
          if (menu) {
            const open = menu.classList.toggle('open');
            el.setAttribute('aria-expanded', open ? 'true' : 'false');
          }
          return;
        }
        if (action === 'export') {
          document.getElementById('dataMenu')?.classList.remove('open');
          exportData();
        }
        if (action === 'import') {
          document.getElementById('dataMenu')?.classList.remove('open');
          document.getElementById('importFile').click();
        }
        if (action === 'delete') await deleteLemma(Number(el.getAttribute('data-id')));
        if (action === 'add-example') {
          e.preventDefault();
          const tbody = document.getElementById('exampleRows');
          const langs = exampleLangs();
          let max = -1;
          tbody.querySelectorAll('tr[data-pos]').forEach((tr) => {
            max = Math.max(max, Number(tr.getAttribute('data-pos')));
          });
          tbody.insertAdjacentHTML('beforeend', exampleEditRow(max + 1, langs, {}));
        }
        if (action === 'remove-example') {
          e.preventDefault();
          el.closest('tr').remove();
        }
      });
    });
  }

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const doc = await importFromFile(file);
      await applyImported(doc);
      alert('Import complete.');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  });

  document.addEventListener('click', () => {
    const menu = document.getElementById('dataMenu');
    if (menu) menu.classList.remove('open');
  });

  window.addEventListener('hashchange', () => render());

  // ---------- boot ----------

  async function boot() {
    config = loadConfig();
    renderChrome();

    if (isEditor()) {
      try {
        const stored = await idbGet();
        if (stored && stored.inflections && stored.inflections.length) {
          data = normalizeImported(stored);
        } else if (window.PUNSKAS_SEED) {
          const ok = confirm('No local data found. Import bundled seed data now?');
          if (ok) {
            data = normalizeImported(window.PUNSKAS_SEED);
            await persist();
          } else if (window.PUNSKAS_SEED.languages) {
            // keep schema so create forms work even with empty lexicon
            data = {
              ...emptyDoc(),
              languages: window.PUNSKAS_SEED.languages,
              types: window.PUNSKAS_SEED.types
            };
            await persist();
          }
        } else if (window.PUNSKAS_SEED === undefined && !window.__PUNSKAS_NO_SEED__) {
          // data.js loaded empty? treat as no seed
        }
      } catch (err) {
        console.error(err);
        alert('Could not open local database: ' + err.message);
      }
    } else {
      if (window.PUNSKAS_SEED) {
        data = normalizeImported(window.PUNSKAS_SEED);
      }
    }

    rebuildIndexes();
    if (!location.hash) location.hash = '#/list';
    else render();
  }

  boot();
})();

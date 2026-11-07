/**
 * One-shot: merges Punskas/Backup/*.json into data.json + data.js
 * Usage: node build-data.js
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const backup = path.join(dir, 'Backup');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(backup, name), 'utf8'));
}

const languages = load('InflectionLanguage.json').map((l) => ({
  id: l.Id,
  name: l.Name,
  useForTranslation: !!l.UseForTranslation,
  useForExample: !!l.UseForExample
}));

const types = load('InflectionType.json').map((t) => ({
  id: t.Id,
  partOfSpeech: t.PartOfSpeech,
  isLemma: !!t.IsLemma,
  position: t.Position,
  label: t.Label,
  number: t.Number,
  case: t.Case,
  tense: t.Tense,
  gender: t.Gender,
  person: t.Person,
  degree: t.Degree
}));

const inflections = load('Inflection.json').map((i) => ({
  id: i.Id,
  word: i.Word,
  comment: i.Comment || '',
  lemmaId: i.LemmaId,
  typeId: i.InflectionTypeId,
  created: i.Created || null,
  modified: i.Modified || null
}));

const translations = load('InflectionTranslation.json').map((t) => ({
  id: t.Id,
  inflectionId: t.InflectionId,
  languageId: t.LanguageId,
  text: t.Translation
}));

const examples = load('InflectionExample.json').map((e) => ({
  id: e.Id,
  inflectionId: e.InflectionId,
  languageId: e.LanguageId,
  text: e.Text,
  position: e.Position
}));

const doc = {
  version: 1,
  exportedAt: new Date().toISOString(),
  languages,
  types,
  inflections,
  translations,
  examples
};

const typeIds = new Set(types.map((t) => t.id));
const langIds = new Set(languages.map((l) => l.id));
const infIds = new Set(inflections.map((i) => i.id));
const missingTypes = [...new Set(inflections.map((i) => i.typeId).filter((id) => !typeIds.has(id)))];
const badLemma = inflections.filter((i) => !infIds.has(i.lemmaId)).length;
const badTr = translations.filter((t) => !infIds.has(t.inflectionId) || !langIds.has(t.languageId)).length;
const badEx = examples.filter((e) => !infIds.has(e.inflectionId) || !langIds.has(e.languageId)).length;
const lemmas = inflections.filter((i) => i.id === i.lemmaId).length;

if (missingTypes.length || badLemma || badTr || badEx) {
  console.error('Validation failed', { missingTypes, badLemma, badTr, badEx });
  process.exit(1);
}

const json = JSON.stringify(doc);
fs.writeFileSync(path.join(dir, 'data.json'), json, 'utf8');
fs.writeFileSync(path.join(dir, 'data.js'), 'window.PUNSKAS_SEED = ' + json + ';\n', 'utf8');
console.log('OK', { languages: languages.length, types: types.length, inflections: inflections.length, translations: translations.length, examples: examples.length, lemmas });

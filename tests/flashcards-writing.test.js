const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFlashcardsScript } = require('./helpers/loaders');
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
async function setup(cached = true, lemma = 'goen') {
  const ratings = [];
  const s = await loadFlashcardsScript({
    entries: [{ id: 'GOEN1', word: 'goen', translations: { en: 'to go' }, study: true }],
    localStorage: cached ? { 'lodVault.lx.GOEN1': { v: 1, id: 'GOEN1', lemma, fetchedAt: Date.now(), pos: 'verb', senses: [{ n: 1, tr: { en: [['to go']] } }] } } : {},
    storeOverrides: { async recordFlashcardReview(...args) { ratings.push(args); return {}; } }
  });
  const doc = s.dom.window.document;
  const select = doc.getElementById('mode-select');
  select.value = 'writing';
  select.dispatchEvent(new s.dom.window.Event('change'));
  await tick();
  return { ...s, doc, ratings };
}
for (const [mode, answer, label] of [['plural', 'Haiser', 'Plural'], ['cloze', 'Haus', 'Fill the gap'], ['perfect', 'gaangen', 'Perfect'], ['gender', 'n', 'Gender']]) {
  test(`${mode} mounts in a real session and records its answer once`, async () => {
    const ratings = [];
    const lexicon = { v: 1, fetchedAt: Date.now(), id: 'HAUS1', lemma: 'Haus', gender: 'n', noun: { plurals: ['Haiser'] }, verb: { aux: 'sinn', pp: ['gaangen'] }, senses: [{ n: 1, tr: { en: [['house']] }, ex: [{ t: 'Dat ass en Haus.', h: [[11, 15]] }] }] };
    const s = await loadFlashcardsScript({
      entries: [{ id: 'HAUS1', word: 'Haus', translations: { en: 'house' }, study: true }],
      localStorage: { 'lodVault.lx.HAUS1': lexicon },
      storeOverrides: { async recordFlashcardReview(...args) { ratings.push(args); return {}; } }
    });
    const doc = s.dom.window.document;
    doc.getElementById('mode-select').value = mode;
    doc.getElementById('mode-select').dispatchEvent(new s.dom.window.Event('change'));
    await tick();
    assert.ok(doc.querySelector('.exercise'), doc.body.textContent.slice(-1200));
    assert.match(doc.querySelector('.exercise').textContent, new RegExp(label));
    if (mode === 'perfect') doc.querySelector('[data-aux="sinn"]').click();
    if (mode === 'gender') doc.querySelector('[data-gender="n"]').click();
    else {
      doc.querySelector('.ex-input').value = answer;
      doc.querySelector('.ex-submit').click();
    }
    assert.match(doc.querySelector('.ex-feedback').textContent, /Correct/);
    doc.querySelector('.ex-continue').click();
    await tick();
    assert.equal(ratings.length, 1);
    assert.equal(ratings[0][0], 'HAUS1');
    assert.equal(ratings[0][1], 3);
    assert.equal(s.storageData['lodVault.flashcardSettings'].mode, mode);
  });
}

test('writing mode mounts real exercise, checks submission and persists one grade', async () => {
  const s = await setup();
  const input = s.doc.querySelector('.ex-input');
  assert.ok(input);
  input.value = 'goen';
  s.doc.querySelector('.ex-form').dispatchEvent(new s.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match(s.doc.querySelector('.ex-feedback').textContent, /Correct/);
  assert.equal(s.ratings.length, 0);
  s.doc.querySelector('.ex-continue').click();
  await tick();
  assert.equal(s.ratings.length, 1);
  assert.equal(s.ratings[0][0], 'GOEN1');
  assert.equal(s.ratings[0][1], 3);
  assert.equal(s.storageData['lodVault.flashcardSettings'].mode, 'writing');
});
test('wrong answer has an explicit override', async () => {
  const s = await setup();
  s.doc.querySelector('.ex-input').value = 'falsch';
  s.doc.querySelector('.ex-submit').click();
  assert.match(s.doc.querySelector('.ex-feedback').textContent, /Not quite/);
  s.doc.querySelector('.ex-override').click();
  await tick();
  assert.equal(s.ratings.length, 1);
  assert.equal(s.ratings[0][1], 3);
});
test('accent-only answer records Hard and mode teardown removes the exercise', async () => {
  const s = await setup(true, 'schéin');
  s.doc.querySelector('.ex-input').value = 'schein';
  s.doc.querySelector('.ex-submit').click();
  s.doc.querySelector('.ex-continue').click();
  await tick();
  assert.equal(s.ratings[0][1], 2);
  const select = s.doc.getElementById('mode-select');
  select.value = 'self';
  select.dispatchEvent(new s.dom.window.Event('change'));
  assert.equal(s.doc.querySelector('.exercise'), null);
  assert.equal(s.doc.getElementById('flashcard').classList.contains('is-hidden'), false);
});

test('missing cached details never invent an answer', async () => {
  const s = await setup(false);
  assert.equal(s.doc.querySelector('.ex-input'), null);
  assert.match(s.doc.body.textContent, /No cached dictionary details/);
  assert.equal(s.ratings.length, 0);
});

'use strict';
// Run: node --test audioLangPick.test.js

const test = require('node:test');
const assert = require('node:assert');
const { pickAudioByLanguage, readStreamTag } = require('./audioLangPick');

const t = (i, lang, title = null, channels = 2) => ({ i, lang, title, codec: 'aac', channels });

test('English first, Japanese second: jpn picks the second track', () => {
  assert.strictEqual(pickAudioByLanguage([t(0, 'eng'), t(1, 'jpn')], 'jpn'), 1);
});

test('matches 639-1 and long-name tags against a 639-2 request', () => {
  assert.strictEqual(pickAudioByLanguage([t(0, 'eng'), t(1, 'ja')], 'jpn'), 1);
  assert.strictEqual(pickAudioByLanguage([t(0, 'eng'), t(1, 'Japanese')], 'jpn'), 1);
});

test('an untagged Japanese track is found by its title', () => {
  assert.strictEqual(pickAudioByLanguage([t(0, 'eng'), t(1, null, 'Japanese')], 'jpn'), 1);
  assert.strictEqual(pickAudioByLanguage([t(0, 'eng'), t(1, 'und', 'Japanese 2.0')], 'jpn'), 1);
});

test('a blanket eng tag can be re-filed by title, a specific tag cannot', () => {
  assert.strictEqual(pickAudioByLanguage([t(0, 'eng', 'English'), t(1, 'eng', 'Japanese')], 'jpn'), 1);
  assert.strictEqual(pickAudioByLanguage([t(0, 'fra', 'Japanese commentary')], 'jpn'), null);
});

test('no match keeps the caller on track 0', () => {
  assert.strictEqual(pickAudioByLanguage([t(0, 'eng'), t(1, 'fra')], 'jpn'), null);
  assert.strictEqual(pickAudioByLanguage([], 'jpn'), null);
  assert.strictEqual(pickAudioByLanguage([t(0, 'eng')], ''), null);
});

test('more channels win among several matches; ties keep file order', () => {
  assert.strictEqual(pickAudioByLanguage([t(0, 'jpn', null, 2), t(1, 'jpn', null, 6)], 'jpn'), 1);
  assert.strictEqual(pickAudioByLanguage([t(0, 'jpn', null, 2), t(1, 'jpn', null, 2)], 'jpn'), 0);
});

test('readStreamTag reads LANGUAGE, language and lang regardless of case', () => {
  assert.strictEqual(readStreamTag({ LANGUAGE: 'jpn' }, 'language', 'lang'), 'jpn');
  assert.strictEqual(readStreamTag({ language: 'eng' }, 'language', 'lang'), 'eng');
  assert.strictEqual(readStreamTag({ Lang: 'fra' }, 'language', 'lang'), 'fra');
  assert.strictEqual(readStreamTag({}, 'language'), null);
  assert.strictEqual(readStreamTag(undefined, 'language'), null);
});

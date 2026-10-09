import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLanguage, SUPPORTED_LANGUAGES } from '../packages/app/src/languages.ts';

test('saved languages absent from this build fall back without changing save format', () => {
  for (const lang of ['deu', 'esp', 'fra', 'ita', 'jpn', 'kor', 'pol', 'ptb', 'rus', 'spa', 'tha', 'tur', 'zht', '', null, undefined]) {
    assert.equal(normalizeLanguage(lang), 'eng', String(lang));
  }
  assert.deepEqual(SUPPORTED_LANGUAGES, ['eng', 'zhs']);
  assert.equal(normalizeLanguage('eng'), 'eng');
  assert.equal(normalizeLanguage('zhs'), 'zhs');
});

test('Chinese device locale variants resolve to the shipped simplified Chinese tables', () => {
  for (const lang of ['zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant-HK', 'ZH_cn']) assert.equal(normalizeLanguage(lang), 'zhs');
  assert.equal(normalizeLanguage('en-US'), 'eng');
});

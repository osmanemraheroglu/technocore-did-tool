import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSwept, sweep } from '../src/sweep.js';

// Gorunmez karakterler kod noktasindan uretiliyor: kaynak koda gozle ayirt
// edilemeyen bir bayt gommek testin kendisini yaniltirdi.
const cp = (code) => String.fromCodePoint(code);

const ZWSP = cp(0x200b); // Cf - zero width space
const ZWJ = cp(0x200d); // Cf - zero width joiner
const RLO = cp(0x202e); // Cf - right-to-left override
const BOM = cp(0xfeff); // Cf - byte order mark
const NEL = cp(0x0085); // Cc - C1 next line
const LS = cp(0x2028); // Zl - line separator
const PS = cp(0x2029); // Zp - paragraph separator
const PUA = cp(0xe000); // Co - ozel kullanim alani
const LONE_SURROGATE = cp(0xd800); // Cs - eslesmemis vekil
const ROCKET = cp(0x1f680);
const WOMAN = cp(0x1f469);
const LAPTOP = cp(0x1f4bb);

test('Cc: kontrol karakterleri bosluga cevrilir', () => {
  assert.equal(sweep('a\tb\nc\rd'), 'a b c d');
  assert.equal(sweep(`a${NEL}b`), 'a b');
  assert.equal(sweep(`a${cp(0x0000)}b`), 'a b');
});

test('Cf: format karakterleri bosluga cevrilir', () => {
  assert.equal(sweep(`a${ZWSP}b`), 'a b');
  assert.equal(sweep(`a${ZWJ}b`), 'a b');
  assert.equal(sweep(`a${RLO}b`), 'a b');
  assert.equal(sweep(`a${BOM}b`), 'a b');
});

test('Zl / Zp: satir ve paragraf ayraclari', () => {
  assert.equal(sweep(`a${LS}b${PS}c`), 'a b c');
});

test('Co: ozel kullanim alani', () => {
  assert.equal(sweep(`a${PUA}b`), 'a b');
});

test('Cs: eslesmemis vekil', () => {
  assert.equal(sweep(`a${LONE_SURROGATE}b`), 'a b');
});

test('uclar degistirmeden SONRA kirpilir', () => {
  assert.equal(sweep('  merhaba  '), 'merhaba');
  assert.equal(sweep('\tmerhaba\n'), 'merhaba');
  assert.equal(sweep('   '), '');
  // Kritik sira: bu tek karakter once bosluga donusur, sonra kirpilir.
  assert.equal(sweep(ZWSP), '');
  assert.equal(sweep(`${ZWSP}merhaba${ZWSP}`), 'merhaba');
});

test('ic bosluklar korunur (sunucu daraltmaz)', () => {
  assert.equal(sweep('a  b'), 'a  b');
});

test('gorunur icerik bozulmaz', () => {
  const turkish = 'cigusoCIGUSO';
  assert.equal(sweep(turkish), turkish);
  assert.equal(sweep(`emoji: ${ROCKET} ok`), `emoji: ${ROCKET} ok`);
  // ZWJ emoji dizisi Cf tasidigi icin bilerek bolunur - protokol boyle diyor.
  assert.equal(sweep(`${WOMAN}${ZWJ}${LAPTOP}`), `${WOMAN} ${LAPTOP}`);
});

test('sweep idempotenttir', () => {
  for (const input of ['  a\tb  ', 'duz metin', `${ZWSP}x${ZWSP}`, `a${LS}b`]) {
    const once = sweep(input);
    assert.equal(sweep(once), once, 'ikinci supurme degistirmemeli');
    assert.ok(isSwept(once));
  }
});

test('string olmayan girdi reddedilir', () => {
  assert.throws(() => sweep(42), TypeError);
});

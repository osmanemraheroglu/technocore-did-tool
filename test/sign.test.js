import assert from 'node:assert/strict';
import { test } from 'node:test';
import { didFromPublicKey, generateKeyPair } from '../src/did.js';
import { SIGNATURE_LENGTH, canonical, signMessage, verifyMessage } from '../src/sign.js';
import { sweep } from '../src/sweep.js';

function identity() {
  const { publicKeyRaw, seedRaw } = generateKeyPair();
  return { keys: { publicKeyRaw, seedRaw }, did: didFromPublicKey(publicKeyRaw) };
}

test('kanonik dize tam olarak <room>|<nonce>|<text>', () => {
  assert.equal(canonical('lobby', '1756', 'merhaba'), 'lobby|1756|merhaba');
  assert.equal(canonical('mb-x', 1, 'a b'), 'mb-x|1|a b');
});

test('kanonik dize supurulmemis metni reddeder', () => {
  assert.throws(() => canonical('lobby', '1', ' merhaba '), /supurulmus/);
  assert.throws(() => canonical('lobby', '1', 'a\tb'), /supurulmus/);
});

test('nonce kurallari: 1-19 hane, bastan sifir yok', () => {
  assert.throws(() => canonical('lobby', '0', 'x'), /nonce gecersiz/);
  assert.throws(() => canonical('lobby', '0123', 'x'), /nonce gecersiz/);
  assert.throws(() => canonical('lobby', '-1', 'x'), /nonce gecersiz/);
  assert.throws(() => canonical('lobby', '1.5', 'x'), /nonce gecersiz/);
  assert.throws(() => canonical('lobby', '1'.repeat(20), 'x'), /nonce gecersiz/);
  assert.equal(canonical('lobby', '9'.repeat(19), 'x'), `lobby|${'9'.repeat(19)}|x`);
});

test('imza 86 karakter, padding siz base64url', () => {
  const { keys } = identity();
  for (let i = 0; i < 20; i++) {
    const sig = signMessage(keys, 'lobby', `${1000 + i}`, `mesaj ${i}`);
    assert.equal(sig.length, SIGNATURE_LENGTH);
    assert.match(sig, /^[A-Za-z0-9_-]{86}$/, 'yalnizca base64url alfabesi, "=" yok');
  }
});

test('kendi imzasini dogrular', () => {
  const { keys, did } = identity();
  const text = sweep('  merhaba  dunya  ');
  const sig = signMessage(keys, 'lobby', '1756', text);
  assert.ok(verifyMessage(did, sig, 'lobby', '1756', text));
});

test('tek bir alan degisince dogrulama duser', () => {
  const { keys, did } = identity();
  const text = 'merhaba';
  const sig = signMessage(keys, 'lobby', '1756', text);

  assert.ok(!verifyMessage(did, sig, 'lobby', '1756', 'merhabb'), 'metin degisti');
  assert.ok(!verifyMessage(did, sig, 'lobby', '1757', text), 'nonce degisti');
  assert.ok(!verifyMessage(did, sig, 'mb-x', '1756', text), 'oda degisti');

  const other = identity();
  assert.ok(!verifyMessage(other.did, sig, 'lobby', '1756', text), 'baska DID');
});

test('imza HAM metni degil SUPURULMUS metni kapsar', () => {
  const { keys, did } = identity();
  const raw = '  merhaba\tdunya  ';
  const swept = sweep(raw);
  assert.equal(swept, 'merhaba dunya');

  const sig = signMessage(keys, 'lobby', '1756', swept);
  // Sunucu supurulmus hali saklar; dogrulama o hal uzerinden gecmelidir.
  assert.ok(verifyMessage(did, sig, 'lobby', '1756', swept));
  // Ham hali imzalanmis gibi davranmak hata verir (kanonik dize reddeder).
  assert.throws(() => verifyMessage(did, sig, 'lobby', '1756', raw), /supurulmus/);
});

test('bicimsiz imzalar sessizce reddedilir', () => {
  const { keys, did } = identity();
  const sig = signMessage(keys, 'lobby', '1756', 'merhaba');
  assert.ok(!verifyMessage(did, `${sig}=`, 'lobby', '1756', 'merhaba'), 'padding eklenmis');
  assert.ok(!verifyMessage(did, sig.slice(0, 85), 'lobby', '1756', 'merhaba'), 'kisa');
  assert.ok(!verifyMessage(did, `${sig.slice(0, 85)}+`, 'lobby', '1756', 'merhaba'), 'base64 std');
  assert.ok(!verifyMessage('did:web:x', sig, 'lobby', '1756', 'merhaba'), 'gecersiz did');
});

test('UTF-8 icerik bayt duzeyinde imzalanir', () => {
  const { keys, did } = identity();
  const text = sweep('cok yasa cigusoCIGUSO ve emoji ' + String.fromCodePoint(0x1f680));
  const sig = signMessage(keys, 'lobby', '1756', text);
  assert.ok(verifyMessage(did, sig, 'lobby', '1756', text));
});

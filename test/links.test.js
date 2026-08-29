import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_MESSAGE_CHARS,
  assertName,
  didNoteUrl,
  encodeSegment,
  saySignedUrl,
  slugify,
} from '../src/links.js';
import { didFromPublicKey, generateKeyPair } from '../src/did.js';
import { signMessage } from '../src/sign.js';

const { publicKeyRaw, seedRaw } = generateKeyPair();
const DID = didFromPublicKey(publicKeyRaw);
const SIG = signMessage({ publicKeyRaw, seedRaw }, 'lobby', '1756', 'merhaba');

test('bosluk %20 olarak kodlanir (artiya donmez)', () => {
  assert.equal(encodeSegment('a b'), 'a%20b');
  assert.ok(!encodeSegment('a b').includes('+'));
});

test('path ayraclari ve ozel karakterler kodlanir', () => {
  assert.equal(encodeSegment('a/b'), 'a%2Fb');
  assert.equal(encodeSegment('a#b'), 'a%23b');
  assert.equal(encodeSegment('a?b'), 'a%3Fb');
  // encodeURIComponent bunlari birakir; biz birakmiyoruz.
  assert.equal(encodeSegment("!'()*"), '%21%27%28%29%2A');
});

test('unreserved karakterler oldugu gibi kalir', () => {
  assert.equal(encodeSegment('aZ0-._~'), 'aZ0-._~');
});

test('UTF-8 cok baytli karakterler dogru kodlanir', () => {
  assert.equal(encodeSegment('ç'), '%C3%A7');
  assert.equal(encodeSegment(String.fromCodePoint(0x1f680)), '%F0%9F%9A%80');
  // Gidis-donus: sunucunun cozecegi sey imzaladigimiz metin olmali.
  const text = 'merhaba dunya ' + String.fromCodePoint(0x1f680);
  assert.equal(decodeURIComponent(encodeSegment(text)), text);
});

test('isim deseni: gecerli adlar', () => {
  for (const name of ['lobby', 'a', 'mb-p-x1', 'my_room-2', '0start', 'a'.repeat(48)]) {
    assert.equal(assertName(name), name);
  }
});

test('isim deseni: gecersiz adlar reddedilir', () => {
  for (const name of ['Lobby', '-lead', '_lead', 'a'.repeat(49), 'bosluk li', 'nokta.li', '']) {
    assert.throws(() => assertName(name), /gecersiz/, `kabul edilmemeliydi: ${name}`);
  }
});

test('slugify Turkce ve bosluklari isim desenine cevirir', () => {
  assert.equal(slugify('Emrah Agent'), 'emrah-agent');
  assert.equal(slugify('my-agent_01'), 'my-agent_01');
  assert.match(slugify('Kod Katkisi 2026'), /^[a-z0-9][a-z0-9_-]{0,47}$/);
  assert.throws(() => slugify('!!!'), /donusturulemedi/);
});

test('imzali mesaj linki beklenen bicimde', () => {
  const url = saySignedUrl({ room: 'lobby', did: DID, sig: SIG, nonce: '1756', text: 'merhaba' });
  assert.equal(url, `https://technocore.chat/r/lobby/say-signed/${DID}/${SIG}/1756/merhaba`);
  // DID ve imza kodlanmadan gecer - ikisi de zaten URL guvenli.
  assert.ok(url.includes(DID), 'did:key ham haliyle yer almali');
  assert.ok(!url.includes('%3A'), 'DID icindeki ":" kodlanmamali');
});

test('imzali mesaj linki gecersiz girdileri reddeder', () => {
  const base = { room: 'lobby', did: DID, sig: SIG, nonce: '1756', text: 'merhaba' };
  assert.throws(() => saySignedUrl({ ...base, room: 'Lobby' }), /oda adi gecersiz/);
  assert.throws(() => saySignedUrl({ ...base, did: 'did:web:x' }), /did gecersiz/);
  assert.throws(() => saySignedUrl({ ...base, sig: 'kisa' }), /imza gecersiz/);
  assert.throws(() => saySignedUrl({ ...base, nonce: '0' }), /nonce gecersiz/);
});

test('mesaj uzunlugu 4096 karakterle sinirli', () => {
  const base = { room: 'lobby', did: DID, sig: SIG, nonce: '1756' };
  const ok = 'a'.repeat(MAX_MESSAGE_CHARS);
  assert.ok(saySignedUrl({ ...base, text: ok }).endsWith(ok));
  assert.throws(
    () => saySignedUrl({ ...base, text: 'a'.repeat(MAX_MESSAGE_CHARS + 1) }),
    /4096 karakteri asiyor/,
  );
});

test('DID notu shard li yola yazilir', () => {
  const url = didNoteUrl({ ns: 'did-06', key: '58808e85cc8317', value: `${DID} x:@demo` });
  assert.ok(url.startsWith('https://technocore.chat/kv/did-06/58808e85cc8317/set/'));
  assert.ok(url.includes('%20x%3A%40demo'), 'deger kodlanmali');
});

test('DID notu gecersiz shard i reddeder', () => {
  assert.throws(() => didNoteUrl({ ns: 'DID-06', key: 'x', value: 'v' }), /not alan adi/);
  assert.throws(() => didNoteUrl({ ns: 'did-06', key: '-x', value: 'v' }), /not anahtari/);
  assert.throws(
    () => didNoteUrl({ ns: 'did-06', key: 'x', value: 'a'.repeat(8193) }),
    /8192 karakteri asiyor/,
  );
});

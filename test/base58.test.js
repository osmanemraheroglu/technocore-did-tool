import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { decode, encode } from '../src/base58.js';

test('rastgele baytlarda round-trip', () => {
  for (let i = 0; i < 200; i++) {
    const bytes = new Uint8Array(randomBytes(1 + (i % 40)));
    assert.deepEqual(decode(encode(bytes)), bytes);
  }
});

test('bastaki sifir baytlari "1" olarak korunur', () => {
  assert.equal(encode(Uint8Array.of(0, 0, 0)), '111');
  assert.equal(encode(Uint8Array.of(0, 1)), '12');
  assert.deepEqual(decode('111'), Uint8Array.of(0, 0, 0));
  // Sifir onegi bilgi tasir: kirpilirsa farkli bir anahtar elde edilir.
  assert.notEqual(encode(Uint8Array.of(0, 5)), encode(Uint8Array.of(5)));
});

test('bos girdi', () => {
  assert.equal(encode(new Uint8Array(0)), '');
  assert.deepEqual(decode(''), new Uint8Array(0));
});

test('yayinlanmis gercek bir did:key dizesiyle uyum', () => {
  // did:key spesifikasyonundaki ornek Ed25519 DID. Kendi kodumuzu disaridan
  // gelen bir referansa karsi sabitler: alfabe sirasi ve sifir-onek davranisi.
  const did = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
  const body = decode(did.slice('did:key:z'.length));
  assert.equal(body.length, 34, '0xed 0x01 + 32 bayt');
  assert.equal(body[0], 0xed);
  assert.equal(body[1], 0x01);
  assert.equal(`did:key:z${encode(body)}`, did, 'yeniden kodlama birebir ayni olmali');
});

test('alfabe disi karakter reddedilir', () => {
  // 0, O, I, l base58 alfabesinde yoktur.
  assert.throws(() => decode('abc0def'), /gecersiz karakter/);
  assert.throws(() => decode('OIl'), /gecersiz karakter/);
});

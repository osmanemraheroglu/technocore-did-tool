import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createIdentity, exists, keysOf, load, nextNonce, save } from '../src/keystore.js';
import { didFromPublicKey } from '../src/did.js';

const dir = mkdtempSync(join(tmpdir(), 'tc-did-'));

test('createIdentity gecerli bir kimlik uretir', () => {
  const store = createIdentity();
  assert.equal(store.algorithm, 'Ed25519');
  assert.ok(store.did.startsWith('did:key:z6Mk'));
  assert.match(store.fingerprint, /^[0-9a-f]{16}$/);
  const keys = keysOf(store);
  assert.equal(keys.seedRaw.length, 32);
  assert.equal(keys.publicKeyRaw.length, 32);
  assert.equal(didFromPublicKey(keys.publicKeyRaw), store.did);
});

test('kaydedilen dosya yalnizca sahibi tarafindan okunabilir (0600)', () => {
  const path = join(dir, 'perm.key.json');
  save(path, createIdentity());
  assert.ok(exists(path));
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('yuklenen dosyada DID ile public key uyusmali', () => {
  const path = join(dir, 'tamper.key.json');
  const store = createIdentity();
  save(path, store);
  assert.equal(load(path).did, store.did);

  // DID kurcalanirsa yukleme reddedilmeli.
  const other = createIdentity();
  save(path, { ...store, did: other.did });
  assert.throws(() => load(path), /uyusmuyor/);
});

test('nonce ayni odada kesin artar', () => {
  const store = createIdentity();
  let previous = 0n;
  for (let i = 0; i < 50; i++) {
    const nonce = BigInt(nextNonce(store, 'lobby'));
    assert.ok(nonce > previous, `${nonce} > ${previous} olmali`);
    previous = nonce;
  }
});

test('ayni milisaniyede bile nonce artar (saat cozunurlugu tuzagi)', () => {
  const store = createIdentity();
  const frozen = 1_756_000_000_000;
  const a = nextNonce(store, 'lobby', frozen);
  const b = nextNonce(store, 'lobby', frozen);
  const c = nextNonce(store, 'lobby', frozen);
  assert.equal(a, String(frozen));
  assert.equal(b, String(frozen + 1));
  assert.equal(c, String(frozen + 2));
});

test('nonce sayaclari odalara gore ayridir', () => {
  const store = createIdentity();
  const frozen = 1_756_000_000_000;
  assert.equal(nextNonce(store, 'lobby', frozen), String(frozen));
  // Protokol kurali oda basinadir; mb- odasi lobby den etkilenmemeli.
  assert.equal(nextNonce(store, 'mb-x', frozen), String(frozen));
});

test('nonce durumu diske yazilip geri okunur', () => {
  const path = join(dir, 'nonce.key.json');
  const store = createIdentity();
  const first = nextNonce(store, 'lobby', 1_756_000_000_000);
  save(path, store);

  const reloaded = load(path);
  assert.equal(reloaded.nonces.lobby, first);
  const second = nextNonce(reloaded, 'lobby', 1_756_000_000_000);
  assert.ok(BigInt(second) > BigInt(first), 'yeniden yukleme sonrasi da artmali');
});

test('19 hane siniri asilirsa hata verir', () => {
  const store = createIdentity();
  store.nonces.lobby = '9999999999999999999';
  assert.throws(() => nextNonce(store, 'lobby'), /19 haneyi asti/);
});

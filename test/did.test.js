import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  didFromPublicKey,
  fingerprint,
  generateKeyPair,
  privateKeyObjectFromRaw,
  publicKeyFromDid,
  rawPublicKey,
  shard,
} from '../src/did.js';
import { encode as base58encode } from '../src/base58.js';
import { NAME_PATTERN } from '../src/links.js';

// RFC 8032, Ed25519 Test Vector 1
const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const PUB_HEX = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const SEED = new Uint8Array(Buffer.from(SEED_HEX, 'hex'));
const PUB = new Uint8Array(Buffer.from(PUB_HEX, 'hex'));

test('RFC 8032 vektorunden did:key turetilir', () => {
  const did = didFromPublicKey(PUB);
  assert.ok(did.startsWith('did:key:z6Mk'), `beklenmeyen onek: ${did}`);
  assert.deepEqual(publicKeyFromDid(did), PUB, 'DID geri cozuldugunde ayni public key');
});

test('seed + public key ile kurulan KeyObject ayni public key i tasir', () => {
  const priv = privateKeyObjectFromRaw(SEED, PUB);
  const jwk = priv.export({ format: 'jwk' });
  assert.equal(jwk.crv, 'Ed25519');
  assert.equal(Buffer.from(jwk.x, 'base64url').toString('hex'), PUB_HEX);
});

test('uretilen anahtarlar round-trip yapar', () => {
  for (let i = 0; i < 25; i++) {
    const { publicKeyRaw, publicKey, seedRaw } = generateKeyPair();
    assert.equal(publicKeyRaw.length, 32);
    assert.equal(seedRaw.length, 32);
    assert.deepEqual(rawPublicKey(publicKey), publicKeyRaw);
    const did = didFromPublicKey(publicKeyRaw);
    assert.ok(did.startsWith('did:key:z6Mk'));
    assert.deepEqual(publicKeyFromDid(did), publicKeyRaw);
  }
});

test('bozuk DID ler reddedilir', () => {
  assert.throws(() => publicKeyFromDid('did:web:example.com'), /did:key:/);
  assert.throws(() => publicKeyFromDid('did:key:Q123'), /base58btc/);
  assert.throws(() => didFromPublicKey(new Uint8Array(31)), /32 bayt/);
});

test('ed25519 disi multicodec reddedilir', () => {
  // 0xec 0x01 = x25519-pub. Ayni bicim, farkli egri: kabul edilmemeli.
  const body = new Uint8Array(34);
  body[0] = 0xec;
  body[1] = 0x01;
  body.set(PUB, 2);
  assert.throws(() => publicKeyFromDid(`did:key:z${base58encode(body)}`), /ed25519-pub/);
});

test('yanlis uzunluktaki govde reddedilir', () => {
  const short = new Uint8Array(33);
  short[0] = 0xed;
  short[1] = 0x01;
  assert.throws(() => publicKeyFromDid(`did:key:z${base58encode(short)}`), /ed25519-pub/);
});

test('fingerprint = SHA-256(did) ilk 16 kucuk-harf hex', () => {
  const did = didFromPublicKey(PUB);
  const fp = fingerprint(did);
  assert.match(fp, /^[0-9a-f]{16}$/);
  // Sabit vektor: ayni DID her zaman ayni fingerprint i verir.
  assert.equal(fp, '0658808e85cc8317');
});

test('shard: /kv/did-<ilk2>/<kalan14>', () => {
  const { ns, key } = shard('0658808e85cc8317');
  assert.equal(ns, 'did-06');
  assert.equal(key, '58808e85cc8317');
  assert.equal(key.length, 14);
  // Her ikisi de protokolun isim desenine uymalidir.
  assert.ok(NAME_PATTERN.test(ns));
  assert.ok(NAME_PATTERN.test(key));
});

test('gecersiz fingerprint shard lanmaz', () => {
  assert.throws(() => shard('ABCDEF0123456789'), /kucuk-harf hex/);
  assert.throws(() => shard('0658'), /16/);
});

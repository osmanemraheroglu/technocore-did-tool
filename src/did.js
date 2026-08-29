/**
 * Ed25519 anahtar uretimi ve did:key turetimi.
 *
 * did:key kodlamasi:
 *   multicodec ed25519-pub = 0xed 0x01 (unsigned varint)
 *   govde  = 0xed 0x01 || <32 bayt ham public key>   (34 bayt)
 *   metin  = "did:key:" + "z" (multibase base58btc) + base58btc(govde)
 * Sonuc daima "did:key:z6Mk" ile baslar - 0xed01 oneki base58'de bu sabiti verir.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import * as base58 from './base58.js';

const MULTICODEC_ED25519_PUB = Uint8Array.of(0xed, 0x01);
const DID_PREFIX = 'did:key:';
const MULTIBASE_BASE58BTC = 'z';

/** Ham bayt -> base64url (padding'siz). */
export function toB64u(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

/** base64url -> ham bayt. */
export function fromB64u(str) {
  return new Uint8Array(Buffer.from(str, 'base64url'));
}

/**
 * Yeni bir Ed25519 anahtar cifti uretir. Uretim tamamen yereldir.
 * @returns {{ privateKey: import('node:crypto').KeyObject,
 *             publicKey: import('node:crypto').KeyObject,
 *             publicKeyRaw: Uint8Array, seedRaw: Uint8Array }}
 */
export function generateKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKey,
    publicKeyRaw: rawPublicKey(publicKey),
    seedRaw: rawSeed(privateKey),
  };
}

/** KeyObject -> 32 baytlik ham public key (JWK 'x' alani). */
export function rawPublicKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
    throw new Error('rawPublicKey: Ed25519 (OKP) anahtar bekleniyor');
  }
  return fromB64u(jwk.x);
}

/** KeyObject -> 32 baytlik ham private seed (JWK 'd' alani). */
export function rawSeed(privateKey) {
  const jwk = privateKey.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
    throw new Error('rawSeed: Ed25519 (OKP) anahtar bekleniyor');
  }
  return fromB64u(jwk.d);
}

/** 32 baytlik ham public key -> dogrulama icin KeyObject. */
export function publicKeyObjectFromRaw(publicKeyRaw) {
  assertLength(publicKeyRaw, 32, 'public key');
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: toB64u(publicKeyRaw) },
    format: 'jwk',
  });
}

/** 32 baytlik seed (+ public key) -> imzalama icin KeyObject. */
export function privateKeyObjectFromRaw(seedRaw, publicKeyRaw) {
  assertLength(seedRaw, 32, 'private seed');
  assertLength(publicKeyRaw, 32, 'public key');
  return createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: toB64u(seedRaw), x: toB64u(publicKeyRaw) },
    format: 'jwk',
  });
}

/**
 * 32 baytlik ham public key -> did:key metni.
 * @param {Uint8Array} publicKeyRaw
 * @returns {string} "did:key:z6Mk..."
 */
export function didFromPublicKey(publicKeyRaw) {
  assertLength(publicKeyRaw, 32, 'public key');
  const body = new Uint8Array(MULTICODEC_ED25519_PUB.length + publicKeyRaw.length);
  body.set(MULTICODEC_ED25519_PUB, 0);
  body.set(publicKeyRaw, MULTICODEC_ED25519_PUB.length);

  const did = DID_PREFIX + MULTIBASE_BASE58BTC + base58.encode(body);
  if (!did.startsWith('did:key:z6Mk')) {
    // ed25519-pub oneki base58btc'de her zaman "6Mk" sabitini verir; aksi hal bir hatadir.
    throw new Error(`didFromPublicKey: beklenmeyen DID onegi: ${did.slice(0, 16)}`);
  }
  return did;
}

/**
 * did:key metni -> 32 baytlik ham public key. Onek ve uzunluk dogrulanir.
 * @param {string} did
 * @returns {Uint8Array}
 */
export function publicKeyFromDid(did) {
  if (typeof did !== 'string' || !did.startsWith(DID_PREFIX)) {
    throw new Error('publicKeyFromDid: "did:key:" ile baslamali');
  }
  const multibase = did.slice(DID_PREFIX.length);
  if (!multibase.startsWith(MULTIBASE_BASE58BTC)) {
    throw new Error('publicKeyFromDid: yalnizca base58btc ("z") destekleniyor');
  }
  const body = base58.decode(multibase.slice(1));
  if (body.length !== 34 || body[0] !== 0xed || body[1] !== 0x01) {
    throw new Error('publicKeyFromDid: multicodec ed25519-pub (0xed 0x01) onegi bulunamadi');
  }
  return body.slice(2);
}

/**
 * Fingerprint = did:key metninin SHA-256'sinin ilk 16 kucuk-harf hex karakteri.
 * @param {string} did
 * @returns {string} 16 hex karakter
 */
export function fingerprint(did) {
  if (typeof did !== 'string' || did.length === 0) {
    throw new Error('fingerprint: did metni bekleniyor');
  }
  return createHash('sha256').update(did, 'utf8').digest('hex').slice(0, 16).toLowerCase();
}

/**
 * Fingerprint'i not adresine bolusturur: /kv/did-<ilk2>/<kalan14>
 * @param {string} fp 16 hex karakter
 * @returns {{ ns: string, key: string }}
 */
export function shard(fp) {
  if (!/^[0-9a-f]{16}$/.test(fp)) {
    throw new Error('shard: 16 kucuk-harf hex karakter bekleniyor');
  }
  return { ns: `did-${fp.slice(0, 2)}`, key: fp.slice(2) };
}

function assertLength(bytes, expected, label) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== expected) {
    throw new Error(`${label}: ${expected} bayt bekleniyor, ${bytes?.length} bulundu`);
  }
}

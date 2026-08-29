/**
 * Yerel anahtar deposu.
 *
 * Private key BU MAKINEDEN CIKMAZ. Dosya 0600 izniyle yazilir ve .gitignore
 * tarafindan kapsanir. Nonce durumu da burada tutulur: her oda icin en son
 * kullanilan nonce saklanip bir sonraki kesin buyuk secilir.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  didFromPublicKey,
  fingerprint,
  fromB64u,
  generateKeyPair,
  publicKeyFromDid,
  toB64u,
} from './did.js';
import { assertNonce } from './sign.js';

export const DEFAULT_KEYFILE = 'secret.key.json';
const MAX_NONCE = 9_999_999_999_999_999_999n; // 19 hane

/**
 * Yeni kimlik uretir ve keystore nesnesini dondurur (henuz diske yazmaz).
 */
export function createIdentity() {
  const { publicKeyRaw, seedRaw } = generateKeyPair();
  const did = didFromPublicKey(publicKeyRaw);

  // Kendi kendini denetle: DID'den geri cozulen public key uretilenle ayni mi?
  const roundTrip = publicKeyFromDid(did);
  if (Buffer.compare(Buffer.from(roundTrip), Buffer.from(publicKeyRaw)) !== 0) {
    throw new Error('createIdentity: DID round-trip basarisiz - anahtar kullanilmamali');
  }

  return {
    version: 1,
    algorithm: 'Ed25519',
    createdAt: new Date().toISOString(),
    did,
    fingerprint: fingerprint(did),
    publicKeyB64u: toB64u(publicKeyRaw),
    privateKeySeedB64u: toB64u(seedRaw),
    nonces: {},
  };
}

/** Keystore nesnesinden imzalama icin ham anahtarlari cikarir. */
export function keysOf(store) {
  return {
    seedRaw: fromB64u(store.privateKeySeedB64u),
    publicKeyRaw: fromB64u(store.publicKeyB64u),
  };
}

export function load(path) {
  const store = JSON.parse(readFileSync(path, 'utf8'));
  if (store.algorithm !== 'Ed25519' || !store.privateKeySeedB64u) {
    throw new Error(`${path}: gecerli bir Ed25519 keystore degil`);
  }
  if (!store.nonces) store.nonces = {};

  // Dosyadaki DID gercekten dosyadaki public key'e mi ait? (kurcalama kontrolu)
  const expected = didFromPublicKey(fromB64u(store.publicKeyB64u));
  if (store.did !== expected) {
    throw new Error(`${path}: DID dosyadaki public key ile uyusmuyor`);
  }
  return store;
}

/** 0600 izniyle yazar - yalnizca sahibi okuyabilir. */
export function save(path, store) {
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

export function exists(path) {
  return existsSync(path);
}

/**
 * Bir oda icin bir sonraki nonce'u secer ve durumu gunceller.
 *
 * Milisaniye zaman damgasi kullanilir; ancak ayni milisaniyede iki mesaj
 * uretilirse zaman damgasi tek basina artmayacagi icin son+1'e yukseltilir.
 * Boylece "o anahtarin o odada kullandigi son nonce'tan buyuk" kurali
 * saat cozunurlugunden bagimsiz garanti edilir.
 *
 * @param {object} store
 * @param {string} room
 * @param {number} [now] test edilebilirlik icin enjekte edilebilir saat
 * @returns {string} nonce (ondalik metin)
 */
export function nextNonce(store, room, now = Date.now()) {
  const last = BigInt(store.nonces?.[room] ?? 0);
  let candidate = BigInt(now);
  if (candidate <= last) candidate = last + 1n;
  if (candidate > MAX_NONCE) {
    throw new Error('nextNonce: nonce 19 haneyi asti');
  }
  const nonce = assertNonce(candidate.toString());
  store.nonces[room] = nonce;
  return nonce;
}

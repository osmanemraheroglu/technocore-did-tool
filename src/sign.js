/**
 * Technocore imzalama kurallari (auth.md / llms.txt).
 *
 * Imzalanan dize TAM OLARAK sudur:   <room>|<nonce>|<text>
 * UTF-8 olarak, <text> = SUPURULMUS metin. seq ve ts bilerek imzalanmaz.
 * Imza base64url, padding'siz, tam 86 karakter.
 *
 * Sunucu normalize etmez: imzaladigin baytlarin AYNISI gonderilmelidir.
 */

import { sign as edSign, verify as edVerify } from 'node:crypto';
import { privateKeyObjectFromRaw, publicKeyFromDid, publicKeyObjectFromRaw } from './did.js';
import { isSwept } from './sweep.js';

export const SIGNATURE_LENGTH = 86; // 64 bayt -> base64url, padding'siz
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const NONCE = /^[1-9][0-9]{0,18}$/; // 1-19 hane, bastan sifir yok

/**
 * Imzalanacak kanonik dizeyi kurar.
 * @param {string} room
 * @param {string|number} nonce
 * @param {string} sweptText supurulmus metin
 * @returns {string}
 */
export function canonical(room, nonce, sweptText) {
  assertNonce(nonce);
  if (!isSwept(sweptText)) {
    // Sessizce supurmek yerine hata veriyoruz: cagiran taraf hangi baytlari
    // imzaladigini bilerek gecmeli, yoksa link ile imza ayrisir.
    throw new Error('canonical: metin supurulmus olmali (once sweep() cagirin)');
  }
  return `${room}|${nonce}|${sweptText}`;
}

/**
 * @param {{seedRaw: Uint8Array, publicKeyRaw: Uint8Array}} keys
 * @param {string} room
 * @param {string|number} nonce
 * @param {string} sweptText
 * @returns {string} base64url imza (86 karakter)
 */
export function signMessage(keys, room, nonce, sweptText) {
  const message = Buffer.from(canonical(room, nonce, sweptText), 'utf8');
  const privateKey = privateKeyObjectFromRaw(keys.seedRaw, keys.publicKeyRaw);
  const sig = edSign(null, message, privateKey).toString('base64url');
  if (sig.length !== SIGNATURE_LENGTH) {
    throw new Error(`signMessage: imza ${SIGNATURE_LENGTH} karakter olmali, ${sig.length} uretildi`);
  }
  return sig;
}

/**
 * Imzayi DID'in kendisinden cozulen public key ile dogrular.
 * @returns {boolean}
 */
export function verifyMessage(did, sig, room, nonce, sweptText) {
  if (typeof sig !== 'string' || sig.length !== SIGNATURE_LENGTH || !BASE64URL.test(sig)) {
    return false;
  }
  let publicKey;
  try {
    publicKey = publicKeyObjectFromRaw(publicKeyFromDid(did));
  } catch {
    return false;
  }
  const message = Buffer.from(canonical(room, nonce, sweptText), 'utf8');
  return edVerify(null, message, publicKey, Buffer.from(sig, 'base64url'));
}

export function assertNonce(nonce) {
  const s = String(nonce);
  if (!NONCE.test(s)) {
    throw new Error(`nonce gecersiz: 1-19 haneli pozitif tamsayi olmali (alinan: ${s})`);
  }
  return s;
}

export const noncePattern = NONCE;
export const base64urlPattern = BASE64URL;

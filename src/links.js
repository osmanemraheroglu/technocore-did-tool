/**
 * Technocore GET link ureticileri.
 *
 * Bu modul ag'a CIKMAZ - yalnizca metin uretir. Linkleri kullanici kendisi acar.
 */

import { SIGNATURE_LENGTH, assertNonce, base64urlPattern } from './sign.js';

export const BASE_URL = 'https://technocore.chat';
export const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const MAX_MESSAGE_CHARS = 4096;
export const MAX_NOTE_CHARS = 8192;

/**
 * Sıkı yuzde-kodlama: RFC 3986 "unreserved" disindaki HER SEY kodlanir.
 * encodeURIComponent !'()* karakterlerini biraktigi icin yetmiyor; bosluk
 * daima %20 olmali ve hicbir karakter path ayraciyla karisamamali.
 */
export function encodeSegment(value) {
  return [...String(value)]
    .map((ch) =>
      /[A-Za-z0-9\-._~]/.test(ch)
        ? ch
        : [...Buffer.from(ch, 'utf8')]
            .map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`)
            .join(''),
    )
    .join('');
}

/** Oda / nick / kv anahtar adi dogrulamasi. */
export function assertName(name, label = 'isim') {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `${label} gecersiz: "${name}" - ^[a-z0-9][a-z0-9_-]{0,47}$ desenine uymali ` +
        '(kucuk harf/rakamla baslamali, en fazla 48 karakter, tire ve alt tire serbest)',
    );
  }
  return name;
}

/** Serbest metni gecerli bir oda/nick adina cevirir. */
export function slugify(input) {
  const slug = String(input)
    // Turkce harfler once eslenmelidir: NFKD onlari birlestirici isaretlere
    // ayirir ve "I".toLowerCase() bir birlestirici nokta uretir.
    .replace(/[ıİ]/g, 'i')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[şŞ]/g, 's')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // kalan birlestirici isaretleri at, tireye cevirme
    .replace(/[^a-z0-9_]+/g, '-') // alt tire protokolde gecerli, korunur
    .replace(/^[-_]+/, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  if (!NAME_PATTERN.test(slug)) {
    throw new Error(`"${input}" gecerli bir ada donusturulemedi`);
  }
  return slug;
}

function assertSignature(sig) {
  if (typeof sig !== 'string' || sig.length !== SIGNATURE_LENGTH || !base64urlPattern.test(sig)) {
    throw new Error(`imza gecersiz: ${SIGNATURE_LENGTH} karakterlik base64url olmali`);
  }
  return sig;
}

function assertDid(did) {
  if (typeof did !== 'string' || !did.startsWith('did:key:z6Mk')) {
    throw new Error(`did gecersiz: "did:key:z6Mk..." bekleniyor (alinan: ${did})`);
  }
  return did;
}

export function assertMessageLength(text) {
  if (text.length > MAX_MESSAGE_CHARS) {
    throw new Error(`mesaj ${MAX_MESSAGE_CHARS} karakteri asiyor (${text.length})`);
  }
  return text;
}

export function assertNoteLength(value) {
  if (value.length > MAX_NOTE_CHARS) {
    throw new Error(`not degeri ${MAX_NOTE_CHARS} karakteri asiyor (${value.length})`);
  }
  return value;
}

/**
 * Imzali mesaj linki:
 *   /r/<room>/say-signed/<did>/<sig>/<nonce>/<encoded text>
 *
 * DID ve imza kodlanmaz: ikisi de zaten URL-guvenli karakterlerden olusur
 * (":" bir path segmentinde gecerlidir ve protokol ornekleri ham birakir).
 */
export function saySignedUrl({ room, did, sig, nonce, text }) {
  assertName(room, 'oda adi');
  assertDid(did);
  assertSignature(sig);
  assertNonce(nonce);
  assertMessageLength(text);
  return `${BASE_URL}/r/${room}/say-signed/${did}/${sig}/${nonce}/${encodeSegment(text)}`;
}

/**
 * DID profil notu (imzasiz, dunyaya-acik):
 *   /kv/did-<ilk2hex>/<kalan14hex>/set/<encoded value>
 */
export function didNoteUrl({ ns, key, value }) {
  assertName(ns, 'not alan adi');
  assertName(key, 'not anahtari');
  assertNoteLength(value);
  return `${BASE_URL}/kv/${ns}/${key}/set/${encodeSegment(value)}`;
}

/** Bir odayi okuma linki (kolaylik icin). */
export function roomUrl(room) {
  assertName(room, 'oda adi');
  return `${BASE_URL}/r/${room}`;
}

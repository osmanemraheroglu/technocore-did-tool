/**
 * base58btc (Bitcoin alfabesi) kodlayici/cozucu.
 *
 * multibase 'z' onekinin arkasindaki kodlama budur. BigInt kullanmadan,
 * klasik "byte dizisi uzerinde tabandan tabana bolme" yontemiyle calisir;
 * girdi uzunlugu sabit 34 bayt oldugundan bu fazlasiyla hizli.
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Karakter -> deger tablosu (alfabe disi = undefined). */
const LOOKUP = new Map([...ALPHABET].map((ch, i) => [ch, i]));

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encode(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('base58.encode: Uint8Array bekleniyor');
  }
  if (bytes.length === 0) return '';

  // Bastaki her sifir bayti, cikista bir '1' karakterine karsilik gelir.
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;

  // 256 tabanindan 58 tabanina tekrarli bolme.
  // Dizi BOS baslar: [0] ile baslamak, govdesi tamamen sifir olan bir girdide
  // bastaki sifirlara ek olarak sahte bir '1' basamagi uretirdi.
  const digits = [];
  for (let i = leadingZeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '1'.repeat(leadingZeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export function decode(str) {
  if (typeof str !== 'string') {
    throw new TypeError('base58.decode: string bekleniyor');
  }
  if (str.length === 0) return new Uint8Array(0);

  let leadingOnes = 0;
  while (leadingOnes < str.length && str[leadingOnes] === '1') leadingOnes++;

  // encode() ile ayni gerekce: bos baslar, aksi halde '1' onekleri fazladan
  // bir sifir bayti uretirdi.
  const bytes = [];
  for (let i = leadingOnes; i < str.length; i++) {
    const value = LOOKUP.get(str[i]);
    if (value === undefined) {
      throw new Error(`base58.decode: gecersiz karakter ${JSON.stringify(str[i])} (konum ${i})`);
    }
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(leadingOnes + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[leadingOnes + i] = bytes[bytes.length - 1 - i];
  return out;
}

export const alphabet = ALPHABET;

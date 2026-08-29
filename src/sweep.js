/**
 * "Tek satir supurmesi" - Technocore'un depolama oncesi kanoniklestirmesi.
 *
 * llms.txt: "Every character in Unicode general categories Cc, Cf, Cs, Co, Zl
 * and Zp is replaced with a space before storage, then the ends are trimmed."
 *
 * Imza HAM metne degil, SUPURULMUS metne atilir - kayit boylece yeniden
 * dogrulanabilir kalir.
 */

// Cc: C0/C1 kontrol, Cf: format (ZWSP, ZWJ, BOM, yon isaretleri),
// Cs: eslesmemis vekil, Co: ozel kullanim, Zl/Zp: U+2028 / U+2029.
const SWEEPABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;

/**
 * @param {string} text
 * @returns {string} supurulmus metin
 */
export function sweep(text) {
  if (typeof text !== 'string') {
    throw new TypeError('sweep: string bekleniyor');
  }
  // Sira onemli: once degistir, SONRA uclari kirp. Ters sirada, sonda kalan
  // bir kontrol karakteri bosluga donusup kirpilmadan kalirdi.
  return text.replace(SWEEPABLE, ' ').trim();
}

/** Metin supurmeden gecer mi (yani zaten kanonik mi)? */
export function isSwept(text) {
  return sweep(text) === text;
}

export const sweepablePattern = SWEEPABLE;

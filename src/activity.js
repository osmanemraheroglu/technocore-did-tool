/**
 * "activity" komutunun cekirdegi: bir did:key'in Technocore'da gorunen
 * mesajlarini toplar.
 *
 * YALNIZCA OKUMA. Bu modul hicbir imza atmaz, hicbir yazma istegi yapmaz ve
 * hicbir gizli veriyi ag'a vermez - sadece herkese acik GET istekleri.
 *
 * Ag'a dokunan fonksiyonlar `fetchImpl` alir; boylece ayristirma ve
 * sayfalama mantigi ag olmadan test edilebilir.
 */

import { fingerprint, shard } from './did.js';
import { NAME_PATTERN, assertName } from './links.js';

export const DEFAULT_BASE = 'https://technocore.chat';
export const PAGE_LIMIT = 200; // sunucunun izin verdigi en buyuk dilim
// Muhafazakar varsayilan: 5 sayfa x 200 = ~1000 mesaj.
// Sunucunun IP basina okuma kotasi var ve her sayfa 3 denemeye kadar
// tekrarlanabiliyor; derin tarama isteyen --max-pages ile yukseltir.
export const DEFAULT_MAX_PAGES = 5;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRIES = 3; // toplam deneme sayisi (ilk istek dahil)
export const DEFAULT_BACKOFF_MS = 500; // 500ms -> 1s -> 2s ustel geri cekilme

/** Ag hatalarini CLI'da yigin izi basmadan sunabilmek icin ayri tur. */
export class NetworkError extends Error {
  constructor(message, { cause, status } = {}) {
    super(message, { cause });
    this.name = 'NetworkError';
    this.status = status;
  }
}

// --- saf yardimcilar (ag yok) ----------------------------------------------

/**
 * Bir oda beslemesi URL'si kurar.
 * @param {string} room
 * @param {{since?: number, limit?: number, base?: string}} [opts]
 */
export function feedUrl(room, { since, limit = PAGE_LIMIT, base = DEFAULT_BASE } = {}) {
  assertName(room, 'oda adi');
  const params = new URLSearchParams({ format: 'json', limit: String(limit) });
  if (Number.isInteger(since) && since >= 0) params.set('since', String(since));
  return `${base}/r/${room}?${params.toString()}`;
}

/** DID profil notunun URL'si (okuma). */
export function noteUrl(did, { base = DEFAULT_BASE } = {}) {
  const { ns, key } = shard(fingerprint(did));
  return `${base}/kv/${ns}/${key}`;
}

/**
 * Sunucu zarfini dogrular ve normalize eder.
 * Beklenen bicim: { room, count, first_seq, last_seq, messages: [...] }
 */
export function parseFeed(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('besleme ayristirilamadi: nesne bekleniyordu');
  }
  if (!Array.isArray(payload.messages)) {
    throw new Error('besleme ayristirilamadi: "messages" dizisi yok');
  }
  const messages = payload.messages
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      seq: Number.isFinite(m.seq) ? m.seq : null,
      ts: typeof m.ts === 'string' ? m.ts : '',
      from: typeof m.from === 'string' ? m.from : '',
      text: typeof m.text === 'string' ? m.text : '',
      // nonce yalnizca imzali mesajlarda bulunur; varligi imzali olduguna isarettir.
      nonce: m.nonce ?? null,
      signed: m.nonce !== undefined && m.nonce !== null,
    }));

  return {
    room: typeof payload.room === 'string' ? payload.room : '',
    count: Number.isFinite(payload.count) ? payload.count : messages.length,
    firstSeq: Number.isFinite(payload.first_seq) ? payload.first_seq : null,
    lastSeq: Number.isFinite(payload.last_seq) ? payload.last_seq : null,
    messages,
  };
}

/**
 * "from" alani verilen DID ile birebir eslesen mesajlar.
 *
 * Sunucu <nick> alanini dogrulamaz ("herkes herkes adina yazabilir"), ancak
 * from bir did:key ise mesaj imzali demektir. Yine de tam esitlik ariyoruz:
 * benzer gorunen bir DID baska bir anahtardir.
 */
export function filterByDid(messages, did) {
  if (typeof did !== 'string' || !did.startsWith('did:key:')) {
    throw new Error(`gecersiz did: ${did}`);
  }
  return messages.filter((m) => m.from === did);
}

/**
 * DID profil notundan mailbox oda adini cikarir.
 *
 * DIKKAT: not degeri GUVENILMEZ girdidir - kv alanlari dunyaya aciktir ve
 * oraya herkes yazabilir. Cikan ad, URL'de kullanilmadan once protokolun
 * isim desenine ve "mb-" onegine karsi dogrulanir.
 *
 * @param {string} noteText ham yanit govdesi (sunucunun uyari banner'i dahil)
 * @returns {string|null}
 */
export function extractMailbox(noteText) {
  if (typeof noteText !== 'string') return null;
  const match = noteText.match(/(?:^|\s)mailbox:(\S+)/);
  if (!match) return null;
  const room = match[1];
  if (!room.startsWith('mb-') || !NAME_PATTERN.test(room)) return null;
  return room;
}

/** ts alanini okunakli hale getirir; bicim taninmazsa oldugu gibi birakir. */
export function formatTimestamp(ts) {
  if (typeof ts !== 'string' || !ts) return '?';
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return ts;
  return parsed.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

/** Tek bir mesaji ekrana yazilacak bicime getirir. */
export function formatMessage(message, { room }) {
  const seq = message.seq === null ? '?' : String(message.seq);
  const flag = message.signed ? 'imzali' : 'imzasiz';
  return [
    `  [${room} #${seq}]  ${formatTimestamp(message.ts)}  (${flag})`,
    `    ${message.text}`,
  ].join('\n');
}

// --- ag (yalnizca GET) ------------------------------------------------------

/** Ustel geri cekilme beklemesi; testlerde enjekte edilebilir. */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Govde gecerli bir oda beslemesi mi? (503 + saglam veri durumunu ayirt eder) */
export function isParsableFeed(body) {
  try {
    parseFeed(JSON.parse(body));
    return true;
  } catch {
    return false;
  }
}

/**
 * Tek bir GET istegi; ham sonucu dondurur (durum + govde).
 *
 * Govdeyi durum kodundan BAGIMSIZ olarak dondurur, cunku technocore.chat
 * asiri yuk altinda 503 ile birlikte gecerli JSON servis edebiliyor.
 *
 * Yeniden deneme: yalnizca 5xx ve ag hatalarinda, ustel geri cekilmeyle.
 * 4xx KALICI kabul edilir ve asla tekrarlanmaz - istek bicimi yanlistir,
 * tekrar etmek yalnizca okuma kotasini tuketir.
 *
 * `shouldRetry(sonuc)` verilirse 5xx karari ona birakilir; fetchFeedPage bunu
 * "govde zaten gecerli veri tasiyorsa tekrar deneme" demek icin kullanir.
 */
export async function fetchRaw(
  url,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    retries = DEFAULT_RETRIES,
    backoffMs = DEFAULT_BACKOFF_MS,
    shouldRetry,
    sleep = defaultSleep,
  } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new NetworkError('bu Node surumunde fetch bulunamadi (Node 20+ gerekir)');
  }

  const attempts = Math.max(1, retries);
  let lastError = null;
  let lastResult = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      // 500ms, 1s, 2s ...
      await sleep(backoffMs * 2 ** (attempt - 2));
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json, text/plain' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Ag hatasi ve zaman asimi gecici kabul edilir: tekrar denenir.
      lastError = err;
      lastResult = null;
      continue;
    }

    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }

    const result = { ok: response.ok, status: response.status, body, url, attempts: attempt };
    lastResult = result;
    lastError = null;

    if (result.ok) return result;
    if (result.status < 500) return result; // 4xx kalicidir, tekrar yok

    // 5xx: cagiran taraf "govde zaten kullanilabilir" diyebilir.
    const retryable = shouldRetry ? shouldRetry(result) : true;
    if (!retryable) return result;
  }

  if (lastResult) return lastResult; // tum denemeler 5xx ile bitti
  const reason =
    lastError?.name === 'TimeoutError' || lastError?.name === 'AbortError'
      ? `sunucu ${timeoutMs} ms icinde yanit vermedi`
      : 'sunucuya ulasilamadi (baglanti yok veya DNS hatasi)';
  throw new NetworkError(`${reason} (${attempts} deneme): ${url}`, { cause: lastError });
}

/** Govdesi onemsenmeyen okumalar icin: hata durumunda firlatir. */
export async function fetchText(url, { allow404 = false, ...rest } = {}) {
  const res = await fetchRaw(url, rest);
  if (res.status === 404 && allow404) return null;
  if (res.status === 429) {
    throw new NetworkError('okuma kotasi doldu (429) - biraz bekleyip tekrar deneyin', {
      status: 429,
    });
  }
  if (!res.ok) {
    throw new NetworkError(`sunucu ${res.status} dondurdu: ${url}`, { status: res.status });
  }
  return res.body;
}

/**
 * Bir sayfalik besleme ceker ve ayristirir.
 *
 * Durum kodu ne olursa olsun govdeyi ayristirmayi dener: sunucu bozulmus modda
 * (503) gecerli veri dondurebiliyor. Ayristirilamazsa HTTP hatasi bildirilir.
 */
export async function fetchFeedPage(room, { since, limit, base, ...rest } = {}) {
  const res = await fetchRaw(feedUrl(room, { since, limit, base }), {
    ...rest,
    // 503 + gecerli JSON geldiyse veri elimizde: tekrar denemek bosuna.
    shouldRetry: (r) => !isParsableFeed(r.body),
  });
  if (res.status === 429) {
    throw new NetworkError('okuma kotasi doldu (429) - biraz bekleyip tekrar deneyin', {
      status: 429,
    });
  }
  let payload;
  try {
    payload = JSON.parse(res.body);
  } catch (err) {
    if (!res.ok) {
      throw new NetworkError(
        `sunucu ${res.status} dondurdu (${res.attempts} deneme): ${res.url}`,
        { status: res.status, cause: err },
      );
    }
    throw new NetworkError(`${room}: sunucu gecerli JSON dondurmedi`, { cause: err });
  }
  const feed = parseFeed(payload);
  // Veriyi kullaniyoruz ama saglikli olmayan durumu gizlemiyoruz.
  feed.degradedStatus = res.ok ? null : res.status;
  return feed;
}

/**
 * Odanin son mesajlarindan geriye dogru tarar.
 *
 * `since` ILERI yonludur ("greater seq"), yani dogrudan geriye sayfalanamaz.
 * Ama pencereyi hesaplayabiliriz: `since=E-limit-1` istegi, E'den onceki
 * `limit` mesaji dondurur. Ilk sayfa `since` olmadan alinir; sunucu en yeni
 * dilimi verir.
 *
 * Neden ileri degil de geriye: lobby'de last_seq milyonlarca olabiliyor ve
 * halkanin basindan yurumek hem cok istek hem zaman asimi demek. Kullanicinin
 * aradigi da "son etkinlik".
 *
 * @returns {{messages, pages, truncated, lastSeq, earliestSeq, degradedStatus}}
 */
export async function readRoom(room, { maxPages = DEFAULT_MAX_PAGES, limit = PAGE_LIMIT, ...rest } = {}) {
  const collected = [];
  const seen = new Set();
  let pages = 0;
  let lastSeq = null;
  let earliest = null;
  let truncated = false;
  let degradedStatus = null;

  for (;;) {
    // Once dogal bitis: odanin basina ulastiysak tarama TAMAMLANMISTIR.
    // Bu kontrol sayfa sinirindan once gelmeli, yoksa tam biten bir tarama
    // yanlislikla "kesildi" diye isaretlenir.
    if (earliest !== null && earliest <= 1) break;

    if (pages >= maxPages) {
      truncated = true;
      break;
    }

    // Ilk sayfa: since yok -> sunucu en yeni dilimi verir.
    // Sonraki sayfalar: simdiye kadarki en eski seq'ten onceki pencere.
    const since = earliest === null ? undefined : Math.max(0, earliest - limit - 1);

    const page = await fetchFeedPage(room, { since, limit, ...rest });
    pages++;
    lastSeq = lastSeq ?? page.lastSeq;
    degradedStatus = degradedStatus ?? page.degradedStatus;
    if (page.messages.length === 0) break;

    let fresh = 0;
    let pageMin = null;
    for (const message of page.messages) {
      if (message.seq !== null) {
        if (seen.has(message.seq)) continue;
        seen.add(message.seq);
        pageMin = pageMin === null ? message.seq : Math.min(pageMin, message.seq);
      }
      collected.push(message);
      fresh++;
    }
    // Yeni bir sey gelmediyse dur: sunucu ayni pencereyi tekrarliyor olabilir.
    if (fresh === 0 || pageMin === null) break;
    if (earliest !== null && pageMin >= earliest) break; // geriye ilerleme yok
    earliest = pageMin;
  }

  // Eskiden yeniye sirala: sunucu sayfalari eskiden yeniye verir ama biz
  // pencereleri tersten topladik.
  collected.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return { messages: collected, pages, truncated, lastSeq, earliestSeq: earliest, degradedStatus };
}

/**
 * DID profil notunu okur ve mailbox odasini dondurur (yoksa null).
 *
 * Govde durum kodundan bagimsiz taranir; extractMailbox zaten kati dogrulama
 * yaptigi icin bir hata sayfasindan yanlislikla oda adi cikmaz.
 */
export async function discoverMailbox(did, { base = DEFAULT_BASE, ...rest } = {}) {
  const res = await fetchRaw(noteUrl(did, { base }), {
    ...rest,
    shouldRetry: (r) => extractMailbox(r.body) === null,
  });
  if (res.status === 404) return null;
  const mailbox = extractMailbox(res.body);
  if (mailbox) return mailbox;
  if (!res.ok) {
    throw new NetworkError(`sunucu ${res.status} dondurdu (${res.attempts} deneme): ${res.url}`, {
      status: res.status,
    });
  }
  return null;
}

/**
 * Bir DID'in gorunur etkinligini toplar.
 *
 * @param {{did: string, rooms?: string[], includeMailbox?: boolean}} opts
 * @returns {{did, rooms: Array<{room, matched, scanned, truncated, error}>, total}}
 */
export async function collectActivity({
  did,
  rooms = ['lobby'],
  includeMailbox = true,
  ...rest
}) {
  const targets = [...rooms];

  let mailbox = null;
  let mailboxError = null;
  if (includeMailbox) {
    try {
      mailbox = await discoverMailbox(did, rest);
      if (mailbox && !targets.includes(mailbox)) targets.push(mailbox);
    } catch (err) {
      // Not okunamazsa etkinlik taramasi yine de surmeli.
      mailboxError = err.message;
    }
  }

  const results = [];
  for (const room of targets) {
    try {
      const { messages, truncated, degradedStatus } = await readRoom(room, rest);
      results.push({
        room,
        matched: filterByDid(messages, did),
        scanned: messages.length,
        truncated,
        degradedStatus,
        error: null,
      });
    } catch (err) {
      results.push({
        room,
        matched: [],
        scanned: 0,
        truncated: false,
        degradedStatus: null,
        error: err.message,
      });
    }
  }

  return {
    did,
    mailbox,
    mailboxError,
    rooms: results,
    total: results.reduce((sum, r) => sum + r.matched.length, 0),
  };
}

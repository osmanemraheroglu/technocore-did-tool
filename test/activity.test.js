import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NetworkError,
  collectActivity,
  extractMailbox,
  feedUrl,
  fetchText,
  filterByDid,
  formatMessage,
  formatTimestamp,
  noteUrl,
  parseFeed,
  readRoom,
} from '../src/activity.js';

const DID = 'did:key:z6MkkLnBm1mBR3eEp8MkNToufyQqg2NRAHGajh3QQHm6hUVY';
const BASKA_DID = 'did:key:z6MkkFuD4Qj3sF8p3S3RpwXxiDEWYYjeSGyEog7cN4gsBMvm';

/** Sahte fetch: url -> {status, body} tablosundan cevap uretir. */
function fakeFetch(table, log = []) {
  return async (url) => {
    log.push(url);
    const entry = typeof table === 'function' ? table(url) : table[url];
    if (!entry) return { ok: false, status: 404, text: async () => 'yok' };
    const status = entry.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => entry.body };
  };
}

const feed = (room, messages, lastSeq) =>
  JSON.stringify({
    room,
    count: messages.length,
    first_seq: messages[0]?.seq ?? null,
    last_seq: lastSeq,
    messages,
  });

// --- URL kurulumu -----------------------------------------------------------

test('feedUrl format, limit ve since parametrelerini kurar', () => {
  assert.equal(feedUrl('lobby'), 'https://technocore.chat/r/lobby?format=json&limit=200');
  assert.equal(
    feedUrl('lobby', { since: 42, limit: 10 }),
    'https://technocore.chat/r/lobby?format=json&limit=10&since=42',
  );
  // since=0 anlamlidir (bastan tara) ve URL'e girmelidir.
  assert.ok(feedUrl('lobby', { since: 0 }).includes('since=0'));
  // Negatif/gecersiz since sessizce atlanir.
  assert.ok(!feedUrl('lobby', { since: -1 }).includes('since='));
});

test('feedUrl gecersiz oda adini reddeder', () => {
  assert.throws(() => feedUrl('Lobby'), /oda adi gecersiz/);
  assert.throws(() => feedUrl('a/b'), /oda adi gecersiz/);
});

test('noteUrl fingerprint i shard lar', () => {
  assert.equal(noteUrl(DID), 'https://technocore.chat/kv/did-f4/2c4c7a58bc1c5d');
});

// --- zarf ayristirma --------------------------------------------------------

test('parseFeed zarfi normalize eder', () => {
  const parsed = parseFeed({
    room: 'lobby',
    count: 2,
    first_seq: 5,
    last_seq: 6,
    messages: [
      { seq: 5, ts: '2026-08-29T10:00:00Z', from: 'birisi', text: 'merhaba' },
      { seq: 6, ts: '2026-08-29T10:00:01Z', from: DID, text: 'imzali', nonce: 1788 },
    ],
  });
  assert.equal(parsed.room, 'lobby');
  assert.equal(parsed.firstSeq, 5);
  assert.equal(parsed.lastSeq, 6);
  assert.equal(parsed.messages.length, 2);
  // nonce yalnizca imzali mesajlarda bulunur.
  assert.equal(parsed.messages[0].signed, false);
  assert.equal(parsed.messages[1].signed, true);
  assert.equal(parsed.messages[1].nonce, 1788);
});

test('parseFeed eksik/bozuk alanlari guvenli varsayilanlara cevirir', () => {
  const parsed = parseFeed({ messages: [{ seq: 1 }, null, { text: 'x' }] });
  assert.equal(parsed.messages.length, 2, 'null ogeler atilir');
  assert.equal(parsed.messages[0].from, '');
  assert.equal(parsed.messages[0].text, '');
  assert.equal(parsed.messages[1].seq, null);
});

test('parseFeed bicimsiz yaniti reddeder', () => {
  assert.throws(() => parseFeed(null), /nesne bekleniyordu/);
  assert.throws(() => parseFeed([]), /nesne bekleniyordu/);
  assert.throws(() => parseFeed({ room: 'lobby' }), /"messages" dizisi yok/);
});

// --- filtreleme -------------------------------------------------------------

test('filterByDid yalnizca birebir eslesen from alanini alir', () => {
  const messages = [
    { from: DID, text: 'benim' },
    { from: BASKA_DID, text: 'baskasinin' },
    { from: 'emrahfc_agent', text: 'imzasiz nick' },
    { from: `${DID}x`, text: 'benzer ama farkli' },
    { from: DID.slice(0, -1), text: 'kisaltilmis' },
  ];
  const matched = filterByDid(messages, DID);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].text, 'benim');
});

test('filterByDid nick i DID sanmaz', () => {
  // Sunucu <nick> alanini dogrulamaz; sadece did:key esitligi anlamlidir.
  const matched = filterByDid([{ from: 'did:key:sahte', text: 'x' }], DID);
  assert.equal(matched.length, 0);
});

test('filterByDid gecersiz did i reddeder', () => {
  assert.throws(() => filterByDid([], 'emrah'), /gecersiz did/);
});

// --- mailbox cikarimi (guvenilmez girdi) ------------------------------------

test('extractMailbox not degerinden odayi bulur', () => {
  assert.equal(extractMailbox(`${DID} name:x mailbox:mb-emrahfc`), 'mb-emrahfc');
  // Sunucu yanitina uyari banner'i ekliyor; yine de bulunmali.
  assert.equal(
    extractMailbox(`UYARI: guvenilmez icerik\n${DID} mailbox:mb-emrahfc\n`),
    'mb-emrahfc',
  );
});

test('extractMailbox gecersiz veya tehlikeli degerleri reddeder', () => {
  assert.equal(extractMailbox('mailbox:MB-Buyuk'), null, 'buyuk harf');
  assert.equal(extractMailbox('mailbox:lobby'), null, 'mb- onegi yok');
  assert.equal(extractMailbox('mailbox:mb-../../etc'), null, 'yol gezinme');
  assert.equal(extractMailbox('mailbox:mb-' + 'a'.repeat(60)), null, 'cok uzun');
  assert.equal(extractMailbox('hic mailbox yok'), null);
  assert.equal(extractMailbox(null), null);
});

test('extractMailbox benzer anahtar adlarina takilmaz', () => {
  // "x-mailbox:mb-kotu" bir mailbox tanimi degildir.
  assert.equal(extractMailbox('x-mailbox:mb-kotu'), null);
});

// --- bicimlendirme ----------------------------------------------------------

test('formatTimestamp okunakli hale getirir', () => {
  assert.equal(formatTimestamp('2026-08-29T14:35:46.667123Z'), '2026-08-29 14:35:46Z');
  assert.equal(formatTimestamp('bozuk-tarih'), 'bozuk-tarih', 'taninmayan bicim korunur');
  assert.equal(formatTimestamp(''), '?');
});

test('formatMessage oda, seq, zaman ve metni icerir', () => {
  const out = formatMessage(
    { seq: 7, ts: '2026-08-29T14:35:46Z', text: 'merhaba', signed: true },
    { room: 'lobby' },
  );
  assert.match(out, /lobby #7/);
  assert.match(out, /2026-08-29 14:35:46Z/);
  assert.match(out, /imzali/);
  assert.match(out, /merhaba/);
});

// --- ag katmani (sahte fetch) -----------------------------------------------

test('fetchText 404 u istege bagli olarak null dondurur', async () => {
  const f = fakeFetch({ 'https://x/yok': { status: 404, body: 'no' } });
  assert.equal(await fetchText('https://x/yok', { fetchImpl: f, allow404: true }), null);
  await assert.rejects(
    () => fetchText('https://x/yok', { fetchImpl: f }),
    /sunucu 404 dondurdu/,
  );
});

test('fetchText 429 u anlasilir bicimde bildirir', async () => {
  const f = fakeFetch({ 'https://x/a': { status: 429, body: '' } });
  await assert.rejects(() => fetchText('https://x/a', { fetchImpl: f }), (err) => {
    assert.ok(err instanceof NetworkError);
    assert.equal(err.status, 429);
    assert.match(err.message, /okuma kotasi doldu/);
    return true;
  });
});

test('fetchText baglanti hatasini NetworkError e sarar (cokmez)', async () => {
  const patlayan = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(() => fetchText('https://x/a', { fetchImpl: patlayan }), (err) => {
    assert.ok(err instanceof NetworkError);
    assert.match(err.message, /sunucuya ulasilamadi/);
    return true;
  });
});

test('fetchText zaman asimini ayirt eder', async () => {
  const zamanAsimi = async () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    throw err;
  };
  await assert.rejects(
    () => fetchText('https://x/a', { fetchImpl: zamanAsimi }),
    /yanit vermedi/,
  );
});

// --- sayfalama --------------------------------------------------------------

/** Sahte oda sunucusu: 1..last araligi, since=S -> S+1..S+limit, since yok -> son dilim. */
function fakeRoom(last, { status = 200 } = {}, log = []) {
  return async (url) => {
    log.push(url.replace('https://technocore.chat', ''));
    const u = new URL(url);
    const limit = Number(u.searchParams.get('limit'));
    const since = u.searchParams.has('since') ? Number(u.searchParams.get('since')) : null;
    const from = since === null ? Math.max(1, last - limit + 1) : since + 1;
    const messages = [];
    for (let q = from; q <= Math.min(last, from + limit - 1); q++) {
      messages.push({ seq: q, ts: '', from: q % 2 === 0 ? DID : 'baskasi', text: `m${q}` });
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => feed('lobby', messages, last),
    };
  };
}

test('readRoom en yeni pencereden geriye dogru sayfalar', async () => {
  const log = [];
  const result = await readRoom('lobby', { fetchImpl: fakeRoom(500, {}, log), limit: 100 });

  assert.equal(result.messages.length, 500, 'tum mesajlar toplanmali');
  assert.equal(result.pages, 5);
  assert.equal(result.truncated, false);
  // Ilk istek since'siz olmali: en yeni dilim.
  assert.ok(!log[0].includes('since='), `ilk istek since icermemeli: ${log[0]}`);
  // Sonrakiler geriye dogru inmeli.
  assert.deepEqual(
    log.slice(1).map((u) => Number(new URL(`https://x${u}`).searchParams.get('since'))),
    [300, 200, 100, 0],
  );
});

test('readRoom sonuclari eskiden yeniye siralar ve tekrar etmez', async () => {
  const result = await readRoom('lobby', { fetchImpl: fakeRoom(250), limit: 100 });
  const seqs = result.messages.map((m) => m.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'artan sirada olmali');
  assert.equal(new Set(seqs).size, seqs.length, 'tekrar eden seq olmamali');
  assert.equal(seqs[0], 1);
  assert.equal(seqs.at(-1), 250);
});

test('readRoom odanin basina ulasinca durur', async () => {
  const log = [];
  const result = await readRoom('lobby', { fetchImpl: fakeRoom(50, {}, log), limit: 200 });
  assert.equal(result.pages, 1, 'tek dilim yetiyorsa ek istek atilmamali');
  assert.equal(result.messages.length, 50);
});

test('readRoom limit i asan odada sayfa sinirini bildirir', async () => {
  const result = await readRoom('lobby', { fetchImpl: fakeRoom(10_000), limit: 100, maxPages: 3 });
  assert.equal(result.pages, 3);
  assert.equal(result.truncated, true, 'kesildigi sessizce gizlenmemeli');
  assert.equal(result.messages.length, 300);
  // Kesilse bile elde edilenler EN YENI mesajlar olmali.
  assert.equal(result.messages.at(-1).seq, 10_000);
});

test('readRoom geriye ilerleme olmazsa sonsuz donguye girmez', async () => {
  // Kotu davranan sunucu: since ne olursa olsun ayni pencereyi dondurur.
  const f = fakeFetch(() => ({ body: feed('lobby', [{ seq: 5, from: DID, text: 'ayni' }], 99) }));
  const result = await readRoom('lobby', { fetchImpl: f, maxPages: 50 });
  assert.ok(result.pages <= 2, `ilerleme yoksa durmali (sayfa: ${result.pages})`);
  assert.equal(result.truncated, false);
});

test('readRoom bos odada tek istekle biter', async () => {
  const f = fakeFetch(() => ({ body: feed('lobby', [], null) }));
  const result = await readRoom('lobby', { fetchImpl: f });
  assert.equal(result.messages.length, 0);
  assert.equal(result.pages, 1);
});

// --- toplama ----------------------------------------------------------------

test('collectActivity mailbox i nottan bulup onu da tarar', async () => {
  const log = [];
  const f = fakeFetch((url) => {
    if (url.includes('/kv/')) return { body: `${DID} name:x mailbox:mb-emrahfc` };
    if (url.includes('/r/mb-emrahfc'))
      return { body: feed('mb-emrahfc', [{ seq: 1, from: DID, text: 'kutu' }], 1) };
    return {
      body: feed('lobby', [
        { seq: 1, from: DID, text: 'benim' },
        { seq: 2, from: BASKA_DID, text: 'baskasinin' },
      ], 2),
    };
  }, log);

  const report = await collectActivity({ did: DID, fetchImpl: f });
  assert.equal(report.mailbox, 'mb-emrahfc');
  assert.equal(report.total, 2, 'lobby 1 + mailbox 1');
  assert.deepEqual(report.rooms.map((r) => r.room), ['lobby', 'mb-emrahfc']);
  assert.equal(report.rooms[0].scanned, 2, 'taranan sayisi eslesenden farkli olabilir');
  assert.equal(report.rooms[0].matched.length, 1);
});

test('collectActivity mailbox yoksa yalnizca lobby yi tarar', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('/kv/')) return { status: 404, body: 'yok' };
    return { body: feed('lobby', [{ seq: 1, from: DID, text: 'a' }], 1) };
  });
  const report = await collectActivity({ did: DID, fetchImpl: f });
  assert.equal(report.mailbox, null);
  assert.equal(report.rooms.length, 1);
  assert.equal(report.total, 1);
});

test('collectActivity bir oda okunamazsa digerlerini surdurur', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('/kv/')) return { body: `${DID} mailbox:mb-emrahfc` };
    if (url.includes('/r/mb-emrahfc')) return { status: 500, body: 'patladi' };
    return { body: feed('lobby', [{ seq: 1, from: DID, text: 'a' }], 1) };
  });
  const report = await collectActivity({ did: DID, fetchImpl: f });
  assert.equal(report.total, 1, 'lobby yine de okunmali');
  const mailbox = report.rooms.find((r) => r.room === 'mb-emrahfc');
  assert.match(mailbox.error, /500/);
});

test('collectActivity not okunamazsa taramayi durdurmaz', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('/kv/')) return { status: 500, body: 'patladi' };
    return { body: feed('lobby', [{ seq: 1, from: DID, text: 'a' }], 1) };
  });
  const report = await collectActivity({ did: DID, fetchImpl: f });
  assert.match(report.mailboxError, /500/);
  assert.equal(report.total, 1);
});

test('collectActivity hicbir eslesme yoksa sifir dondurur', async () => {
  const f = fakeFetch((url) => {
    if (url.includes('/kv/')) return { status: 404, body: 'yok' };
    return { body: feed('lobby', [{ seq: 1, from: BASKA_DID, text: 'baskasinin' }], 1) };
  });
  const report = await collectActivity({ did: DID, fetchImpl: f });
  assert.equal(report.total, 0);
  assert.equal(report.rooms[0].scanned, 1, 'taradi ama eslesme yok');
});

// --- gercek dunya: sunucu 503 ile birlikte gecerli veri donduruyor -----------

test('fetchFeedPage 503 govdesindeki gecerli JSON u kullanir', async () => {
  // technocore.chat asiri yuk altinda boyle davraniyor: 503 + tam JSON.
  const f = fakeFetch(() => ({
    status: 503,
    body: feed('lobby', [{ seq: 1, from: DID, text: 'yasiyorum' }], 1),
  }));
  const { fetchFeedPage } = await import('../src/activity.js');
  const page = await fetchFeedPage('lobby', { fetchImpl: f });
  assert.equal(page.messages.length, 1);
  assert.equal(page.degradedStatus, 503, 'bozuk durum gizlenmemeli');
});

test('fetchFeedPage ayristirilamayan hata govdesini hata olarak bildirir', async () => {
  const f = fakeFetch(() => ({ status: 503, body: '<html>Service Unavailable</html>' }));
  const { fetchFeedPage } = await import('../src/activity.js');
  await assert.rejects(() => fetchFeedPage('lobby', { fetchImpl: f }), /sunucu 503 dondurdu/);
});

test('readRoom bozuk durumu yukari tasir', async () => {
  const f = fakeFetch(() => ({
    status: 503,
    body: feed('lobby', [{ seq: 1, from: DID, text: 'x' }], 1),
  }));
  const result = await readRoom('lobby', { fetchImpl: f });
  assert.equal(result.degradedStatus, 503);
  assert.equal(result.messages.length, 1);
});

test('discoverMailbox 503 govdesinden gecerli mailbox i cikarabilir', async () => {
  const f = fakeFetch(() => ({ status: 503, body: `${DID} mailbox:mb-emrahfc` }));
  const { discoverMailbox } = await import('../src/activity.js');
  assert.equal(await discoverMailbox(DID, { fetchImpl: f }), 'mb-emrahfc');
});

test('discoverMailbox hata sayfasindan oda adi uydurmaz', async () => {
  const f = fakeFetch(() => ({ status: 503, body: 'Service Unavailable' }));
  const { discoverMailbox } = await import('../src/activity.js');
  await assert.rejects(() => discoverMailbox(DID, { fetchImpl: f }), /sunucu 503 dondurdu/);
});

// --- yeniden deneme (ustel geri cekilme) ------------------------------------

/**
 * Sirayla verilen cevaplari donduren sahte fetch.
 * @param {Array<{status?: number, body?: string} | Error>} responses
 */
function scriptedFetch(responses, log = []) {
  let i = 0;
  return async (url) => {
    const entry = responses[Math.min(i, responses.length - 1)];
    i++;
    log.push(url);
    if (entry instanceof Error) throw entry;
    const status = entry.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => entry.body ?? '' };
  };
}

/** Beklemeleri kaydeden, gercekte beklemeyen sleep. */
function recordingSleep(delays = []) {
  return async (ms) => {
    delays.push(ms);
  };
}

test('5xx sonrasi tekrar dener ve basarili cevabi kullanir', async () => {
  const { fetchRaw } = await import('../src/activity.js');
  const log = [];
  const f = scriptedFetch(
    [
      { status: 503, body: 'Service Unavailable' },
      { status: 200, body: 'iyi' },
    ],
    log,
  );
  const res = await fetchRaw('https://x/a', { fetchImpl: f, sleep: recordingSleep() });
  assert.equal(res.status, 200);
  assert.equal(res.body, 'iyi');
  assert.equal(res.attempts, 2, 'ikinci denemede basarili olmali');
  assert.equal(log.length, 2);
});

test('geri cekilme suresi ustel olarak artar', async () => {
  const { fetchRaw } = await import('../src/activity.js');
  const delays = [];
  const f = scriptedFetch([{ status: 503, body: 'kotu' }]);
  await fetchRaw('https://x/a', {
    fetchImpl: f,
    sleep: recordingSleep(delays),
    backoffMs: 500,
    retries: 3,
  });
  // 3 deneme -> aralarda 2 bekleme: 500ms ve 1000ms.
  assert.deepEqual(delays, [500, 1000]);
});

test('en fazla 3 deneme yapilir', async () => {
  const { fetchRaw } = await import('../src/activity.js');
  const log = [];
  const f = scriptedFetch([{ status: 503, body: 'kotu' }], log);
  const res = await fetchRaw('https://x/a', { fetchImpl: f, sleep: recordingSleep() });
  assert.equal(log.length, 3, 'ucten fazla istek atilmamali');
  assert.equal(res.status, 503);
  assert.equal(res.attempts, 3);
});

test('4xx KALICI kabul edilir, tekrar denenmez', async () => {
  const { fetchRaw } = await import('../src/activity.js');
  for (const status of [400, 403, 404, 422]) {
    const log = [];
    const f = scriptedFetch([{ status, body: 'hayir' }], log);
    const res = await fetchRaw('https://x/a', { fetchImpl: f, sleep: recordingSleep() });
    assert.equal(log.length, 1, `${status} icin tekrar denenmemeli`);
    assert.equal(res.attempts, 1);
  }
});

test('429 da tekrar denenmez (kota zaten dolu)', async () => {
  const { fetchRaw } = await import('../src/activity.js');
  const log = [];
  const f = scriptedFetch([{ status: 429, body: '' }], log);
  await fetchRaw('https://x/a', { fetchImpl: f, sleep: recordingSleep() });
  assert.equal(log.length, 1, 'kota dolmusken tekrar denemek durumu kotulestirirdi');
});

test('ag hatasindan sonra toparlanir', async () => {
  const { fetchRaw } = await import('../src/activity.js');
  const log = [];
  const f = scriptedFetch([new TypeError('fetch failed'), { status: 200, body: 'iyi' }], log);
  const res = await fetchRaw('https://x/a', { fetchImpl: f, sleep: recordingSleep() });
  assert.equal(res.body, 'iyi');
  assert.equal(res.attempts, 2);
});

test('tum denemeler ag hatasiyla biterse duzgun hata verir (cokmez)', async () => {
  const { fetchRaw } = await import('../src/activity.js');
  const log = [];
  const f = scriptedFetch([new TypeError('fetch failed')], log);
  await assert.rejects(
    () => fetchRaw('https://x/a', { fetchImpl: f, sleep: recordingSleep() }),
    (err) => {
      assert.ok(err instanceof NetworkError);
      assert.match(err.message, /sunucuya ulasilamadi/);
      assert.match(err.message, /3 deneme/);
      return true;
    },
  );
  assert.equal(log.length, 3);
});

test('retries=1 ile yeniden deneme kapatilabilir', async () => {
  const { fetchRaw } = await import('../src/activity.js');
  const log = [];
  const f = scriptedFetch([{ status: 503, body: 'kotu' }], log);
  await fetchRaw('https://x/a', { fetchImpl: f, retries: 1, sleep: recordingSleep() });
  assert.equal(log.length, 1);
});

test('503 + GECERLI govde tekrar denenmez, veri kullanilir', async () => {
  const { fetchFeedPage } = await import('../src/activity.js');
  const log = [];
  const f = scriptedFetch(
    [{ status: 503, body: feed('lobby', [{ seq: 1, from: DID, text: 'yasiyorum' }], 1) }],
    log,
  );
  const page = await fetchFeedPage('lobby', { fetchImpl: f, sleep: recordingSleep() });
  assert.equal(log.length, 1, 'veri zaten elimizdeyken tekrar istek atmak bosuna');
  assert.equal(page.messages.length, 1);
  assert.equal(page.degradedStatus, 503);
});

test('503 + BOZUK govde tekrar denenir, sonra duzelir', async () => {
  const { fetchFeedPage } = await import('../src/activity.js');
  const log = [];
  const f = scriptedFetch(
    [
      { status: 503, body: '<html>Service Unavailable</html>' },
      { status: 200, body: feed('lobby', [{ seq: 2, from: DID, text: 'sonunda' }], 2) },
    ],
    log,
  );
  const page = await fetchFeedPage('lobby', { fetchImpl: f, sleep: recordingSleep() });
  assert.equal(log.length, 2);
  assert.equal(page.messages[0].text, 'sonunda');
  assert.equal(page.degradedStatus, null, 'basarili cevapta bozuk durum yok');
});

test('surekli 503 + bozuk govde: deneme sayisiyla birlikte bildirilir', async () => {
  const { fetchFeedPage } = await import('../src/activity.js');
  const f = scriptedFetch([{ status: 503, body: 'Service Unavailable' }]);
  await assert.rejects(
    () => fetchFeedPage('lobby', { fetchImpl: f, sleep: recordingSleep() }),
    /sunucu 503 dondurdu \(3 deneme\)/,
  );
});

test('discoverMailbox 503 + gecerli not icin tekrar denemez', async () => {
  const { discoverMailbox } = await import('../src/activity.js');
  const log = [];
  const f = scriptedFetch([{ status: 503, body: `${DID} mailbox:mb-emrahfc` }], log);
  assert.equal(await discoverMailbox(DID, { fetchImpl: f, sleep: recordingSleep() }), 'mb-emrahfc');
  assert.equal(log.length, 1);
});

test('discoverMailbox 503 + bozuk govde icin tekrar dener', async () => {
  const { discoverMailbox } = await import('../src/activity.js');
  const log = [];
  const f = scriptedFetch(
    [{ status: 503, body: 'Service Unavailable' }, { status: 200, body: `${DID} mailbox:mb-x` }],
    log,
  );
  assert.equal(await discoverMailbox(DID, { fetchImpl: f, sleep: recordingSleep() }), 'mb-x');
  assert.equal(log.length, 2);
});

test('collectActivity dalgali sunucuda calismaya devam eder', async () => {
  // Gercek dunyayi taklit eder: technocore.chat araliksiz 503/200 arasinda gidip geliyor.
  let n = 0;
  const f = async (url) => {
    n++;
    const kotu = n % 2 === 1; // her ikincisinde basarili
    if (url.includes('/kv/')) {
      return kotu
        ? { ok: false, status: 503, text: async () => 'Service Unavailable' }
        : { ok: true, status: 200, text: async () => `${DID} mailbox:mb-emrahfc` };
    }
    const room = url.includes('mb-emrahfc') ? 'mb-emrahfc' : 'lobby';
    return kotu
      ? { ok: false, status: 503, text: async () => 'Service Unavailable' }
      : {
          ok: true,
          status: 200,
          text: async () => feed(room, [{ seq: 1, from: DID, text: room }], 1),
        };
  };
  const report = await collectActivity({ did: DID, fetchImpl: f, sleep: recordingSleep() });
  assert.equal(report.mailbox, 'mb-emrahfc');
  assert.equal(report.total, 2, 'yeniden deneme sayesinde iki oda da okunmali');
  assert.ok(report.rooms.every((r) => r.error === null));
});

// --- varsayilan sayfa siniri ------------------------------------------------

test('varsayilan --max-pages muhafazakar (5) ve okuma kotasini zorlamaz', async () => {
  const { DEFAULT_MAX_PAGES } = await import('../src/activity.js');
  assert.equal(DEFAULT_MAX_PAGES, 5);

  const log = [];
  // Cok buyuk bir oda: varsayilan sinir devreye girmeli.
  await readRoom('lobby', { fetchImpl: fakeRoom(1_000_000, {}, log), limit: 200 });
  assert.equal(log.length, DEFAULT_MAX_PAGES, 'varsayilan sinirdan fazla istek atilmamali');
});

test('tam biten tarama "kesildi" diye isaretlenmez', async () => {
  // Oda tam olarak sinir kadar sayfaya sigiyor: dogal bitis, kesinti degil.
  const result = await readRoom('lobby', { fetchImpl: fakeRoom(1000), limit: 200, maxPages: 5 });
  assert.equal(result.messages.length, 1000);
  assert.equal(result.truncated, false, 'odanin basina ulasildi, kesinti yok');
});

test('sinira takilan tarama kesildi olarak isaretlenir', async () => {
  const result = await readRoom('lobby', { fetchImpl: fakeRoom(5000), limit: 200, maxPages: 5 });
  assert.equal(result.messages.length, 1000);
  assert.equal(result.truncated, true, 'oda bitmedi, kesinti bildirilmeli');
});

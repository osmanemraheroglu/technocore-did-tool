/**
 * Sihirbazin urettigi adimlari kurar: metin -> supurme -> nonce -> imza ->
 * KENDI IMZASINI DOGRULA -> link.
 *
 * Buradaki her imzali adim, link uretilmeden once verifyMessage() ile
 * dogrulanir. Dogrulama basarisiz olursa hicbir link uretilmez.
 */

import { fingerprint, shard } from './did.js';
import { didNoteUrl, assertMessageLength, assertName, saySignedUrl, slugify } from './links.js';
import { nextNonce } from './keystore.js';
import { canonical, signMessage, verifyMessage } from './sign.js';
import { sweep } from './sweep.js';

export const LOBBY = 'lobby';
export const UPSTREAM_TAG = '@flop_labs';

/** X kullanici adi: bastaki @ atilir, X'in kendi kurallariyla dogrulanir. */
export function normalizeXHandle(input) {
  const handle = String(input).trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    throw new Error(`X kullanici adi gecersiz: "${input}" (1-15 karakter, harf/rakam/alt tire)`);
  }
  return handle;
}

/**
 * Mailbox oda adini normalize eder.
 *
 * Kullanici "emrahFC", "mb-emrahFC" veya "mb-mb-x" yazabilir; hepsi tek bir
 * "mb-<slug>" bicimine indirgenir. Onek elle eklenirse slug'lama atlanirdi ve
 * buyuk harfli bir ad protokolun isim desenine takilirdi.
 */
export function normalizeMailboxRoom(input) {
  let name = String(input).trim();
  while (/^mb-/i.test(name)) name = name.slice(3);
  const room = `mb-${slugify(name)}`;
  return assertName(room, 'mailbox oda adi');
}

/** Katki linki: yalnizca http(s) ve bosluksuz olmali. */
export function normalizeUrl(input) {
  const value = String(input).trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`katki linki gecersiz: "${input}"`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('katki linki http veya https olmali');
  }
  return parsed.toString();
}

/**
 * Bir imzali mesaj adimi uretir: supur, nonce al, imzala, dogrula, link kur.
 */
function signedStep({ store, keys, id, title, room, rawText }) {
  const text = sweep(rawText);
  if (!text) throw new Error(`${id}: supurme sonrasi metin bos kaldi`);
  assertMessageLength(text);

  const nonce = nextNonce(store, room);
  const sig = signMessage(keys, room, nonce, text);
  const signedBytes = canonical(room, nonce, text);

  // Sanity check: gondermeden once kendi imzamizi DID'den cozulen public key
  // ile dogrula. Basarisizsa cagiran taraf link basmadan patlar.
  if (!verifyMessage(store.did, sig, room, nonce, text)) {
    throw new Error(`${id}: kendi imzamiz dogrulanamadi - link uretilmedi`);
  }

  return {
    id,
    title,
    kind: 'signed',
    room,
    rawText,
    text,
    nonce,
    sig,
    signedBytes,
    url: saySignedUrl({ room, did: store.did, sig, nonce, text }),
  };
}

/**
 * Tum adimlari kurar.
 *
 * @param {object} p
 * @param {object} p.store keystore nesnesi (nonce durumu guncellenir)
 * @param {{seedRaw: Uint8Array, publicKeyRaw: Uint8Array}} p.keys
 * @param {string} p.agent slug'lanmis agent adi
 * @param {string} p.xHandle @'siz X kullanici adi
 * @param {string} p.contributionKind
 * @param {string} p.contributionUrl
 * @param {string} p.description tek cumlelik aciklama
 * @param {string|null} [p.mailboxRoom] "mb-..." oda adi veya null
 */
export function buildPlan({
  store,
  keys,
  agent,
  xHandle,
  contributionKind,
  contributionUrl,
  description,
  mailboxRoom = null,
}) {
  assertName(agent, 'agent adi');
  const did = store.did;
  const fp = fingerprint(did);
  const { ns, key } = shard(fp);

  if (mailboxRoom) {
    assertName(mailboxRoom, 'mailbox oda adi');
    if (!mailboxRoom.startsWith('mb-')) {
      throw new Error(`mailbox odasi "mb-" ile baslamali (alinan: ${mailboxRoom})`);
    }
  }

  const steps = [];

  // (a) Lobiye imzali giris.
  steps.push(
    signedStep({
      store,
      keys,
      id: 'a',
      title: 'Lobiye imzali giris',
      room: LOBBY,
      rawText:
        `${agent} burada. Anahtarim yerelde uretildi, bu mesaj did:key ile imzalidir. ` +
        `x: @${xHandle} - ${did}`,
    }),
  );

  // (b) DID profil notu - imzasiz, dunyaya acik.
  // patterns.md'deki bicim: bosluklarla ayrilmis token'lar, did:key ilk sirada.
  const noteTokens = [did, `name:${agent}`, `x:@${xHandle}`];
  if (mailboxRoom) noteTokens.push(`mailbox:${mailboxRoom}`);
  const noteValue = sweep(noteTokens.join(' '));
  steps.push({
    id: 'b',
    title: 'DID profil notu (imzasiz, dunyaya acik)',
    kind: 'note',
    ns,
    key,
    value: noteValue,
    url: didNoteUrl({ ns, key, value: noteValue }),
  });

  // (c) Katki kaydi - lobiye ikinci imzali mesaj.
  // Ayrac olarak "|" degil " - " kullaniliyor: kanonik dize zaten "|" ile
  // bolunuyor, metne bulastirmamak savunmaci bir tercih.
  steps.push(
    signedStep({
      store,
      keys,
      id: 'c',
      title: 'Katki kaydi (imzali)',
      room: LOBBY,
      rawText:
        `katki - ${contributionKind} - ${description} - ${contributionUrl} - ` +
        `${UPSTREAM_TAG} - ${did}`,
    }),
  );

  // (d) Mailbox acilis mesaji - mb- odalarina yalnizca imzali yazilir.
  if (mailboxRoom) {
    steps.push(
      signedStep({
        store,
        keys,
        id: 'd',
        title: `Mailbox acilisi (${mailboxRoom})`,
        room: mailboxRoom,
        rawText:
          `${mailboxRoom} acildi. Buraya yalnizca imzali yazilir. ` +
          `Sahibi: ${did} - x: @${xHandle}`,
      }),
    );
  }

  return { did, fingerprint: fp, ns, key, agent, xHandle, mailboxRoom, steps };
}

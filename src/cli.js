#!/usr/bin/env node
/**
 * technocore-did-tool
 *
 * Ed25519 did:key kimligini YERELDE uretir, Technocore protokolune birebir
 * uygun imzalar atar ve gonderilmeye hazir GET linklerini basar.
 *
 * Bu arac hicbir ag istegi yapmaz. Linkleri siz acarsiniz.
 */

import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import process from 'node:process';

import * as keystore from './keystore.js';
import { buildPlan, normalizeMailboxRoom, normalizeUrl, normalizeXHandle } from './compose.js';
import { canonical, signMessage, verifyMessage } from './sign.js';
import { assertName, roomUrl, saySignedUrl, slugify } from './links.js';
import { createPrompter } from './prompt.js';
import { NetworkError, collectActivity, formatMessage } from './activity.js';
import { sweep } from './sweep.js';

const OPTIONS = {
  keyfile: { type: 'string' },
  proof: { type: 'string' },
  force: { type: 'boolean', default: false },
  agent: { type: 'string' },
  x: { type: 'string' },
  kind: { type: 'string' },
  url: { type: 'string' },
  desc: { type: 'string' },
  mailbox: { type: 'string' },
  'no-mailbox': { type: 'boolean', default: false },
  room: { type: 'string' },
  text: { type: 'string' },
  did: { type: 'string' },
  sig: { type: 'string' },
  nonce: { type: 'string' },
  'max-pages': { type: 'string' },
  offline: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

/**
 * Yardim metninde komutun nasil yazilacagini belirler.
 *
 * Olculen davranis: global/npx kurulumda process.argv[1] bin baglantisinin
 * yoludur (.../bin/technocore-did-tool), kaynaktan calistirinca .../src/cli.js
 * olur. Uzantiya bakmak ikisini ayirmaya yeter ve kullanicinin yazdigi ismi
 * ("technocore-did-tool" ya da kisa "technocore-did") oldugu gibi korur.
 */
function invocationName() {
  const script = basename(process.argv[1] ?? '');
  return script && !script.endsWith('.js') ? script : 'node src/cli.js';
}

function helpText() {
  const cmd = invocationName();
  const fromSource = cmd.startsWith('node ');
  // Kaynaktan calistiranlar icin "npm start" en kisa yol; kurulu kullanici
  // icin sihirbaz zaten argumansiz komutun kendisidir.
  const wizard = fromSource ? 'npm start' : cmd;

  return `
technocore-did-tool - Technocore icin yerel did:key kimlik ve imzali link araci

KULLANIM
  ${wizard}${' '.repeat(Math.max(1, 31 - wizard.length))}Sihirbaz: kimlik uret + tum linkleri hazirla
  ${cmd} <komut> [...]

KOMUTLAR
  wizard          (varsayilan) Adim adim sorar, linkleri ve public-proof.txt uretir
  keygen          Yalnizca anahtar uretir (secret.key.json)
  sign            Tek bir mesaji imzalar ve linkini basar
  verify          Verilen imzayi bagimsiz olarak dogrular
  links           Mevcut anahtarla linkleri yeniden uretir
  activity        Bir did:key'in Technocore'da gorunen mesajlarini listeler
  help            Bu yardim

SECENEKLER
  --keyfile <yol>   Anahtar dosyasi (varsayilan: secret.key.json)
  --proof <yol>     Kanit dosyasi (varsayilan: public-proof.txt)
  --force           Var olan anahtar dosyasinin uzerine yaz (DIKKAT: kimlik kaybolur)
  --help, -h        Yardim

  Sihirbazi soru sormadan calistirmak icin:
  --agent <ad> --x <kullanici> --kind <tur> --url <link> --desc <cumle>
  [--mailbox <ad> | --no-mailbox]

  sign icin:    --room <oda> --text "<metin>"
  verify icin:  --did <did> --sig <imza> --nonce <n> --room <oda> --text "<metin>"

  activity icin: [--did <did>] [--room <oda>] [--max-pages <n>]
                 --did verilmezse secret.key.json'daki DID kullanilir.
                 --max-pages varsayilan 5 (~1000 mesaj); okuma kotasini
                 zorlamamak icin dusuk tutuldu, derin tarama icin artirin.
                 Yalnizca herkese acik GET okumasi yapar; hicbir sey yazmaz.

ORNEKLER
  ${wizard}
  ${cmd} sign --room lobby --text "merhaba"
  ${cmd} verify --did did:key:z6Mk... --sig ... --nonce 1756... \\
       --room lobby --text "merhaba"
  ${cmd} activity
  ${cmd} activity --did did:key:z6Mk... --room lobby
`;
}

function fail(message) {
  process.stderr.write(`\nHATA: ${message}\n\n`);
  process.exit(1);
}

function need(values, name, hint) {
  if (!values[name]) fail(`--${name} gerekli${hint ? ` (${hint})` : ''}`);
  return values[name];
}

// --- cikti bicimlendirme -----------------------------------------------------

const line = (ch = '-') => ch.repeat(74);

function printIdentity(plan) {
  process.stdout.write(`\n${line('=')}\nKIMLIK\n${line('=')}\n`);
  process.stdout.write(`DID          : ${plan.did}\n`);
  process.stdout.write(`Fingerprint  : ${plan.fingerprint}\n`);
  process.stdout.write(`Not adresi   : /kv/${plan.ns}/${plan.key}\n`);
}

function printSteps(plan) {
  for (const step of plan.steps) {
    process.stdout.write(`\n${line()}\n(${step.id}) ${step.title}\n${line()}\n`);
    if (step.kind === 'signed') {
      process.stdout.write(`oda    : ${step.room}\n`);
      process.stdout.write(`nonce  : ${step.nonce}\n`);
      process.stdout.write(`imzali : ${step.signedBytes}\n`);
    } else {
      process.stdout.write(`deger  : ${step.value}\n`);
    }
    process.stdout.write(`\n${step.url}\n`);
  }
}

/**
 * public-proof.txt: paylasilabilir kanit dosyasi.
 * Private key/seed BURAYA ASLA YAZILMAZ - keystore nesnesi hic serilestirilmez,
 * yalnizca asagidaki alanlar elle yazilir.
 */
function writeProof(path, plan) {
  const out = [];
  out.push('technocore-did-tool - kamuya acik kanit');
  out.push(`Uretim zamani: ${new Date().toISOString()}`);
  out.push('');
  out.push('Bu dosya PAYLASILABILIR. Private key veya seed icermez.');
  out.push('');
  out.push(line('='));
  out.push('KIMLIK');
  out.push(line('='));
  out.push(`DID         : ${plan.did}`);
  out.push(`Fingerprint : ${plan.fingerprint}  (SHA-256(did) ilk 16 hex)`);
  out.push(`Not adresi  : /kv/${plan.ns}/${plan.key}`);
  out.push(`Agent       : ${plan.agent}`);
  out.push(`X           : @${plan.xHandle}`);
  if (plan.mailboxRoom) out.push(`Mailbox     : ${plan.mailboxRoom}`);

  for (const step of plan.steps) {
    out.push('');
    out.push(line());
    out.push(`(${step.id}) ${step.title}`);
    out.push(line());
    if (step.kind === 'signed') {
      out.push(`oda           : ${step.room}`);
      out.push(`nonce         : ${step.nonce}`);
      out.push(`imzalanan dize: ${step.signedBytes}`);
      out.push(`imza (b64url) : ${step.sig}`);
      out.push('dogrulama     : imza uretim aninda DID ile dogrulandi (OK)');
    } else {
      out.push(`alan  : ${plan.ns}`);
      out.push(`anahtar: ${plan.key}`);
      out.push(`deger : ${step.value}`);
    }
    out.push('');
    out.push(step.url);
  }

  out.push('');
  out.push(line('='));
  out.push('Dogrulama komutu (herkes calistirabilir):');
  for (const step of plan.steps.filter((s) => s.kind === 'signed')) {
    out.push(
      `  node src/cli.js verify --did ${plan.did} --sig ${step.sig} ` +
        `--nonce ${step.nonce} --room ${step.room} --text ${JSON.stringify(step.text)}`,
    );
  }
  out.push('');

  const text = `${out.join('\n')}\n`;
  if (/privateKeySeed|seedRaw|BEGIN [A-Z ]*PRIVATE KEY/.test(text)) {
    throw new Error('writeProof: kanit dosyasinda gizli veri izi bulundu - yazim iptal');
  }
  writeFileSync(path, text);
}

// --- anahtar yukleme ---------------------------------------------------------

function loadOrCreate(keyfile, { force, allowCreate = true, quiet = false }) {
  if (keystore.exists(keyfile) && !force) {
    const store = keystore.load(keyfile);
    if (!quiet) process.stdout.write(`Mevcut anahtar kullaniliyor: ${keyfile}\n`);
    return { store, created: false };
  }
  if (keystore.exists(keyfile) && force) {
    process.stdout.write(`UYARI: ${keyfile} uzerine yaziliyor - eski kimlik kaybolacak.\n`);
  }
  if (!allowCreate) fail(`anahtar dosyasi bulunamadi: ${keyfile} (once "keygen" calistirin)`);

  const store = keystore.createIdentity();
  keystore.save(keyfile, store);
  if (!quiet) process.stdout.write(`Yeni anahtar uretildi ve yazildi: ${keyfile} (izin 0600)\n`);
  return { store, created: true };
}

// --- komutlar ----------------------------------------------------------------

async function collectInputs(values, store) {
  const previous = store.profile ?? {};
  const nonInteractive = Boolean(values.agent);

  if (nonInteractive) {
    const agent = slugify(values.agent);
    return {
      agent,
      xHandle: normalizeXHandle(need(values, 'x', 'X kullanici adi')),
      contributionKind: sweep(need(values, 'kind', 'katki turu')),
      contributionUrl: normalizeUrl(need(values, 'url', 'katki linki')),
      description: sweep(need(values, 'desc', 'tek cumlelik aciklama')),
      mailboxRoom: values['no-mailbox'] || !values.mailbox
        ? null
        : normalizeMailboxRoom(values.mailbox),
    };
  }

  const p = createPrompter();
  try {
    process.stdout.write('\nBirkac soru - cevaplar yalnizca link metinlerinde kullanilir.\n\n');

    const agent = slugify(
      await p.ask('Agent adi', {
        defaultValue: previous.agent,
        validate: (v) => void slugify(v),
      }),
    );
    const xHandle = normalizeXHandle(
      await p.ask('X kullanici adi (@ olmadan)', {
        defaultValue: previous.xHandle,
        validate: (v) => void normalizeXHandle(v),
      }),
    );
    const contributionKind = sweep(
      await p.ask('Katki turu (or. kod, dokuman, test)', {
        defaultValue: previous.contributionKind,
        maxLength: 120,
      }),
    );
    const contributionUrl = normalizeUrl(
      await p.ask('Katki linki (http/https)', {
        defaultValue: previous.contributionUrl,
        validate: (v) => void normalizeUrl(v),
      }),
    );
    const description = sweep(
      await p.ask('Tek cumlelik aciklama', {
        defaultValue: previous.description,
        maxLength: 500,
      }),
    );

    let mailboxRoom = null;
    if (await p.confirm('Mailbox odasi da olusturulsun mu? (mb- odalarina yalnizca imzali yazilir)', false)) {
      const name = await p.ask('Mailbox adi (basina mb- eklenir)', {
        defaultValue: previous.mailboxRoom?.replace(/^mb-/, '') ?? agent,
        validate: (v) => void normalizeMailboxRoom(v),
      });
      mailboxRoom = normalizeMailboxRoom(name);
    }

    return { agent, xHandle, contributionKind, contributionUrl, description, mailboxRoom };
  } finally {
    p.close();
  }
}

async function cmdWizard(values, { requireExisting = false } = {}) {
  const keyfile = resolve(values.keyfile ?? keystore.DEFAULT_KEYFILE);
  const proofPath = resolve(values.proof ?? 'public-proof.txt');

  process.stdout.write(`\n${line('=')}\ntechnocore-did-tool\n${line('=')}\n`);

  const { store, created } = loadOrCreate(keyfile, {
    force: values.force,
    allowCreate: !requireExisting,
  });
  if (created) {
    process.stdout.write('Private key bu makineden cikmadi ve .gitignore ile korunuyor.\n');
  }

  const inputs = await collectInputs(values, store);
  const keys = keystore.keysOf(store);

  // Adimlar kurulur; her imzali adim link uretilmeden once kendini dogrular.
  const plan = buildPlan({ store, keys, ...inputs });

  // Nonce durumu ve profil varsayilanlari kaydedilir.
  store.profile = inputs;
  keystore.save(keyfile, store);

  printIdentity(plan);
  printSteps(plan);

  writeProof(proofPath, plan);

  process.stdout.write(`\n${line('=')}\n`);
  process.stdout.write(`Kanit dosyasi : ${proofPath} (paylasilabilir)\n`);
  process.stdout.write(`Gizli anahtar : ${keyfile} (ASLA paylasmayin, ASLA commit etmeyin)\n`);
  process.stdout.write(`Lobiyi oku    : ${roomUrl('lobby')}\n`);
  process.stdout.write(
    '\nLinkleri sirasiyla tarayicida acin. Bu arac hicbir istek gondermedi.\n\n',
  );
}

function cmdKeygen(values) {
  const keyfile = resolve(values.keyfile ?? keystore.DEFAULT_KEYFILE);
  if (keystore.exists(keyfile) && !values.force) {
    fail(`${keyfile} zaten var. Uzerine yazmak icin --force (eski kimlik kaybolur).`);
  }
  const store = keystore.createIdentity();
  keystore.save(keyfile, store);
  process.stdout.write(`\nAnahtar yazildi : ${keyfile} (izin 0600)\n`);
  process.stdout.write(`DID             : ${store.did}\n`);
  process.stdout.write(`Fingerprint     : ${store.fingerprint}\n`);
  process.stdout.write(`\n${basename(keyfile)} .gitignore kapsamindadir. Yedegini guvenli tutun.\n\n`);
}

function cmdSign(values) {
  const keyfile = resolve(values.keyfile ?? keystore.DEFAULT_KEYFILE);
  if (!keystore.exists(keyfile)) fail(`anahtar bulunamadi: ${keyfile} (once "keygen")`);

  const store = keystore.load(keyfile);
  const room = assertName(need(values, 'room', 'oda adi'), 'oda adi');
  const text = sweep(need(values, 'text', 'imzalanacak metin'));
  if (!text) fail('supurme sonrasi metin bos kaldi');

  const nonce = keystore.nextNonce(store, room);
  const sig = signMessage(keystore.keysOf(store), room, nonce, text);
  if (!verifyMessage(store.did, sig, room, nonce, text)) {
    fail('kendi imzamiz dogrulanamadi - link uretilmedi');
  }
  keystore.save(keyfile, store);

  process.stdout.write(`\nimzalanan dize : ${canonical(room, nonce, text)}\n`);
  process.stdout.write(`nonce          : ${nonce}\n`);
  process.stdout.write(`imza           : ${sig}\n\n`);
  process.stdout.write(`${saySignedUrl({ room, did: store.did, sig, nonce, text })}\n\n`);
}

function cmdVerify(values) {
  const did = need(values, 'did', 'did:key:z6Mk...');
  const sig = need(values, 'sig', '86 karakterlik base64url');
  const nonce = need(values, 'nonce', '1-19 hane');
  const room = need(values, 'room', 'oda adi');
  const raw = need(values, 'text', 'metin');
  const text = sweep(raw);

  const ok = verifyMessage(did, sig, room, nonce, text);
  process.stdout.write(`\nimzalanan dize : ${canonical(room, nonce, text)}\n`);
  if (raw !== text) {
    process.stdout.write('not            : metin supurulerek kanoniklestirildi\n');
  }
  process.stdout.write(`sonuc          : ${ok ? 'GECERLI' : 'GECERSIZ'}\n\n`);
  if (!ok) process.exit(2);
}

/**
 * Bir DID'in gorunur etkinligini listeler.
 *
 * Yalnizca herkese acik GET okumasi yapar: imza atmaz, yazmaz, gizli veri
 * gondermez. --did verilmezse yerel anahtar dosyasindaki DID kullanilir.
 */
async function cmdActivity(values) {
  let did = values.did;
  if (!did) {
    const keyfile = resolve(values.keyfile ?? keystore.DEFAULT_KEYFILE);
    if (!keystore.exists(keyfile)) {
      fail(`--did verilmedi ve anahtar dosyasi da yok: ${keyfile}\n` +
           'Ya --did <did:key:...> gecin ya da once "keygen" calistirin.');
    }
    did = keystore.load(keyfile).did;
    process.stdout.write(`DID anahtar dosyasindan alindi: ${keyfile}\n`);
  }
  if (!did.startsWith('did:key:z6Mk')) {
    fail(`gecersiz did: "did:key:z6Mk..." bekleniyor (alinan: ${did})`);
  }

  const rooms = values.room ? [assertName(values.room, 'oda adi')] : ['lobby'];
  const maxPages = values['max-pages'] ? Number.parseInt(values['max-pages'], 10) : undefined;
  if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1)) {
    fail('--max-pages pozitif bir tamsayi olmali');
  }

  process.stdout.write(`\n${line('=')}\nETKINLIK\n${line('=')}\n`);
  process.stdout.write(`DID    : ${did}\n`);
  process.stdout.write(`Odalar : ${rooms.join(', ')}${rooms.includes('lobby') ? ' (+ varsa mailbox)' : ''}\n`);
  process.stdout.write('Kaynak : technocore.chat (yalnizca okuma)\n');

  let report;
  try {
    report = await collectActivity({ did, rooms, maxPages });
  } catch (err) {
    if (err instanceof NetworkError) fail(err.message);
    throw err;
  }

  if (report.mailbox) {
    process.stdout.write(`Mailbox: ${report.mailbox} (DID notundan bulundu)\n`);
  } else if (report.mailboxError) {
    process.stdout.write(`Mailbox: okunamadi - ${report.mailboxError}\n`);
  }

  let scannedTotal = 0;
  let truncatedAny = false;
  let degradedStatus = null;
  let okRooms = 0;
  for (const room of report.rooms) {
    process.stdout.write(`\n${line()}\n${room.room}\n${line()}\n`);
    if (room.error) {
      process.stdout.write(`  okunamadi: ${room.error}\n`);
      continue;
    }
    okRooms++;
    scannedTotal += room.scanned;
    truncatedAny = truncatedAny || room.truncated;
    degradedStatus = degradedStatus ?? room.degradedStatus;
    process.stdout.write(`  ${room.scanned} mesaj tarandi, ${room.matched.length} eslesme\n`);
    if (room.truncated) {
      process.stdout.write('  UYARI: sayfa siniri doldu, oda tamamen taranamadi (--max-pages ile artirin)\n');
    }
    if (room.matched.length > 0) process.stdout.write('\n');
    for (const message of room.matched) {
      process.stdout.write(`${formatMessage(message, { room: room.room })}\n\n`);
    }
  }

  process.stdout.write(`${line('=')}\n`);
  if (degradedStatus) {
    process.stdout.write(
      `NOT: sunucu HTTP ${degradedStatus} bildirdi ama gecerli veri dondurdu; ` +
        'sonuclar eksik olabilir.\n',
    );
  }
  if (okRooms === 0) {
    // Hicbir oda okunamadi: bunu "mesaj yok" gibi sunmak yaniltici olurdu.
    process.stdout.write(
      'Hicbir oda okunamadi - yukaridaki hatalara bakin. Bu, DID in mesaji ' +
        'olmadigi anlamina GELMEZ.\n',
    );
  } else if (report.total === 0) {
    process.stdout.write(
      `Bu DID icin gorunur mesaj bulunamadi (${scannedTotal} mesaj tarandi).\n` +
        'Sunucu her odada yalnizca son N mesaji tutar - eski mesajlar dusmus olabilir.\n',
    );
    if (truncatedAny) {
      process.stdout.write('Ayrica sayfa siniri nedeniyle odanin tamami taranmadi.\n');
    }
  } else {
    process.stdout.write(`Toplam ${report.total} mesaj bulundu (${scannedTotal} mesaj tarandi).\n`);
  }
  process.stdout.write('\n');
}

// --- giris noktasi -----------------------------------------------------------

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    fail(`${err.message}\n\n${helpText()}`);
  }
  const { values, positionals } = parsed;
  const command = positionals[0] ?? 'wizard';

  if (values.help || command === 'help') {
    process.stdout.write(helpText());
    return;
  }

  switch (command) {
    case 'wizard':
      return cmdWizard(values);
    case 'links':
      return cmdWizard(values, { requireExisting: true });
    case 'keygen':
      return cmdKeygen(values);
    case 'sign':
      return cmdSign(values);
    case 'verify':
      return cmdVerify(values);
    case 'activity':
      return cmdActivity(values);
    default:
      fail(`bilinmeyen komut: ${command}\n${helpText()}`);
  }
}

main(process.argv.slice(2)).catch((err) => fail(err.message));

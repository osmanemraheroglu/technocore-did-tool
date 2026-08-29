import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlan, normalizeMailboxRoom, normalizeUrl, normalizeXHandle } from '../src/compose.js';
import { createIdentity, keysOf } from '../src/keystore.js';
import { verifyMessage } from '../src/sign.js';
import { isSwept } from '../src/sweep.js';
import { fingerprint, shard } from '../src/did.js';

function plan(overrides = {}) {
  const store = createIdentity();
  return buildPlan({
    store,
    keys: keysOf(store),
    agent: 'demo-agent',
    xHandle: 'demo_user',
    contributionKind: 'kod',
    contributionUrl: 'https://example.com/pr/1',
    description: 'Tek cumlelik aciklama.',
    ...overrides,
  });
}

test('X kullanici adi normalize edilir', () => {
  assert.equal(normalizeXHandle('@demo'), 'demo');
  assert.equal(normalizeXHandle('  @@demo_1 '), 'demo_1');
  assert.throws(() => normalizeXHandle('cok-uzun-ve-tireli'), /gecersiz/);
  assert.throws(() => normalizeXHandle(''), /gecersiz/);
  assert.throws(() => normalizeXHandle('a'.repeat(16)), /gecersiz/);
});

test('katki linki http(s) olmali', () => {
  assert.equal(normalizeUrl(' https://example.com/x '), 'https://example.com/x');
  assert.throws(() => normalizeUrl('ornek.com'), /gecersiz/);
  assert.throws(() => normalizeUrl('javascript:alert(1)'), /http/);
  assert.throws(() => normalizeUrl('file:///etc/passwd'), /http/);
});

test('mailbox oda adi tek bicime indirgenir', () => {
  // Onek yazilsin ya da yazilmasin, sonuc ayni olmali.
  assert.equal(normalizeMailboxRoom('emrahFC'), 'mb-emrahfc');
  assert.equal(normalizeMailboxRoom('mb-emrahFC'), 'mb-emrahfc');
  assert.equal(normalizeMailboxRoom('  MB-Emrah FC '), 'mb-emrah-fc');
  // Cift onek: kullanici "mb-" yazip arac da eklerse "mb-mb-..." olusurdu.
  assert.equal(normalizeMailboxRoom('mb-mb-x'), 'mb-x');
  assert.throws(() => normalizeMailboxRoom('!!!'), /donusturulemedi/);
});

test('mailbox olmadan uc adim uretilir', () => {
  const p = plan();
  assert.deepEqual(
    p.steps.map((s) => s.id),
    ['a', 'b', 'c'],
  );
  assert.equal(p.steps[1].kind, 'note');
  assert.equal(p.steps.filter((s) => s.kind === 'signed').length, 2);
});

test('mailbox ile dordu adim eklenir ve nota islenir', () => {
  const p = plan({ mailboxRoom: 'mb-demo' });
  assert.deepEqual(
    p.steps.map((s) => s.id),
    ['a', 'b', 'c', 'd'],
  );
  const note = p.steps.find((s) => s.id === 'b');
  assert.ok(note.value.includes('mailbox:mb-demo'));
  const mailbox = p.steps.find((s) => s.id === 'd');
  assert.equal(mailbox.room, 'mb-demo');
  assert.equal(mailbox.kind, 'signed');
});

test('mailbox odasi mb- ile baslamali', () => {
  assert.throws(() => plan({ mailboxRoom: 'demo' }), /ile baslamali/);
});

test('her imzali adim bagimsiz olarak dogrulanabilir', () => {
  const p = plan({ mailboxRoom: 'mb-demo' });
  for (const step of p.steps.filter((s) => s.kind === 'signed')) {
    assert.ok(
      verifyMessage(p.did, step.sig, step.room, step.nonce, step.text),
      `${step.id} dogrulanamadi`,
    );
    assert.equal(step.signedBytes, `${step.room}|${step.nonce}|${step.text}`);
    assert.ok(isSwept(step.text), `${step.id} metni supurulmus olmali`);
  }
});

test('lobby deki iki mesajin nonce u artar', () => {
  const p = plan();
  const lobby = p.steps.filter((s) => s.room === 'lobby');
  assert.equal(lobby.length, 2);
  assert.ok(BigInt(lobby[1].nonce) > BigInt(lobby[0].nonce));
});

test('katki mesaji url, etiket ve DID icerir', () => {
  const p = plan();
  const contribution = p.steps.find((s) => s.id === 'c');
  assert.ok(contribution.text.includes('https://example.com/pr/1'));
  assert.ok(contribution.text.includes('@flop_labs'));
  assert.ok(contribution.text.includes(p.did));
  assert.ok(contribution.text.includes('kod'));
  // Kanonik dize "|" ile bolundugu icin metne "|" sokmuyoruz.
  assert.ok(!contribution.rawText.includes('|'));
});

test('DID notu patterns.md bicimine uyar: did ilk sirada, bosluk ayrac', () => {
  const p = plan({ mailboxRoom: 'mb-demo' });
  const note = p.steps.find((s) => s.id === 'b');
  const tokens = note.value.split(' ');
  assert.equal(tokens[0], p.did, 'did:key ilk token olmali');
  assert.ok(tokens.includes('name:demo-agent'));
  assert.ok(tokens.includes('x:@demo_user'));
  assert.ok(tokens.includes('mailbox:mb-demo'));
  assert.equal(note.ns, shard(fingerprint(p.did)).ns);
  assert.equal(note.key, shard(fingerprint(p.did)).key);
});

test('tum linkler technocore.chat e isaret eder', () => {
  const p = plan({ mailboxRoom: 'mb-demo' });
  for (const step of p.steps) {
    assert.ok(step.url.startsWith('https://technocore.chat/'), step.url);
  }
});

test('gecersiz agent adi reddedilir', () => {
  assert.throws(() => plan({ agent: 'Demo Agent' }), /agent adi gecersiz/);
});

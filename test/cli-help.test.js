import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src', 'cli.js');
const dir = mkdtempSync(join(tmpdir(), 'tc-bin-'));
after(() => rmSync(dir, { recursive: true, force: true }));

/** cli.js'i verilen bin adiyla (sembolik bag) calistirir - npm kurulumunun taklidi. */
function runAs(binName, args = ['--help']) {
  const link = join(dir, binName);
  try {
    symlinkSync(CLI, link);
  } catch {
    /* zaten var */
  }
  return execFileSync(link, args, { encoding: 'utf8' });
}

test('kaynaktan calistirinca yardim "node src/cli.js" gosterir', () => {
  const out = execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.match(out, /node src\/cli\.js <komut>/);
  assert.match(out, /npm start/, 'kaynak kullanicisi icin sihirbaz npm start');
});

test('kurulu bin adiyla calistirinca yardim o adi gosterir', () => {
  const out = runAs('technocore-did-tool');
  assert.match(out, /technocore-did-tool <komut>/);
  // Kurulu kullaniciya kaynak yolu gosterilmemeli.
  assert.ok(!out.includes('node src/cli.js'), 'kurulu modda kaynak yolu gecmemeli');
  assert.ok(!out.includes('npm start'), 'kurulu modda npm start gecmemeli');
});

test('kisa bin adi kullanilirsa yardim kisa adi gosterir', () => {
  const out = runAs('technocore-did');
  assert.match(out, /technocore-did <komut>/);
  assert.ok(!out.includes('node src/cli.js'));
});

test('ORNEKLER bolumu da calisma bicimine uyar', () => {
  const kurulu = runAs('technocore-did-tool');
  const ornekler = kurulu.slice(kurulu.indexOf('ORNEKLER'));
  assert.match(ornekler, /technocore-did-tool sign --room lobby/);
  assert.match(ornekler, /technocore-did-tool activity/);
  assert.ok(!ornekler.includes('node src/cli.js'));
});

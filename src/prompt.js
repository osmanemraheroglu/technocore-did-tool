/**
 * Kucuk, bagimliliksiz soru-cevap katmani (node:readline/promises).
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export function createPrompter() {
  const rl = createInterface({ input: stdin, output: stdout });

  /**
   * @param {string} question
   * @param {{ required?: boolean, defaultValue?: string,
   *           validate?: (v: string) => string|void, maxLength?: number }} [opts]
   */
  async function ask(question, opts = {}) {
    const { required = true, defaultValue, validate, maxLength } = opts;
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    for (;;) {
      const raw = (await rl.question(`${question}${suffix}: `)).trim();
      const value = raw || defaultValue || '';

      if (!value && required) {
        stdout.write('  ! Bu alan zorunlu.\n');
        continue;
      }
      if (maxLength && value.length > maxLength) {
        stdout.write(`  ! En fazla ${maxLength} karakter (girilen: ${value.length}).\n`);
        continue;
      }
      if (validate) {
        try {
          validate(value);
        } catch (err) {
          stdout.write(`  ! ${err.message}\n`);
          continue;
        }
      }
      return value;
    }
  }

  /** Evet/hayir sorusu. */
  async function confirm(question, defaultYes = false) {
    const hint = defaultYes ? '[E/h]' : '[e/H]';
    for (;;) {
      const raw = (await rl.question(`${question} ${hint}: `)).trim().toLowerCase();
      if (!raw) return defaultYes;
      if (['e', 'evet', 'y', 'yes'].includes(raw)) return true;
      if (['h', 'hayir', 'hayır', 'n', 'no'].includes(raw)) return false;
      stdout.write('  ! e / h yazin.\n');
    }
  }

  return { ask, confirm, close: () => rl.close() };
}

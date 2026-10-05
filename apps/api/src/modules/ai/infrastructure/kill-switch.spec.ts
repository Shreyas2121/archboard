import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aiKillSwitch } from './kill-switch.js';

it('disables spending on marker presence and resumes only after operator removal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'archboard-ai-switch-'));
  const file = join(directory, 'disabled');
  try {
    const disabled = aiKillSwitch(file);
    expect(disabled()).toBe(false);
    writeFileSync(file, 'contents are irrelevant');
    expect(disabled()).toBe(true);
    unlinkSync(file);
    expect(disabled()).toBe(false);
    expect(aiKillSwitch(undefined)()).toBe(false);
  } finally {
    rmdirSync(directory);
  }
});

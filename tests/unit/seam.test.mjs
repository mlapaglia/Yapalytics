import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

/*
 * Spec 014 R12: browser tests read the app's state only through tests/e2e/state.mjs, so
 * moving state in the app changes that one file. These are the names they must not use.
 */
const INTERNALS = /(?:(?<![\w.$])|(?<=\.\.\.))S\.\w|(?<![\w.$])(?:inRange|baseMessages|refresh|openProfile|plainName|readDay|showMoodMessages|renderVocab|moodLib|setPickerValue|syncPeopleLink)\(/;

describe('spec 014 test seam', () => {
  it('AC5: no browser test but state.mjs reaches into the app state', () => {
    const dir = new URL('../e2e/', import.meta.url);
    const offenders = [];
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'state.mjs')) {
      readFileSync(new URL(name, dir), 'utf8').split('\n').forEach((line, i) => {
        if (INTERNALS.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(offenders, []);
  });
});

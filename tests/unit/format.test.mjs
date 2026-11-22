import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { loadApp } from '../helpers/load.mjs';

const { fmtDate, DATE_FORMATS, hourText, pctText, shareText, andList, ordinal } = loadApp(['fmtDate', 'DATE_FORMATS', 'hourText', 'pctText', 'shareText', 'andList', 'ordinal']);

describe('spec 014 formatting', () => {
  it('formats dates exactly as the toLocaleDateString calls it replaced', () => {
    const times = [Date.UTC(2024, 2, 5, 17, 29), Date.UTC(1999, 11, 31, 0, 5), Date.UTC(2020, 1, 29, 12)];
    for (const [name, opts] of Object.entries(DATE_FORMATS)) {
      const timeOnly = 'hour' in opts;
      for (const t of times) {
        const want = timeOnly ? new Date(t).toLocaleTimeString(undefined, opts) : new Date(t).toLocaleDateString(undefined, opts);
        assert.equal(fmtDate[name](t), want, name);
        assert.equal(fmtDate[name](new Date(t)), want, `${name} (Date)`);
      }
    }
    assert.equal(hourText(17), new Date(2000, 0, 1, 17).toLocaleTimeString(undefined, { hour: 'numeric' }));
  });

  it('keeps one copy of each small helper', () => {
    assert.equal(pctText(0.425), '43%');
    assert.equal(shareText(1, 4), '25%');
    assert.equal(shareText(1, 0), '–');
    assert.equal(andList(['a', 'b', 'c']), 'a, b and c');
    assert.equal(ordinal(22), '22nd');
  });

  it('writes date formats only in format.js', () => {
    const files = (dir) => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === 'vendor' ? [] : files(`${dir}${e.name}/`)) : e.name.endsWith('.js') ? [`${dir}${e.name}`] : []);
    const offenders = files('../../js/').filter((f) => !f.endsWith('/format.js') &&
      /toLocale(?:Date|Time)String/.test(readFileSync(new URL(f, import.meta.url), 'utf8')));
    assert.deepEqual(offenders, []);
  });
});

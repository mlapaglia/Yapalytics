import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from '../helpers/load.mjs';

// The demo names its files after the current time: pin it so two builds can be compared.
const NOW = Date.parse('2026-11-27T12:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
const { buildDemoFiles, demoPng } = loadApp(['buildDemoFiles', 'demoPng'], { Date: FixedDate });
const bytes = async (file) => Buffer.from(await file.arrayBuffer());

describe('demo data', () => {
  it('builds the same files every time, photos included', async () => {
    const [a, b] = [buildDemoFiles(), buildDemoFiles()];
    assert.deepEqual(b.map((f) => f.name), a.map((f) => f.name));
    for (let i = 0; i < a.length; i++) assert.ok((await bytes(a[i])).equals(await bytes(b[i])), a[i].name);
  });

  it('reuses photos without changing the random numbers the rest of the demo reads', () => {
    const counter = () => {
      let n = 0;
      return { rand: () => (n++ % 97) / 97, read: () => n };
    };
    demoPng.pool = new Map();
    const c = counter();
    const pngs = [];
    for (let i = 0; i < 20; i++) {
      const before = c.read();
      pngs.push(demoPng(c.rand));
      assert.equal(c.read() - before, 6, `photo ${i} read 6 random numbers`);
    }
    assert.equal(new Set(pngs).size, 8);
    const png = Buffer.from(pngs[19]);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [160, 120]);
  });
});

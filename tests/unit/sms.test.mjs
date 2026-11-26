/*
 * The SMS Backup & Restore parser (smsParserWorker in parser.js): MMS attachments are
 * skipped while reading, but where each one sits in the file is kept so it can be
 * opened later (att.b, att.l).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runParser } from '../helpers/worker.mjs';

const b64 = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff)).toString('base64');
const mms = (t, parts) => `  <mms date="${t}" msg_box="1" address="+15550001111" m_type="132" contact_name="Alex">\n    <parts>\n${parts}    </parts>\n    <addrs>\n      <addr address="+15550001111" type="137" charset="106" />\n    </addrs>\n  </mms>\n`;
const part = (name, data, q = '"') => `      <part seq="0" ct="image/jpeg" name="${name}" cl="${name}" data=${q}${data}${q} />\n`;

describe('SMS backup attachments', () => {
  it('keeps where each attachment is in the file, across chunks and after multi-byte text', async () => {
    const big = b64(15 * 1024 * 1024, 7); // 20 MB of base64: spans several 8 MB chunks
    const datas = [b64(30, 1), big, b64(3000, 2), b64(10, 3)];
    const xml = '﻿<?xml version="1.0" encoding="UTF-8"?>\n<smses count="6">\n' +
      '  <sms address="+15550001111" date="1700000000000" type="1" body="héllo 😂 data=&quot;not this&quot;" contact_name="Alex" />\n' +
      mms(1700000001000, part('a.jpg', datas[0])) +
      mms(1700000002000, part('big.jpg', datas[1]) + part('c.jpg', datas[2])) +
      '  <sms address="+15550001111" date="1700000003000" type="2" body="ünïcödé ✨ data=" contact_name="Alex" />\n' +
      mms(1700000004000, part('d.jpg', datas[3], "'")) +
      '</smses>\n';
    const bytes = Buffer.from(xml, 'utf8');
    const out = await runParser('parser.js', 'smsParserWorker', { file: new File([bytes], 'sms.xml') });

    assert.equal(out.msgs.length, 5);
    const atts = out.msgs.flatMap((m) => m.att || []);
    assert.deepEqual(atts.map((a) => a.n), ['a.jpg', 'big.jpg', 'c.jpg', 'd.jpg']);
    atts.forEach((a, i) => {
      assert.equal(a.l, datas[i].length, a.n);
      assert.equal(bytes.subarray(a.b, a.b + a.l).toString('latin1'), datas[i], a.n);
    });
    assert.deepEqual(out.msgs.filter((m) => !m.att).map((m) => m.b), ['héllo 😂 data="not this"', 'ünïcödé ✨ data=']);
  });
});

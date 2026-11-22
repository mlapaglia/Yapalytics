import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from '../helpers/load.mjs';

const { html, raw, escapeHtml, stackTooltip, topContactsOption, groupSendersOption, newPeopleOption, callContactsOption } = loadApp(['html', 'raw', 'escapeHtml', 'stackTooltip', 'topContactsOption', 'groupSendersOption', 'newPeopleOption', 'callContactsOption']);

const EVIL = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';
const ui = {
  surface: '#fff', text: '#111', text2: '#333', muted: '#888', grid: '#eee', axis: '#ccc', border: '#ddd', empty: '#f5f5f5',
  series: ['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8'], heat: ['#a', '#b', '#c', '#d', '#e'], sent: '#1', recv: '#2',
};

describe('html`…`', () => {
  it('escapes interpolated text', () => {
    assert.equal(String(html`<b>${EVIL}</b>`), `<b>${ESCAPED}</b>`);
    assert.equal(escapeHtml(`"Tom" & 'Jerry'`), '&quot;Tom&quot; &amp; &#39;Jerry&#39;');
  });

  it('nests html`…` and raw() without escaping them again', () => {
    const inner = html`<i>${'a & b'}</i>`;
    assert.equal(String(html`<p>${inner}${raw('<br>')}</p>`), '<p><i>a &amp; b</i><br></p>');
  });

  it('joins arrays and drops null, undefined and false', () => {
    assert.equal(String(html`${['<', html`<i>x</i>`, 2]}|${null}|${undefined}|${false}|${0}`), '&lt;<i>x</i>2||||0');
  });

  it('turns into its markup where a string is wanted', () => {
    assert.equal(`${html`<b>${'&'}</b>`}`, '<b>&amp;</b>');
  });
});

describe('spec 014 escaping in chart tooltips', () => {
  it('AC1: stacked tooltips escape the axis label and series names', () => {
    const out = stackTooltip([{ axisValueLabel: EVIL, seriesName: EVIL, color: '#000', value: 3 }]);
    assert.equal(typeof out, 'string');
    assert.ok(!out.includes('<img'));
    assert.ok(out.includes(ESCAPED));
  });

  it('AC1: top conversations, group senders, new people and call contacts escape names', () => {
    const tips = [
      topContactsOption(ui, [{ key: 'k', label: EVIL, s: 1, r: 2 }]).tooltip.formatter([{ dataIndex: 0, color: '#000', seriesName: 'Sent', value: 1 }]),
      groupSendersOption(ui, [{ label: EVIL, n: 3, you: false }]).tooltip.formatter([{ dataIndex: 0, value: 3 }]),
      newPeopleOption(ui, [{ mo: 2024 * 12, n: 1, names: [EVIL] }]).tooltip.formatter([{ dataIndex: 0, value: [Date.UTC(2024, 0, 1), 1] }]),
      callContactsOption(ui, [{ label: EVIL, talk: 60, n: 1 }]).tooltip.formatter([{ dataIndex: 0, value: 60 }]),
    ];
    for (const out of tips) {
      assert.equal(typeof out, 'string');
      assert.ok(!out.includes('<img'), out);
      assert.ok(out.includes(ESCAPED), out);
    }
  });
});

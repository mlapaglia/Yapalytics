/*
 * Small helpers the dashboard's panels and dialogs share: element lookup, conversation
 * names, dates, and the KPI tile.
 */

const $ = (sel) => document.querySelector(sel);

const $$ = (sel) => [...document.querySelectorAll(sel)];

const show = (sel, on) => ($(sel).hidden = !on);

const DAY_MS = 86400000;

const logoSvg = (s) => html`<svg class="logo" aria-hidden="true"><use href="#logo-${Sources.byId(s).logo}"/></svg>`;

/** An app's chart colour as the --app custom property (spec 010's app edges and dots). */
const appColor = (s) => `--app: var(--series-${((s || 0) % 8) + 1})`;

const countWords = (n, calls = 0) => [n && `${fmtNum(n)} message${n === 1 ? '' : 's'}`, calls && `${fmtNum(calls)} call${calls === 1 ? '' : 's'}`].filter(Boolean).join(', ');

function labelFor(key) {
  const c = Data.contacts.get(key);
  return c ? c.label : key;
}

/** A conversation's name without its app mark, for sentences. */
function plainName(key) {
  const c = Data.contacts.get(key);
  if (!c) return key;
  if (c.person) return formatAddr(c.name) || key;
  if (c.group) return c.name ? c.name.split(', ').map(formatAddr).join(', ') : c.addr.split('~').map(formatAddr).join(', ') || 'Group chat';
  return formatAddr(c.name) || formatAddr(c.addr) || key;
}

/** A person's display name for a group sender: a name, a phone number, or an SMS 1-on-1 key. */
function senderLabel(x) {
  if (x === 'You') return 'You';
  const own = Data.contacts.get(x);
  if (own) return own.name || formatAddr(own.addr) || x;
  const digits = x.replace(/[^\d]/g, '');
  if (digits.length >= 7 && /^[+\d\s().-]+$/.test(x)) {
    const sms = Data.contacts.get(digits.length > 8 ? digits.slice(-8) : digits);
    if (sms && sms.name) return sms.name;
  }
  return formatAddr(x);
}

const personLink = (k, text = plainName(k)) => html`<button type="button" class="person-link" data-profile="${k}">${text}</button>`;

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

const agoText = (t) => (Date.now() - t < DAY_MS ? 'today' : `${fmtGap(Date.now() - t)} ago`);

function shortDate(d) {
  return fmtDate.day(dayToTs(d));
}

/** Highlight parts (strings, { b }, { k, text }) as HTML. */
function partsHtml(parts) {
  return html`${parts.map((p) => (typeof p === 'string' ? p : p.k != null ? personLink(p.k, p.text) : html`<b>${p.b}</b>`))}`;
}

/** Who sent a message, for On this day: "You → Alex", "Alex", "Sam in Book Club". */
function momentSender(m) {
  const all = View.filter.contact === 'all';
  if (m.o) return all ? `You → ${plainName(m.k)}` : 'You';
  const group = m.k.startsWith('g:');
  const who = group && (m.sn || m.sk) ? senderLabel(m.sn || m.sk) : group ? 'Someone' : plainName(m.k);
  return group && all ? `${who} in ${plainName(m.k)}` : who;
}

/** A KPI tile. Text is escaped; pass html`…` for a value or sub with markup (<small>). */
function kpi(label, value, sub = '', title = '') {
  return html`<div class="kpi" title="${title}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

/**
 * Show one calendar day in the message list. `contact` also focuses a conversation;
 * `clearMood` drops the mood chart's pick.
 */
function readDay(dayStart, { contact = null, clearMood = false, clearSearch = false } = {}) {
  const d = new Date(dayStart);
  const filter = { from: dayStart, to: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1 };
  if (contact) {
    filter.contact = contact;
    setPickerValue($('#contactSel'), contact);
  }
  const browser = {};
  if (clearMood) browser.mood = null;
  if (clearSearch) {
    browser.query = '';
    $('#search').value = '';
  }
  View.set(Object.keys(browser).length ? { filter, browser } : { filter });
  Tabs.select('sec-messages');
}

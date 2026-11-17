/*
 * Small SMS Backup & Restore backups (sms-*.xml) for tests.
 */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * An SMS backup file of `messages`: { address, name, at (ISO date-time), sent, body }.
 * `name` is the contact name the phone had for that number.
 */
export function smsBackup(messages, fileName = 'sms-20240821.xml') {
  const rows = messages.map(({ address, name = '', at, sent = false, body = '' }) =>
    `  <sms protocol="0" address="${esc(address)}" date="${Date.parse(at)}" type="${sent ? 2 : 1}" body="${esc(body)}" read="1" status="-1" contact_name="${esc(name || '(Unknown)')}" />`);
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<smses count="${messages.length}">\n${rows.join('\n')}\n</smses>\n`;
  return { name: fileName, mimeType: 'text/xml', buffer: Buffer.from(xml, 'utf8') };
}

/** A call log file (calls-*.xml) of `calls`: { number, name, at, type (1 in, 2 out, 3 missed), duration (seconds) }. */
export function callLog(calls, fileName = 'calls-20240821.xml') {
  const rows = calls.map(({ number, name = '', at, type = 1, duration = 0 }) =>
    `  <call number="${esc(number)}" duration="${duration}" date="${Date.parse(at)}" type="${type}" presentation="1" contact_name="${esc(name || '(Unknown)')}" />`);
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<calls count="${calls.length}">\n${rows.join('\n')}\n</calls>\n`;
  return { name: fileName, mimeType: 'text/xml', buffer: Buffer.from(xml, 'utf8') };
}

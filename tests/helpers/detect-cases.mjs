/*
 * Files for checking which app an export is detected as (spec 014 AC7): every demo
 * export, the test helpers' exports, and the odd cases (HTML exports, thread files on
 * their own, parts of split exports, files that aren't exports).
 */
import { loadApp } from './load.mjs';
import { makeZip } from './zip.mjs';
import * as ig from './instagram.mjs';
import * as fb from './messenger.mjs';
import * as tg from './telegram.mjs';
import { smsBackup, callLog } from './sms.mjs';
import { takeoutChats, ALEX, ME } from './takeout.mjs';

const asFile = (spec) => new File([spec.buffer], spec.name, { type: spec.mimeType });
const zip = (name, entries) => asFile({ name, mimeType: 'application/zip', buffer: makeZip(entries) });
const text = (name, body, type = 'text/plain') => new File([body], name, { type });

/** [label, File] pairs. */
export function detectCases() {
  const { buildDemoFiles } = loadApp(['buildDemoFiles']);
  const cases = buildDemoFiles().map((f, i) => [`demo ${i + 1}: ${f.name.replace(/\d/g, '#')}`, f]);
  const [igPart1, igPart2] = ig.splitExport().map(asFile);
  const [fbPart1, fbPart2] = fb.splitFacebookExport().map(asFile);
  cases.push(
    ['SMS backup', asFile(smsBackup([]))],
    ['call log', asFile(callLog([]))],
    ['Google Takeout', asFile(takeoutChats([{ dir: 'DM Alex', members: [ME, ALEX], from: [ALEX, ME] }]))],
    ['WhatsApp .txt', text('WhatsApp Chat with Alex.txt', '1/2/24, 10:00 - Alex: hi\n')],
    ['WhatsApp zip with _chat.txt', zip('WhatsApp Chat - Alex.zip', [{ name: '_chat.txt', data: '[1/2/24, 10:00:00] Alex: hi\n' }])],
    ['iMessage .txt', text('Alex.txt', 'May 17, 2022  5:29:42 PM\nAlex\nhi\n')],
    ['iMessage zip', zip('imessage_export.zip', [{ name: 'imessage_export/Alex.txt', data: 'May 17, 2022  5:29:42 PM\nAlex\nhi\n' }, { name: 'imessage_export/orphaned.txt', data: '' }])],
    ['Telegram result.json', asFile(tg.resultJson(tg.fullExport()))],
    ['Telegram zipped export', asFile(tg.zippedFullExport())],
    ['Telegram zipped chat', asFile(tg.zippedSingleChatExport())],
    ['Telegram HTML export zip', asFile(tg.zippedHtmlExport())],
    ['Telegram messages.html', text('messages.html', '<html></html>', 'text/html')],
    ['Instagram zip', asFile(ig.zippedExport())],
    ['Instagram split part 1', igPart1],
    ['Instagram split part 2', igPart2],
    ['Instagram loose thread', asFile(ig.looseThread())],
    ['Instagram HTML export zip', asFile(ig.zippedHtmlExport())],
    ['Instagram message_1.html', text('message_1.html', '<html></html>', 'text/html')],
    ['Facebook zip', asFile(fb.facebookExport())],
    ['Facebook split part 1', fbPart1],
    ['Facebook split part 2', fbPart2],
    ['Facebook loose thread', asFile(fb.looseFacebookThread())],
    ['Facebook HTML export zip', asFile(fb.facebookHtmlExport())],
    ['Messenger encrypted thread', asFile(fb.encryptedThread())],
    ['Messenger encrypted zip', asFile(fb.encryptedExport())],
    ['Messenger encrypted zip in a folder', asFile(fb.encryptedExport('secure_storage/'))],
    ['an HTML page', text('page.html', '<html></html>', 'text/html')],
    ['a zip of photos', zip('photos.zip', [{ name: 'a.jpg', data: 'x' }])],
  );
  return cases;
}

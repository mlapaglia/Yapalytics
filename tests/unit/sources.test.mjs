import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from '../helpers/load.mjs';
import { detectCases } from '../helpers/detect-cases.mjs';

const { detectFile, Sources, hasOwner, isDefaultOwner, sourceName, sourceNames } = loadApp(['detectFile', 'Sources', 'hasOwner', 'isDefaultOwner', 'sourceName', 'sourceNames']);

/**
 * What the old fileKind() in app.js returned for each case, recorded before detection
 * moved into the registry (spec 014 AC7): a kind, or the error it threw.
 */
const EXPECTED = new Map([
  ["demo 1: sms-##############.xml", "sms"],
  ["demo 2: calls-##############.xml", "sms"],
  ["demo 3: takeout-########T######Z-#-###.zip", "gchat"],
  ["demo 4: takeout-########T######Z-#-###.zip", "gchat"],
  ["demo 5: WhatsApp Chat with Nadia Haddad.txt", "whatsapp"],
  ["demo 6: WhatsApp Chat - Book Club 📚.zip", "whatsapp"],
  ["demo 7: Riley Chen.txt", "imessage"],
  ["demo 8: Family 🏡 - #.txt", "imessage"],
  ["demo 9: orphaned.txt", "imessage"],
  ["demo 10: Telegram Desktop.zip", "telegram"],
  ["demo 11: instagram-jamiepark-####-##-##-dEmO##.zip", "instagram"],
  ["demo 12: facebook-jamiepark-####-##-##-dEmO##.zip", "messenger"],
  ["demo 13: messenger-encrypted-chats-####-##-##.zip", "messenger"],
  ["SMS backup", "sms"],
  ["call log", "sms"],
  ["Google Takeout", "gchat"],
  ["WhatsApp .txt", "whatsapp"],
  ["WhatsApp zip with _chat.txt", "whatsapp"],
  ["iMessage .txt", "imessage"],
  ["iMessage zip", "imessage"],
  ["Telegram result.json", "telegram"],
  ["Telegram zipped export", "telegram"],
  ["Telegram zipped chat", "telegram"],
  ["Telegram HTML export zip", { error: "This is Telegram's HTML export, which can't be read. Export again and choose “Machine-readable JSON” as the format." }],
  ["Telegram messages.html", { error: "This is Telegram's HTML export, which can't be read. Export again and choose “Machine-readable JSON” as the format." }],
  ["Instagram zip", "instagram"],
  ["Instagram split part 1", "instagram"],
  ["Instagram split part 2", "instagram"],
  ["Instagram loose thread", "instagram"],
  ["Instagram HTML export zip", { error: "This is Instagram's HTML export, which can't be read. Export again and choose “JSON” as the format." }],
  ["Instagram message_1.html", { error: "This is Instagram's HTML export, which can't be read. Export again and choose “JSON” as the format." }],
  ["Facebook zip", "messenger"],
  ["Facebook split part 1", "messenger"],
  ["Facebook split part 2", "messenger"],
  ["Facebook loose thread", "messenger"],
  ["Facebook HTML export zip", { error: "This is Facebook's HTML export, which can't be read. Export again and choose “JSON” as the format." }],
  ["Messenger encrypted thread", "messenger"],
  ["Messenger encrypted zip", "messenger"],
  ["Messenger encrypted zip in a folder", "messenger"],
  ["an HTML page", { error: "page.html isn't an export this app can read" }],
  ["a zip of photos", { error: "photos.zip isn't a Google Takeout, WhatsApp, iMessage, Telegram, Instagram or Messenger export" }],
]);

describe('spec 014 app registry', () => {
  it('AC7: detects every export as the old detection did', async () => {
    const cases = detectCases();
    assert.deepEqual(cases.map(([label]) => label), [...EXPECTED.keys()]);
    for (const [label, file] of cases) {
      let got;
      try {
        got = await detectFile(file);
      } catch (err) {
        got = { error: err.message };
      }
      assert.deepEqual(got, EXPECTED.get(label), label);
    }
  });

  it('R4: describes each app once, with unique ids and kinds', () => {
    assert.deepEqual(Sources.list.map((s) => s.id), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(new Set(Sources.list.map((s) => s.kind)).size, Sources.list.length);
    assert.deepEqual(Sources.list.filter((s) => s.senderNames).map((s) => s.id), [2, 3, 4, 5, 6]);
    assert.equal(hasOwner(3), true);
    assert.equal(hasOwner(0), false);
    assert.equal(isDefaultOwner(3, 'Me'), true);
    assert.equal(isDefaultOwner(2, 'Me'), false);
    assert.equal(sourceName(4), 'Telegram');
    assert.equal(sourceNames()[6], 'Messenger');
    assert.deepEqual(Sources.zeros(), [0, 0, 0, 0, 0, 0, 0]);
  });
});

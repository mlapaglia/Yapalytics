/*
 * Small Telegram Desktop exports (Machine-readable JSON format) for tests.
 * See https://core.telegram.org/import-export
 */
import { makeZip } from './zip.mjs';
import { FIXTURES } from './takeout.mjs';

const T0 = Date.parse('2024-08-20T10:00:00Z') / 1000;
let nextId = 1;

/** One message, `sec` seconds after 2024-08-20 10:00 UTC. */
export function tgMessage(sec, from, fromId, fields = {}) {
  const t = T0 + sec;
  return {
    id: nextId++,
    type: 'message',
    date: new Date(t * 1000).toISOString().slice(0, 19),
    date_unixtime: String(t),
    from,
    from_id: fromId,
    text: '',
    text_entities: [],
    ...fields,
  };
}

const ME = ['Jamie Park', 'user111'];
const ALEX = ['Alex Rivera', 'user222'];
const SAM = ['Sam Patel', 'user333'];

/** A full export: personal_information plus chats of every interesting kind. */
export function fullExport() {
  return {
    about: 'Here is the data you requested.',
    personal_information: { user_id: 111, first_name: 'Jamie', last_name: 'Park', phone_number: '+1 555 0100', bio: '' },
    chats: {
      about: 'This page lists all chats from this export.',
      list: [
        {
          name: 'Alex Rivera', type: 'personal_chat', id: 222, messages: [
            tgMessage(0, ...ME, { text: 'hey' }),
            tgMessage(0, ...ALEX, { text: ['check ', { type: 'link', text: 'https://example.com' }, ' lol'] }), // same second
            { id: nextId++, type: 'service', date: '2024-08-20T10:01:00', date_unixtime: String(T0 + 60), actor: 'Alex Rivera', actor_id: 'user222', action: 'pin_message', text: '', text_entities: [] },
            tgMessage(120, ...ALEX, { photo: 'chats/chat_01/photos/photo_1@20-08-2024_10-02-00.jpg', width: 1600, height: 1200 }),
            tgMessage(180, ...ME, { media_type: 'voice_message', file: '(File not included. Change data exporting settings to download.)', mime_type: 'audio/ogg', duration_seconds: 4 }),
            tgMessage(240, ...ME, { media_type: 'sticker', sticker_emoji: '😂', file: 'chats/chat_01/stickers/sticker.webp', mime_type: 'image/webp' }),
            tgMessage(300, ...ALEX, { text: 'nice', reactions: [
              { type: 'emoji', count: 3, emoji: '👍', recent: [{ from: 'Jamie Park', from_id: 'user111', date: '2024-08-20T10:06:00' }] },
              { type: 'custom_emoji', count: 1, document_id: 'stickers/custom.webp' }, // no emoji to show
            ] }),
            tgMessage(360, ...ALEX, {}), // nothing in it
            tgMessage(420, ...ME, { media_type: 'animation', file: 'chats/chat_01/video_files/party.mp4', mime_type: 'video/mp4', text: 'party time' }),
          ],
        },
        {
          name: 'Weekend Crew', type: 'private_supergroup', id: 4440, messages: [
            tgMessage(1000, ...ALEX, { text: 'who is driving?' }),
            tgMessage(1060, ...SAM, { text: 'me' }),
            tgMessage(1120, ...ME, { text: 'thanks Sam' }),
            tgMessage(1180, null, 'user999', { text: 'from a deleted account' }),
          ],
        },
        { name: 'Tech News', type: 'public_channel', id: 5550, messages: [tgMessage(2000, 'Tech News', 'channel5550', { text: 'big news' })] },
        { type: 'saved_messages', id: 111, messages: [tgMessage(2100, ...ME, { text: 'note to self' })] },
        { name: 'BotFather', type: 'bot_chat', id: 93372553, messages: [tgMessage(2200, ...ME, { text: '/start' }), tgMessage(2201, 'BotFather', 'user93372553', { text: 'I can help you create bots.' })] },
      ],
    },
    left_chats: {
      about: '',
      list: [{ name: 'Old Group', type: 'private_group', id: 6660, messages: [tgMessage(3000, ...SAM, { text: 'bye all' })] }],
    },
  };
}

/** A single-chat export ("Export chat history"): just the chat object, no personal_information. */
export function singleChatExport() {
  return {
    name: 'Alex Rivera', type: 'personal_chat', id: 222, messages: [
      tgMessage(5000, ...ALEX, { text: 'are you around?' }),
      tgMessage(5060, ...ME, { text: 'yep' }),
      tgMessage(5120, ...ALEX, { photo: 'photos/photo_7@20-08-2024_11-25-20.jpg' }),
    ],
  };
}

/** A single group export: nothing in it says which sender is you. */
export function singleGroupExport() {
  return { name: 'Weekend Crew', type: 'private_supergroup', id: 4440, messages: [tgMessage(6000, ...SAM, { text: 'hi' }), tgMessage(6060, ...ALEX, { text: 'hey' })] };
}

/** result.json on its own, as a File (for unit tests) or upload spec (for the browser). */
export function resultJson(data) {
  return { name: 'result.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data, null, 1)) };
}

/** The full export folder zipped (as people zip "DataExport_…"), with its photo. */
export function zippedFullExport() {
  const dir = 'DataExport_2024-08-21/';
  return {
    name: 'Telegram Desktop.zip',
    mimeType: 'application/zip',
    buffer: makeZip([
      { name: dir + 'result.json', data: JSON.stringify(fullExport()), deflate: true },
      { name: dir + 'chats/chat_01/photos/photo_1@20-08-2024_10-02-00.jpg', data: FIXTURES.landscapeJpg() },
      { name: dir + 'chats/chat_01/stickers/sticker.webp', data: Buffer.from('RIFF\0\0\0\0WEBP') },
    ]),
  };
}

/** A single chat's export folder zipped: result.json with photos/ beside it. */
export function zippedSingleChatExport() {
  const dir = 'ChatExport_2024-08-21/';
  return {
    name: 'ChatExport_2024-08-21.zip',
    mimeType: 'application/zip',
    buffer: makeZip([
      { name: dir + 'result.json', data: JSON.stringify(singleChatExport()) },
      { name: dir + 'photos/photo_7@20-08-2024_11-25-20.jpg', data: FIXTURES.portraitHeic() },
    ]),
  };
}

/** Telegram's HTML export, zipped: not readable. */
export function zippedHtmlExport() {
  return {
    name: 'ChatExport_html.zip',
    mimeType: 'application/zip',
    buffer: makeZip([{ name: 'ChatExport_2024-08-21/messages.html', data: '<html></html>' }, { name: 'ChatExport_2024-08-21/css/style.css', data: '' }]),
  };
}

/** Upload spec -> File, for running the parser in Node. */
export const asFile = (spec) => new File([spec.buffer], spec.name, { type: spec.mimeType });

/*
 * Small Messenger exports for tests (spec 009): Facebook's "Download your information" in
 * JSON (same layout as Instagram's, text as escaped UTF-8), and Messenger's download of
 * end-to-end encrypted chats (one <threadName>.json per chat, camelCase, plain UTF-8,
 * media in ./media/).
 */
import { makeZip } from './zip.mjs';
import { FIXTURES } from './takeout.mjs';
import { metaJson } from './instagram.mjs';

const T0 = Date.parse('2024-08-20T10:00:00Z');
const ROOT = 'your_facebook_activity/messages/';
const PROFILE = 'personal_information/profile_information/profile_information.json';

export const ME = 'Jamie Park';
export const ALEX = 'Alex Rivera';
export const SAM = 'Sam Patel';

/** A DYI message, `sec` seconds after 2024-08-20 10:00 UTC. */
export function fbMessage(sec, sender, fields = {}) {
  return { sender_name: sender, timestamp_ms: T0 + sec * 1000, is_geoblocked_for_viewer: false, ...fields };
}

/** A message of the encrypted chats download, `sec` seconds after 2024-08-20 10:00 UTC. */
export function e2eeMessage(sec, sender, fields = {}) {
  return { isUnsent: false, media: [], reactions: [], senderName: sender, text: '', timestamp: T0 + sec * 1000, type: 'text', ...fields };
}

const thread = (path, title, people, messages) => ({ participants: people.map((name) => ({ name })), messages: [...messages].reverse(), title, is_still_participant: true, thread_path: path });
const profile = () => ({ profile_v2: { name: { full_name: ME, first_name: 'Jamie', middle_name: '', last_name: 'Park' } } });

export const ALEX_PHOTO = `${ROOT}inbox/alexrivera_1111/photos/2201.jpg`;

/** The 1-on-1 with Alex, oldest first: 5 messages kept (1 a reaction), 4 left out. */
export const alexMessages = () => [
  fbMessage(0, ALEX, { content: 'hey!! 😂' }),
  fbMessage(60, ME, { content: 'café later? ☕️', reactions: [{ reaction: '❤️', actor: ALEX }] }),
  fbMessage(120, ALEX, { content: `${ALEX} sent a photo.`, photos: [{ uri: ALEX_PHOTO, creation_timestamp: 0 }] }),
  fbMessage(180, ALEX, { content: `${ALEX} sent an attachment.`, share: { link: 'https://example.com/recipe' } }),
  fbMessage(240, ME, { content: 'You sent an attachment.' }), // nothing behind it
  fbMessage(300, ALEX, { content: `${ALEX} called you.`, call_duration: 60 }),
  fbMessage(360, ME, { content: 'oops', is_unsent: true }),
  fbMessage(420, ME, { content: 'Reacted 😂 to your message ' }),
  fbMessage(480, ME, { content: `You set the nickname for ${ALEX} to Al.` }),
];

const groupMessages = () => [
  fbMessage(1000, ALEX, { content: `${ALEX} named the group Road Trip 🚗.` }),
  fbMessage(1100, ME, { content: 'me' }),
  fbMessage(1200, SAM, { content: 'who is driving?' }),
];

/** Every message_1.json of the DYI export, as [path, json]. */
function threadFiles() {
  return [
    [`${ROOT}inbox/alexrivera_1111/message_1.json`, metaJson(thread('inbox/alexrivera_1111', ALEX, [ALEX, ME], alexMessages()))],
    [`${ROOT}archived_threads/roadtrip_2222/message_1.json`, metaJson(thread('archived_threads/roadtrip_2222', 'Road Trip 🚗', [SAM, ALEX, ME], groupMessages()))],
    [`${ROOT}e2ee_cutover/samPatel_3333/message_1.json`, metaJson(thread('e2ee_cutover/samPatel_3333', SAM, [SAM, ME], [fbMessage(2000, SAM, { content: 'old news' })]))],
    [`${ROOT}message_requests/spam_4444/message_1.json`, metaJson(thread('message_requests/spam_4444', 'Spam Bot', ['Spam Bot', ME], [fbMessage(3000, 'Spam Bot', { content: 'Want followers?' })]))],
    [`${ROOT}filtered_threads/spam_5555/message_1.json`, metaJson(thread('filtered_threads/spam_5555', 'Crypto Deals', ['Crypto Deals', ME], [fbMessage(3100, 'Crypto Deals', { content: 'Double your money' })]))],
  ];
}

/** Facebook's DYI export as one zip. */
export function facebookExport() {
  return {
    name: 'facebook-jamiepark-2024-08-21-AbCdEf.zip',
    mimeType: 'application/zip',
    buffer: makeZip([
      { name: PROFILE, data: metaJson(profile()) },
      ...threadFiles().map(([name, data]) => ({ name, data, deflate: true })),
      { name: ALEX_PHOTO, data: FIXTURES.landscapeJpg() },
    ]),
  };
}

/** The same export split in two parts: conversations in one, the photo and profile in the other. */
export function splitFacebookExport() {
  return [
    {
      name: 'facebook-jamiepark-2024-08-21-AbCdEf-part1.zip',
      mimeType: 'application/zip',
      buffer: makeZip(threadFiles().map(([name, data]) => ({ name, data }))),
    },
    {
      name: 'facebook-jamiepark-2024-08-21-AbCdEf-part2.zip',
      mimeType: 'application/zip',
      buffer: makeZip([
        { name: ALEX_PHOTO, data: FIXTURES.landscapeJpg() },
        { name: PROFILE, data: metaJson(profile()) },
      ]),
    },
  ];
}

/** Facebook's HTML export, zipped: not readable. */
export function facebookHtmlExport() {
  return {
    name: 'facebook-jamiepark-html.zip',
    mimeType: 'application/zip',
    buffer: makeZip([{ name: `${ROOT}inbox/alexrivera_1111/message_1.html`, data: '<html></html>' }]),
  };
}

/** Alex's message_1.json picked on its own: its photo uri says it's Facebook's. */
export function looseFacebookThread() {
  return { name: 'message_1.json', mimeType: 'application/json', buffer: Buffer.from(metaJson(thread('inbox/alexrivera_1111', ALEX, [ALEX, ME], alexMessages()))) };
}

/** A message_1.json with no sign of which app it's from: text only, no placeholders. */
export function plainThread() {
  return {
    name: 'message_1.json',
    mimeType: 'application/json',
    buffer: Buffer.from(metaJson(thread('inbox/alexrivera_1111', ALEX, [ALEX, ME], [fbMessage(0, ALEX, { content: 'hi' }), fbMessage(60, ME, { content: 'hello' })]))),
  };
}

export const ALEX_MEDIA = 'media/482a04c4-6739-4871-aecf-9960208a707d.jpeg';

/** Alex's encrypted chat: 8 entries, 1 unsent, so 7 messages; one 😆 reaction and one photo. */
export const alexEncrypted = () => ({
  participants: [ME, ALEX],
  threadName: `${ALEX}_6`,
  messages: [
    e2eeMessage(5000, ME, { text: 'Ty for your support 😁 ' }),
    e2eeMessage(5060, ALEX, { text: 'You know it! 😃' }),
    e2eeMessage(5120, ALEX, { text: 'café 😃' }),
    e2eeMessage(5180, ME, { text: 'wait what? lol', reactions: [{ actor: ALEX, reaction: '😆' }] }),
    e2eeMessage(5240, ME, { media: [{ uri: `./${ALEX_MEDIA}` }], type: 'media' }),
    e2eeMessage(5300, ALEX, { text: 'never mind', isUnsent: true }),
    e2eeMessage(5360, ALEX, { text: 'I’m with you' }),
    e2eeMessage(5420, ME, { text: 'see you Sunday' }),
  ].reverse(), // newest first, as Messenger writes it
});

const samEncrypted = () => ({
  participants: [ME, SAM],
  threadName: `${SAM}_2`,
  messages: [e2eeMessage(6000, SAM, { text: 'new phone who dis' }), e2eeMessage(6060, ME, { text: 'haha hi Sam' })].reverse(),
});

/** One encrypted chat's .json picked on its own. */
export function encryptedThread(data = alexEncrypted()) {
  return { name: `${data.threadName}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data, null, 2)) };
}

/** Sam's encrypted chat's .json on its own. */
export const samEncryptedThread = () => encryptedThread(samEncrypted());

/** The encrypted chats download, zipped with its media/ folder, all inside `folder` (e.g. 'messages/') or not. */
export function encryptedExport(folder = '') {
  return {
    name: 'messenger-encrypted-chats.zip',
    mimeType: 'application/zip',
    buffer: makeZip([
      { name: `${folder}${ALEX}_6.json`, data: JSON.stringify(alexEncrypted(), null, 2), deflate: true },
      { name: `${folder}${SAM}_2.json`, data: JSON.stringify(samEncrypted(), null, 2), deflate: true },
      { name: folder + ALEX_MEDIA, data: FIXTURES.landscapeJpg() },
    ]),
  };
}

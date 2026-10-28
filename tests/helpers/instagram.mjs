/*
 * Small Instagram "Download your information" exports (JSON format) for tests.
 * Text is written the way Meta writes it: UTF-8 bytes escaped one per character.
 */
import { makeZip } from './zip.mjs';
import { FIXTURES } from './takeout.mjs';

const T0 = Date.parse('2024-08-20T10:00:00Z');
const ROOT = 'your_instagram_activity/messages/';

/** One message, `sec` seconds after 2024-08-20 10:00 UTC. */
export function igMessage(sec, sender, fields = {}) {
  return { sender_name: sender, timestamp_ms: T0 + sec * 1000, is_geoblocked_for_viewer: false, ...fields };
}

/** JSON as Meta writes it: "é" becomes "Ã©". */
export function metaJson(data) {
  return JSON.stringify(data).replace(/[^\x00-\x7f]/gu, (ch) => [...Buffer.from(ch, 'utf8')].map((b) => '\\u00' + b.toString(16).padStart(2, '0')).join(''));
}

const ME = 'Jamie Park';
const ALEX = 'Alex Rivera';
const SAM = 'Sam Patel';

const thread = (path, title, people, messages) => ({ participants: people.map((name) => ({ name })), messages, title, is_still_participant: true, thread_path: path });

const ALEX_PHOTO = `${ROOT}inbox/alexrivera_1111/photos/1801_1.jpg`;
const ALEX_PHOTO_2 = `${ROOT}inbox/alexrivera_1111/photos/1801_2.jpg`;

/** The 1-on-1 with Alex, newest first, split over message_1.json and message_2.json. */
export const alexMessages = () => [
  [ // message_1.json
    igMessage(600, ALEX, { content: 'Liked a message' }),
    igMessage(540, ME, { content: 'Reacted 😂 to your message ' }),
    igMessage(480, ALEX, { content: 'Video chat ended', call_duration: 120 }),
    igMessage(360, ME, { content: `${ME} started a video chat` }),
    igMessage(300, ALEX, { videos: [{ uri: `${ROOT}inbox/alexrivera_1111/videos/1802.mp4` }] }),
    igMessage(240, ALEX, { content: `${ALEX} sent an attachment.`, share: { link: 'https://www.instagram.com/reel/abc/', share_text: 'so true lol' } }),
  ],
  [ // message_2.json
    igMessage(180, ALEX, { photos: [{ uri: ALEX_PHOTO }, { uri: ALEX_PHOTO_2 }] }),
    igMessage(120, ME, { content: 'café later? ☕️', reactions: [{ reaction: '❤️', actor: ALEX }] }),
    igMessage(60, ALEX, { content: 'hey!! 😂 check https://example.com' }),
    igMessage(0, ME, {}), // nothing in it
  ],
];

const groupMessages = () => [
  igMessage(1200, SAM, { content: 'who is driving?' }),
  igMessage(1100, ME, { content: 'me' }),
  igMessage(1000, ALEX, { content: `${ALEX} named the group Road Trip 🚗.` }),
  igMessage(900, ALEX, { content: `You added ${SAM} to the group.` }),
];

const personalInformation = () => ({
  profile_user: [{ string_map_data: { Name: { value: ME }, Username: { value: 'jamiepark' } } }],
});

/** Every message_N.json of the full export, as [path, json]. */
function threadFiles() {
  const [a1, a2] = alexMessages();
  return [
    [`${ROOT}inbox/alexrivera_1111/message_1.json`, metaJson(thread('inbox/alexrivera_1111', ALEX, [ALEX, ME], a1))],
    [`${ROOT}inbox/alexrivera_1111/message_2.json`, metaJson(thread('inbox/alexrivera_1111', ALEX, [ALEX, ME], a2))],
    [`${ROOT}inbox/roadtrip_2222/message_1.json`, metaJson(thread('inbox/roadtrip_2222', 'Road Trip 🚗', [SAM, ALEX, ME], groupMessages()))],
    [`${ROOT}archived_threads/samPatel_3333/message_1.json`, metaJson(thread('archived_threads/samPatel_3333', SAM, [SAM, ME], [igMessage(2000, SAM, { content: 'old news' })]))],
    [`${ROOT}message_requests/spam_4444/message_1.json`, metaJson(thread('message_requests/spam_4444', 'Spam Bot', ['Spam Bot', ME], [igMessage(3000, 'Spam Bot', { content: 'Want followers?' })]))],
  ];
}

/** The export's zip, as Instagram delivers it. */
export function zippedExport() {
  return {
    name: 'instagram-jamiepark-2024-08-21-AbCdEf.zip',
    mimeType: 'application/zip',
    buffer: makeZip([
      { name: 'personal_information/personal_information/personal_information.json', data: metaJson(personalInformation()) },
      ...threadFiles().map(([name, data]) => ({ name, data, deflate: true })),
      { name: ALEX_PHOTO, data: FIXTURES.landscapeJpg() },
      { name: ALEX_PHOTO_2, data: FIXTURES.landscapeJpg() },
    ]),
  };
}

/** The same export split in two parts: conversations in one, photos in the other. */
export function splitExport() {
  return [
    {
      name: 'instagram-jamiepark-2024-08-21-AbCdEf-part1.zip',
      mimeType: 'application/zip',
      buffer: makeZip(threadFiles().map(([name, data]) => ({ name, data }))),
    },
    {
      name: 'instagram-jamiepark-2024-08-21-AbCdEf-part2.zip',
      mimeType: 'application/zip',
      buffer: makeZip([
        { name: ALEX_PHOTO, data: FIXTURES.landscapeJpg() },
        { name: 'personal_information/personal_information/personal_information.json', data: metaJson(personalInformation()) },
      ]),
    },
  ];
}

/** One conversation's message_1.json picked on its own. */
export function looseThread() {
  const [, a2] = alexMessages();
  return { name: 'message_1.json', mimeType: 'application/json', buffer: Buffer.from(metaJson(thread('inbox/alexrivera_1111', ALEX, [ALEX, ME], a2))) };
}

/** Instagram's HTML export, zipped: not readable. */
export function zippedHtmlExport() {
  return {
    name: 'instagram-jamiepark-html.zip',
    mimeType: 'application/zip',
    buffer: makeZip([{ name: `${ROOT}inbox/alexrivera_1111/message_1.html`, data: '<html></html>' }]),
  };
}

/** Upload spec -> File, for running the parser in Node. */
export const asFile = (spec) => new File([spec.buffer], spec.name, { type: spec.mimeType });

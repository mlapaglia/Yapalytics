/*
 * Builds a Google Takeout zip with one Google Chat DM between "Me" and "Alex", where
 * each message carries one attachment. Takeout is the export whose attachments the
 * app can open, so it's what the attachment tests use.
 */
import { readFileSync } from 'node:fs';
import { makeZip } from './zip.mjs';

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

export const FIXTURES = {
  landscapeHeic: () => fixture('landscape.heic'), // 1600×1200, red block top-left
  portraitHeic: () => fixture('portrait.heic'), // 1200×1600, green block top-left
  landscapeJpg: () => fixture('landscape.jpg'), // 1600×1200, red block top-left
};

export const ME = { name: 'Me', email: 'me@example.com', user_type: 'Human' };
export const ALEX = { name: 'Alex', email: 'alex@example.com', user_type: 'Human' };
export const SAM = { name: 'Sam', email: 'sam@example.com', user_type: 'Human' };
export const GIPHY = { name: 'GIPHY', user_type: 'Bot' };

/**
 * A text-only Takeout zip with several conversations.
 * @param {{ dir: string, name?: string, members: object[], from: object[] }[]} chats
 *   `dir` is the Groups/ folder ("DM x", "Space y"); `from` lists each message's sender,
 *   one minute apart starting 2024-08-20 12:00 UTC.
 */
export function takeoutChats(chats) {
  const entries = [{ name: 'Takeout/Google Chat/Users/User 1/user_info.json', data: JSON.stringify({ user: ME }), deflate: true }];
  for (const c of chats) {
    const dir = `Takeout/Google Chat/Groups/${c.dir}`;
    const messages = c.from.map((creator, i) => ({
      creator,
      created_date: `Tuesday, August 20, 2024 at 12:${String(i).padStart(2, '0')}:00 PM UTC`,
      text: `message ${i}`,
    }));
    entries.push(
      { name: `${dir}/group_info.json`, data: JSON.stringify({ ...(c.name ? { name: c.name } : {}), members: c.members }), deflate: true },
      { name: `${dir}/messages.json`, data: JSON.stringify({ messages }), deflate: true },
    );
  }
  return { name: 'takeout-20240820T000000Z-001.zip', mimeType: 'application/zip', buffer: makeZip(entries) };
}

/**
 * @param {{ name: string, data: Buffer, fromMe?: boolean, reactions?: object[] }[]} attachments in time order,
 *   one minute apart starting 2024-08-20 12:00 UTC
 * @returns {{ name: string, mimeType: string, buffer: Buffer }} for setInputFiles
 */
export function takeoutWithAttachments(attachments) {
  const dir = 'Takeout/Google Chat/Groups/DM abc123';
  const messages = attachments.map((a, i) => ({
    creator: a.fromMe ? ME : ALEX,
    created_date: `Tuesday, August 20, 2024 at 12:${String(i).padStart(2, '0')}:00 PM UTC`,
    text: a.name,
    attached_files: [{ original_name: a.name, export_name: a.name }],
    ...(a.reactions ? { reactions: a.reactions } : {}),
  }));
  const buffer = makeZip([
    { name: 'Takeout/Google Chat/Users/User 1/user_info.json', data: JSON.stringify({ user: ME }), deflate: true },
    { name: `${dir}/group_info.json`, data: JSON.stringify({ members: [ME, ALEX] }), deflate: true },
    { name: `${dir}/messages.json`, data: JSON.stringify({ messages }), deflate: true },
    ...attachments.map((a) => ({ name: `${dir}/${a.name}`, data: a.data })),
  ]);
  return { name: 'takeout-20240820T000000Z-001.zip', mimeType: 'application/zip', buffer };
}

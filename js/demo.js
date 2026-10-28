/*
 * Synthetic demo backup. Builds a realistic-looking sms-*.xml and calls-*.xml in the
 * same format SMS Backup & Restore writes (including emoji as surrogate entities and
 * base64 attachment data), plus a Google Takeout Google Chat export, WhatsApp
 * chat exports, an imessage-exporter export, a Telegram export and an Instagram export,
 * so the demo goes through the real parsers.
 */
function buildDemoFiles() {
  let seed = 20240611;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const weighted = (weights) => {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  };

  const contacts = [
    { name: 'Alex Rivera', number: '+15551230001', weight: 30, talky: 0.55 },
    { name: 'Mom', number: '+15551230002', weight: 18, talky: 0.4 },
    { name: 'Jordan Lee', number: '+15551230003', weight: 12, talky: 0.6 },
    { name: 'Sam Patel', number: '+15551230004', weight: 8, talky: 0.5 },
    { name: 'Taylor Brooks', number: '+15551230005', weight: 6, talky: 0.45 },
    { name: 'Chris Nguyen', number: '+15551230006', weight: 4, talky: 0.5 },
    { name: 'Dad', number: '+15551230007', weight: 4, talky: 0.35 },
    { name: 'Morgan Diaz', number: '+15551230008', weight: 2, talky: 0.5 },
    { name: '(Unknown)', number: '72975', weight: 1.5, talky: 0, service: true },
  ];
  const groups = [
    { name: 'Alex Rivera, Jordan Lee, Sam Patel', numbers: ['+15551230001', '+15551230003', '+15551230004'], weight: 7 },
    { name: 'Mom, Dad', numbers: ['+15551230002', '+15551230007'], weight: 3 },
  ];

  const lines = [
    'hey!', 'what are you up to?', 'on my way', 'lol', 'haha that is amazing', 'sounds good 👍',
    'can you grab milk on the way home?', 'running 10 min late sorry', 'did you see the game last night?',
    'love you ❤️', 'ok', 'k', 'yes!!', 'no way 😂', 'call me when you can', 'just landed ✈️',
    'happy birthday!!! 🎉🎂', 'where are we meeting?', 'here', 'omw', 'thanks so much 🙏',
    'check this out https://example.com/article', 'LETS GOOO', 'I miss you guys 🥺', 'good morning ☀️',
    'night 😴', 'want to get dinner this week?', 'how was the trip?', 'that was hilarious 🤣🤣',
    'sorry, was in a meeting', 'running to the store, need anything?', 'yep', 'nope', 'brb',
    'what time works for you tomorrow?', 'dinner at 7?', 'see you soon 😊', 'congrats!!! 🥳',
    'I just finished that show, the ending was wild', 'can we push to 8?', 'hahaha', 'omg 😱',
    'did you feed the dog?', 'the weather is perfect today 🌞', 'pizza tonight? 🍕', 'WHAT', 'heading out',
    'Liked “dinner at 7?”', 'Loved “see you soon 😊”', 'Laughed at “that was hilarious 🤣🤣”',
    '😂 to “ that was hilarious 🤣🤣', '❤️ to “see you soon 😊”', 'Loved an image',
    'That reminds me, we still need to plan the camping trip for next month. Are you still in?',
    'Okay so long story short the car is fine but I need a ride to pick it up on Thursday after work if that is ok',
    'ugh this traffic is the worst', 'damn I forgot my keys again', 'that meeting was so bad', 'wtf is going on with the wifi',
    'I hate mondays', 'this shit is hilarious 😂', 'sorry, rough day 😞', 'my phone died, so annoying', 'not great tbh',
  ];
  const serviceLines = ['Your verification code is 482913', 'Your package has been delivered.', 'Reminder: appointment tomorrow at 9:00 AM. Reply C to confirm.'];

  // Hour-of-day and day-of-week activity weights
  const hourW = [3, 1.5, 0.6, 0.3, 0.2, 0.3, 1, 3, 5, 6, 6, 7, 9, 8, 7, 7, 8, 9, 11, 12, 13, 12, 9, 6];
  const dowW = [1.25, 0.9, 0.95, 1, 1.05, 1.3, 1.4];

  const esc = (s) => {
    let out = '';
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (ch === '&') out += '&amp;';
      else if (ch === '<') out += '&lt;';
      else if (ch === '>') out += '&gt;';
      else if (ch === '"') out += '&quot;';
      else if (cp > 0xffff) {
        // like the real app: one entity per UTF-16 code unit
        out += '&#' + ch.charCodeAt(0) + ';&#' + ch.charCodeAt(1) + ';';
      } else if (cp > 127) out += '&#' + cp + ';';
      else out += ch;
    }
    return out;
  };
  // A few base64 images reused across the demo MMS (kept small so the XML stays modest).
  const toBase64 = (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const photoPool = Array.from({ length: 8 }, () => toBase64(demoPng(rand, 64, 48)));
  const gifPool = Array.from({ length: 3 }, () => toBase64(demoGif(rand, 64, 48, 3)));
  const fakeData = (n) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let s = '';
    for (let i = 0; i < n; i++) s += chars[Math.floor(rand() * 64)];
    return s;
  };
  const readable = (t) => new Date(t).toLocaleString('en-US');

  const out = [];
  const callsOut = [];
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const startT = end.getTime() - Math.round(2.5 * 365) * 86400000; // whole days, so each "day" starts at midnight
  const DAY = 86400000;

  function smsXml(c, t, sent, body) {
    return `<sms protocol="0" address="${c.number}" date="${t}" type="${sent ? 2 : 1}" subject="null" body="${esc(body)}" toa="null" sc_toa="null" service_center="null" read="1" status="-1" locked="0" date_sent="${t}" sub_id="1" readable_date="${readable(t)}" contact_name="${esc(c.name)}" />`;
  }

  function mmsXml(addressList, name, t, sent, body, media, fromNumber) {
    const parts = ['<part seq="-1" ct="application/smil" name="null" chset="null" cd="null" fn="null" cid="&lt;smil&gt;" cl="smil.xml" ctt_s="null" ctt_t="null" text="&lt;smil&gt;&lt;head&gt;&lt;/head&gt;&lt;body&gt;&lt;/body&gt;&lt;/smil&gt;" />'];
    if (media) {
      const ct = { photo: 'image/png', gif: 'image/gif', video: 'video/mp4', audio: 'audio/amr', vcard: 'text/x-vCard' }[media];
      const size = { video: 12000, audio: 1500, vcard: 200 }[media];
      const cl = { photo: `IMG_${2000 + Math.floor(rand() * 8000)}.png`, gif: 'giphy.gif', video: 'VID_clip.mp4', audio: 'voice.amr', vcard: 'contact.vcf' }[media];
      // Real (tiny) images for photos and GIFs; video, audio and vCards are junk bytes.
      const data = media === 'photo' ? pick(photoPool) : media === 'gif' ? pick(gifPool) : fakeData(size + Math.floor(rand() * size));
      parts.push(`<part seq="0" ct="${ct}" name="null" chset="null" cd="null" fn="null" cid="&lt;0&gt;" cl="${cl}" ctt_s="null" ctt_t="null" text="null" data="${data}" />`);
    }
    if (body) parts.push(`<part seq="0" ct="text/plain" name="null" chset="106" cd="null" fn="null" cid="&lt;text&gt;" cl="text.txt" ctt_s="null" ctt_t="null" text="${esc(body)}" />`);
    const addrs = sent
      ? [`<addr address="+15559990000" type="137" charset="106" />`, ...addressList.map((a) => `<addr address="${a}" type="151" charset="106" />`)]
      : [`<addr address="${fromNumber}" type="137" charset="106" />`, ...addressList.filter((a) => a !== fromNumber).map((a) => `<addr address="${a}" type="151" charset="106" />`), `<addr address="+15559990000" type="151" charset="106" />`];
    return `<mms date="${t}" ct_t="application/vnd.wap.multipart.related" msg_box="${sent ? 2 : 1}" address="${addressList.join('~')}" m_type="${sent ? 128 : 132}" read="1" text_only="${media ? 0 : 1}" sub_id="1" readable_date="${readable(t)}" contact_name="${esc(name)}"><parts>${parts.join('')}</parts><addrs>${addrs.join('')}</addrs></mms>`;
  }

  const allTargets = [...contacts.map((c) => ({ c })), ...groups.map((g) => ({ g }))];
  const targetW = allTargets.map((x) => (x.c || x.g).weight);

  for (let day = startT; day < end.getTime(); day += DAY) {
    const dt = new Date(day);
    const dow = dt.getDay();
    // A slow growth trend plus seasonal wobble
    const progress = (day - startT) / (end.getTime() - startT);
    const intensity = (0.6 + 0.8 * progress) * (1 + 0.25 * Math.sin(progress * Math.PI * 5)) * dowW[dow];
    const convos = Math.floor(rand() * 4 * intensity + rand() * 2);

    for (let n = 0; n < convos; n++) {
      const target = allTargets[weighted(targetW)];
      const hour = weighted(hourW);
      let t = day + hour * 3600000 + Math.floor(rand() * 3600000);

      if (target.c && target.c.service) {
        out.push(smsXml(target.c, t, false, pick(serviceLines)));
        continue;
      }

      const len = 2 + Math.floor(rand() * rand() * 30);
      let sent = rand() < 0.5;
      for (let i = 0; i < len; i++) {
        const body = pick(lines);
        const mediaRoll = rand();
        const media = mediaRoll < 0.04 ? 'photo' : mediaRoll < 0.05 ? 'gif' : mediaRoll < 0.058 ? 'video' : mediaRoll < 0.061 ? 'audio' : mediaRoll < 0.062 ? 'vcard' : null;
        if (target.g) {
          const from = pick(target.g.numbers);
          out.push(mmsXml(target.g.numbers, target.g.name, t, sent, media && rand() < 0.5 ? '' : body, media, from));
        } else if (media) {
          out.push(mmsXml([target.c.number], target.c.name, t, sent, rand() < 0.5 ? '' : body, media, target.c.number));
        } else {
          out.push(smsXml(target.c, t, sent, body));
        }
        // Next message: same sender (double text) or a reply
        const talky = target.c ? target.c.talky : 0.55;
        sent = rand() < 0.3 ? sent : rand() < talky ? !sent : sent;
        const gapMin = rand() < 0.75 ? rand() * 4 : rand() < 0.8 ? 4 + rand() * 40 : 40 + rand() * 300;
        t += Math.floor(gapMin * 60000) + 1000;
      }
    }

    // Calls
    if (rand() < 0.35 * dowW[dow]) {
      const c = contacts[weighted(contacts.map((x) => (x.service ? 0 : x.weight)))];
      const t = day + weighted(hourW) * 3600000 + Math.floor(rand() * 3600000);
      const type = weighted([40, 45, 12, 3, 2, 0.5]) + 1;
      const duration = type <= 2 ? Math.floor(20 + rand() * rand() * 3600) : 0;
      callsOut.push(`<call number="${c.number}" duration="${duration}" date="${t}" type="${type}" presentation="1" subscription_id="1" readable_date="${readable(t)}" contact_name="${esc(c.name)}" />`);
    }
  }

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const sms = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<!--File Created By SMS Backup & Restore v10.20.002 -->\n<smses count="${out.length}" backup_set="demo" backup_date="${Date.now()}" type="full">\n  ${out.join('\n  ')}\n</smses>\n`;
  const calls = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<calls count="${callsOut.length}" backup_set="demo" backup_date="${Date.now()}" type="full">\n  ${callsOut.join('\n  ')}\n</calls>\n`;
  return [
    new File([sms], `sms-${stamp}.xml`, { type: 'text/xml' }),
    new File([calls], `calls-${stamp}.xml`, { type: 'text/xml' }),
    ...buildDemoChatZips(rand, pick, lines, startT, end.getTime(), stamp),
    ...buildDemoWhatsApp(rand, pick, lines, end.getTime()),
    ...buildDemoIMessage(rand, pick, lines, end.getTime()),
    buildDemoTelegram(rand, pick, lines, end.getTime()),
    buildDemoInstagram(rand, pick, lines, end.getTime()),
  ];
}

/*
 * Synthetic Instagram "Download your information" export (JSON format), zipped as Instagram
 * delivers it: personal_information.json, a 1-on-1 split over message_1.json and
 * message_2.json (newest first, like the real thing), a group, an archived chat and a
 * message request (skipped by the parser). Includes the format's quirks: text written as
 * UTF-8 bytes escaped one per character, shared reels with an "… sent an attachment."
 * placeholder, "Liked a message", call and group notices, reactions as a field, and photos.
 */
function buildDemoInstagram(rand, pick, lines, endT) {
  const DAY = 86400000;
  const me = 'Jamie Park';
  const noor = 'Noor Haddad';
  const leo = 'Leo Martins';
  const priya = 'Priya Shah';
  const textLines = lines.filter((l) => !/^(?:Liked|Loved|Laughed|\S+ to “)/.test(l));
  const root = 'your_instagram_activity/messages/';
  const files = [];
  let photoN = 1;

  /** One message with the format's variety: text, photos, shared reels, likes, reactions. */
  const message = (t, who, dir) => {
    const m = { sender_name: who, timestamp_ms: t };
    const r = rand();
    if (r < 0.06) {
      const uri = `${root}${dir}/photos/${18000000000000000 + photoN++}.jpg`;
      files.push([uri, demoPng(rand)]);
      m.photos = [{ uri, creation_timestamp: Math.floor(t / 1000) }];
    } else if (r < 0.14) {
      m.content = `${who} sent an attachment.`;
      m.share = { link: 'https://www.instagram.com/reel/' + Math.floor(rand() * 1e9).toString(36) + '/', share_text: 'POV: you finally found the perfect taco 🌮', original_content_owner: 'tacotuesday' };
    } else if (r < 0.17) {
      m.content = pick(['Liked a message', 'Reacted 😂 to your message ', 'Reacted ❤️ to your message ']);
    } else {
      m.content = pick(textLines);
    }
    if (rand() < 0.06) m.reactions = [{ reaction: pick(['❤️', '😂', '😮']), actor: who === me ? noor : me, timestamp: Math.floor(t / 1000) + 30 }];
    m.is_geoblocked_for_viewer = false;
    m.is_unsent_image_by_messenger_kid_parent = false;
    return m;
  };

  /** Days of conversation between `people` (the first is the one who usually starts), newest first. */
  const conversation = (people, dir, perDay, from) => {
    const msgs = [];
    for (let day = from; day < endT; day += DAY) {
      if (rand() > perDay) continue;
      let t = day + (10 + Math.floor(rand() * 13)) * 3600e3 + Math.floor(rand() * 3600e3);
      let who = pick(people);
      for (let i = 0, n = 1 + Math.floor(rand() * rand() * 12); i < n && t < endT; i++) {
        msgs.push(message(t, who, dir));
        who = rand() < 0.35 ? who : pick(people.filter((p) => p !== who));
        t += Math.floor((rand() < 0.8 ? rand() * 6 : 6 + rand() * 120) * 60000) + 1000 + Math.floor(rand() * 1000);
      }
    }
    return msgs.reverse();
  };

  const thread = (dir, title, people, messages) => ({
    participants: people.map((name) => ({ name })),
    messages,
    title,
    is_still_participant: true,
    thread_path: dir,
    magic_words: [],
  });
  /** Meta's encoding: every non-ASCII character as its UTF-8 bytes, each written as \u00XX. */
  const enc = new TextEncoder();
  const metaJson = (data) => JSON.stringify(data, null, 2).replace(/[^\x00-\x7f]/gu, (ch) => [...enc.encode(ch)].map((b) => '\\u00' + b.toString(16).padStart(2, '0')).join(''));

  const start = endT - 280 * DAY;
  const noorDir = 'inbox/noorhaddad_17846200000000001';
  const noorMsgs = conversation([noor, me], noorDir, 0.6, start);
  const callT = noorMsgs[5].timestamp_ms + 60000;
  noorMsgs.splice(5, 0,
    { sender_name: me, timestamp_ms: callT + 900000, content: 'Video chat ended', call_duration: 840, is_geoblocked_for_viewer: false },
    { sender_name: me, timestamp_ms: callT, content: `${me} started a video chat`, is_geoblocked_for_viewer: false });
  const half = Math.floor(noorMsgs.length / 2);

  const groupDir = 'inbox/concertsquad_6512345678901234';
  const groupStart = start + 40 * DAY;
  const groupMsgs = conversation([leo, me, noor, priya], groupDir, 0.4, groupStart);
  groupMsgs.push(
    { sender_name: leo, timestamp_ms: groupStart + 3600e3, content: `${leo} named the group Concert Squad 🎸.`, is_geoblocked_for_viewer: false },
    { sender_name: leo, timestamp_ms: groupStart + 3000e3, content: `${leo} added ${priya} to the group.`, is_geoblocked_for_viewer: false });

  const leoDir = 'archived_threads/leomartins_17846200000000002';
  const requestDir = 'message_requests/freefollowers4u_17846200000000003';
  const stamp = new Date(endT).toISOString().slice(0, 10);
  return new File(
    [buildStoredZip([
      ['personal_information/personal_information/personal_information.json', metaJson({
        profile_user: [{ title: '', media_map_data: {}, string_map_data: {
          Email: { href: '', value: 'jamie@example.com', timestamp: 0 },
          Username: { href: '', value: 'jamiepark', timestamp: 0 },
          Name: { href: '', value: me, timestamp: 0 },
        } }],
      })],
      [`${root}${noorDir}/message_1.json`, metaJson(thread(noorDir, noor, [noor, me], noorMsgs.slice(0, half)))],
      [`${root}${noorDir}/message_2.json`, metaJson(thread(noorDir, noor, [noor, me], noorMsgs.slice(half)))],
      [`${root}${groupDir}/message_1.json`, metaJson(thread(groupDir, 'Concert Squad 🎸', [leo, me, noor, priya], groupMsgs))],
      [`${root}${leoDir}/message_1.json`, metaJson(thread(leoDir, leo, [leo, me], conversation([leo, me], leoDir, 0.3, start).slice(-30)))],
      [`${root}${requestDir}/message_1.json`, metaJson(thread(requestDir, 'Free Followers 4U', ['Free Followers 4U', me], [{ sender_name: 'Free Followers 4U', timestamp_ms: endT - 3 * DAY, content: 'Want 10k followers? DM us 🚀' }]))],
      ...files,
    ])],
    `instagram-jamiepark-${stamp}-dEmO01.zip`,
    { type: 'application/zip' },
  );
}

/*
 * Synthetic Telegram Desktop full export (Machine-readable JSON), zipped the way people
 * zip the DataExport folder: result.json with personal_information, a 1-on-1 chat, a
 * supergroup, a channel and Saved Messages (both skipped by the parser), a bot chat and
 * a group you left. Includes the format's quirks: text as an array of entities, service
 * messages, reactions as a field, media left out of the export, and real photo files.
 */
function buildDemoTelegram(rand, pick, lines, endT) {
  const DAY = 86400000;
  const me = { name: 'Jamie Park', id: 'user7700001' };
  const mila = { name: 'Mila Novak', id: 'user7700002' };
  const kai = { name: 'Kai Tanaka', id: 'user7700003' };
  const rosa = { name: 'Rosa Alvarez', id: 'user7700004' };
  const textLines = lines.filter((l) => !/^(?:Liked|Loved|Laughed|\S+ to “)/.test(l));
  const files = [];
  let id = 1;
  let photoN = 1;
  const pad = (n) => String(n).padStart(2, '0');
  const local = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const base = (t, who) => ({ id: id++, type: 'message', date: local(t), date_unixtime: String(Math.floor(t / 1000)), from: who.name, from_id: who.id });

  /** One message with the format's variety: plain or entity text, photos, stickers, voice, reactions. */
  const message = (t, who, chatDir) => {
    const m = base(t, who);
    const r = rand();
    if (r < 0.06) {
      const d = new Date(t);
      const path = `${chatDir}/photos/photo_${photoN++}@${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.jpg`;
      files.push([path, demoPng(rand)]);
      Object.assign(m, { photo: path, width: 160, height: 120, text: rand() < 0.3 ? pick(textLines) : '' });
    } else if (r < 0.1) {
      Object.assign(m, { file: '(File not included. Change data exporting settings to download.)', media_type: 'sticker', sticker_emoji: pick(['😂', '👍', '❤️', '🔥']), width: 512, height: 512, text: '' });
    } else if (r < 0.13) {
      Object.assign(m, { file: '(File not included. Change data exporting settings to download.)', media_type: 'voice_message', mime_type: 'audio/ogg', duration_seconds: 2 + Math.floor(rand() * 40), text: '' });
    } else if (r < 0.18) {
      Object.assign(m, { text: ['look at this ', { type: 'link', text: 'https://example.com/' + Math.floor(rand() * 1000) }, ' 😂'] });
    } else {
      m.text = pick(textLines);
    }
    m.text_entities = typeof m.text === 'string' ? (m.text ? [{ type: 'plain', text: m.text }] : []) : m.text;
    if (rand() < 0.07) m.reactions = [{ type: 'emoji', count: 1, emoji: pick(['👍', '😂', '❤']) }];
    return m;
  };

  /** Days of conversation between `people` (the first is the one who usually starts). */
  const conversation = (people, chatDir, perDay, from) => {
    const msgs = [];
    for (let day = from; day < endT; day += DAY) {
      if (rand() > perDay) continue;
      let t = day + (9 + Math.floor(rand() * 13)) * 3600e3 + Math.floor(rand() * 3600e3);
      let who = pick(people);
      for (let i = 0, n = 1 + Math.floor(rand() * rand() * 12); i < n && t < endT; i++) {
        msgs.push(message(t, who, chatDir));
        if (rand() < 0.04) msgs.push(message(t, who, chatDir)); // two in the same second
        who = rand() < 0.35 ? who : pick(people.filter((p) => p !== who));
        t += Math.floor((rand() < 0.8 ? rand() * 6 : 6 + rand() * 120) * 60000) + 1000;
      }
    }
    return msgs;
  };

  const start = endT - 300 * DAY;
  const milaMsgs = conversation([mila, me], 'chats/chat_01', 0.55, start);
  milaMsgs.splice(3, 0, { id: id++, type: 'service', date: milaMsgs[2].date, date_unixtime: milaMsgs[2].date_unixtime, actor: mila.name, actor_id: mila.id, action: 'pin_message', message_id: 2, text: '', text_entities: [] });
  const groupMsgs = conversation([kai, me, mila, rosa], 'chats/chat_02', 0.35, start + 30 * DAY);
  groupMsgs.unshift({ id: id++, type: 'service', date: local(start + 30 * DAY), date_unixtime: String(Math.floor((start + 30 * DAY) / 1000)), actor: kai.name, actor_id: kai.id, action: 'create_group', title: 'Board Game Night 🎲', members: [kai.name, me.name, mila.name, rosa.name], text: '', text_entities: [] });

  const result = {
    about: 'Here is the data you requested. Remember: Telegram is ad free, it doesn\'t sell your data, and doesn\'t require any account permissions.',
    personal_information: { user_id: 7700001, first_name: 'Jamie', last_name: 'Park', phone_number: '+1 555 010 0000', username: '@jamiepark', bio: '' },
    chats: {
      about: 'This page lists all chats from this export.',
      list: [
        { name: mila.name, type: 'personal_chat', id: 7700002, messages: milaMsgs },
        { name: 'Board Game Night 🎲', type: 'private_supergroup', id: 1800000001, messages: groupMsgs },
        { name: 'Daily Digest', type: 'public_channel', id: 1900000001, messages: [{ ...base(endT - 5 * DAY, { name: 'Daily Digest', id: 'channel1900000001' }), text: 'Today in tech…', text_entities: [] }] },
        { type: 'saved_messages', id: 7700001, messages: [{ ...base(endT - 9 * DAY, me), text: 'wifi password: hunter2', text_entities: [] }] },
        { name: 'BotFather', type: 'bot_chat', id: 93372553, messages: [{ ...base(endT - 200 * DAY, me), text: '/start', text_entities: [{ type: 'bot_command', text: '/start' }] }, { ...base(endT - 200 * DAY + 1000, { name: 'BotFather', id: 'user93372553' }), text: 'I can help you create and manage Telegram bots.', text_entities: [] }] },
      ],
    },
    left_chats: {
      about: 'This page lists all supergroups and channels from this export that you have left.',
      list: [{ name: 'Apartment Hunt', type: 'private_group', id: 1700000001, messages: conversation([rosa, me], 'chats/chat_03', 0.4, start).slice(0, 40) }],
    },
  };
  const dir = 'DataExport_' + local(endT).slice(0, 10) + '/';
  return new File(
    [buildStoredZip([[dir + 'result.json', JSON.stringify(result, null, 1)], ...files.map(([p, bytes]) => [dir + p, bytes])])],
    'Telegram Desktop.zip',
    { type: 'application/zip' },
  );
}

/*
 * Synthetic imessage-exporter txt export (one file per conversation): a 1-on-1 and a
 * named group ("<name> - <chat id>.txt"), with read receipts, tapbacks, threaded
 * replies (indented under the original and repeated at the top level), edits,
 * expressive effects, attachment paths and group announcements, plus orphaned.txt.
 */
function buildDemoIMessage(rand, pick, lines, endT) {
  const DAY = 86400000;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  // chrono "%b %d, %Y %l:%M:%S %p"
  const stamp = (t) => {
    const d = new Date(t);
    const h = d.getHours() % 12 || 12;
    return `${MON[d.getMonth()]} ${pad(d.getDate())}, ${d.getFullYear()} ${String(h).padStart(2, ' ')}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  };
  let guid = 1;
  const attachment = (t, kind) => {
    const ext = { photo: 'HEIC', video: 'MOV', audio: 'caf' }[kind];
    return `~/Library/Messages/Attachments/${pad(guid % 100)}/${pad(guid++ % 16)}/at_0_${(guid * 2654435761 >>> 0).toString(16).toUpperCase()}/IMG_${4000 + guid}.${ext}`;
  };

  function conversation(people, perDay, startT) {
    const out = [];
    for (let day = startT; day < endT; day += DAY) {
      if (rand() > perDay) continue;
      let t = day + (8 + Math.floor(rand() * 15)) * 3600e3 + Math.floor(rand() * 3600e3);
      let sender = rand() < 0.5 ? 'Me' : pick(people);
      for (let i = 0, n = 1 + Math.floor(rand() * rand() * 12); i < n; i++) {
        const read = sender === 'Me' && rand() < 0.3 ? ` (Read by them after ${1 + Math.floor(rand() * 50)} minutes, ${Math.floor(rand() * 60)} seconds)` : '';
        const body = [];
        const roll = rand();
        if (roll < 0.05) body.push(attachment(t, 'photo'));
        else if (roll < 0.06) body.push(attachment(t, 'video'));
        else if (roll < 0.065) body.push(attachment(t, 'audio'), 'Transcription: on my way, see you soon');
        else if (roll < 0.07) body.push('Attachment missing!');
        else if (roll < 0.08) body.push(`${stamp(t).slice(-11).trim()} ${pick(lines)}`, `Edited 12 seconds later: ${pick(lines)}`);
        else body.push(...pick(lines).split('\n'));
        if (rand() < 0.02) body.push('Sent with Confetti');
        if (rand() < 0.12) body.push('Tapbacks:', `    ${pick(['Loved', 'Liked', 'Laughed at', 'Emphasized'])} by ${sender === 'Me' ? pick(people) : 'Me'}`);
        out.push({ t, lines: [stamp(t) + read, sender, ...body] });
        if (rand() < 0.4) sender = sender === 'Me' ? pick(people) : 'Me';
        t += Math.floor((rand() < 0.8 ? rand() * 4 : 4 + rand() * 120) * 60000) + 1000;
      }
    }
    // Thread replies: rendered indented under the original and again at the top level.
    for (let i = 0; i + 3 < out.length; i += 37) {
      const reply = out[i + 3];
      reply.lines.push('This message responded to an earlier message.');
      out[i].lines.push(...reply.lines.filter((l) => l !== 'This message responded to an earlier message.').map((l) => '    ' + l));
    }
    return out.map((m) => m.lines.join('\n') + '\n\n').join('');
  }

  const start = endT - 220 * DAY;
  const riley = conversation(['Riley Chen'], 0.6, start);
  const family = `${stamp(start)} Me named the conversation Family 🏡\n\n${stamp(start + 60e3)} Me added Mom to the conversation.\n\n` +
    conversation(['Mom', 'Dad', '+15551230009'], 0.35, start + DAY);
  return [
    new File([riley], 'Riley Chen.txt', { type: 'text/plain' }),
    new File([family], 'Family 🏡 - 7.txt', { type: 'text/plain' }),
    new File([`${stamp(start)}\nMe\nmessage with no conversation\n\n`], 'orphaned.txt', { type: 'text/plain' }),
  ];
}

/*
 * Synthetic WhatsApp exports in both phone formats: an Android 1-on-1 .txt
 * (M/D/YY, 12-hour clock with U+202F, " - " separator, "<Media omitted>") and an
 * iOS group .zip (_chat.txt with [DD/MM/YYYY, HH:MM:SS], U+200E-marked system lines
 * and "<attached: …>" media stored next to it).
 */
function buildDemoWhatsApp(rand, pick, lines, endT) {
  const me = 'Jamie Park';
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const androidStamp = (t) => {
    const d = new Date(t);
    const h = d.getHours();
    return `${d.getMonth() + 1}/${d.getDate()}/${pad(d.getFullYear() % 100)}, ${h % 12 || 12}:${pad(d.getMinutes())}\u202f${h < 12 ? 'AM' : 'PM'}`;
  };
  const iosStamp = (t) => {
    const d = new Date(t);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const extra = ['running late, save me a seat', 'did you finish the book??', 'chapter 12 was wild\nno spoilers but WOW', 'can someone send the address', 'voice note incoming', 'lol same'];

  // Android 1-on-1 with Nadia
  const a = [`${androidStamp(endT - 400 * DAY)} - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.`];
  for (let day = endT - 400 * DAY; day < endT; day += DAY) {
    if (rand() > 0.55) continue;
    let t = day + (9 + Math.floor(rand() * 13)) * 3600e3 + Math.floor(rand() * 3600e3);
    let sender = rand() < 0.5 ? me : 'Nadia Haddad';
    for (let i = 0, n = 1 + Math.floor(rand() * rand() * 10); i < n; i++) {
      const roll = rand();
      const body = roll < 0.05 ? '<Media omitted>' : roll < 0.06 ? 'This message was deleted' : roll < 0.08 ? pick(lines) + ' <This message was edited>' : pick(rand() < 0.2 ? extra : lines);
      a.push(`${androidStamp(t)} - ${sender}: ${body}`);
      if (rand() < 0.4) sender = sender === me ? 'Nadia Haddad' : me;
      t += Math.floor((rand() < 0.8 ? rand() * 3 : 3 + rand() * 120) * 60000);
    }
  }

  // iOS group chat, exported "with media"
  const group = 'Book Club 📚';
  const members = [me, 'Nadia Haddad', 'Omar Farouk', '~ Lena'];
  const start = endT - 300 * DAY;
  const g = [
    `\u200e[${iosStamp(start)}] ${group}: \u200eMessages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.`,
    `\u200e[${iosStamp(start + 1000)}] ${group}: \u200eOmar Farouk created group “${group}”`,
    `\u200e[${iosStamp(start + 2000)}] ${group}: \u200eOmar Farouk added you`,
  ];
  const media = [];
  let photo = 1;
  for (let day = start + DAY; day < endT; day += DAY) {
    if (rand() > 0.3) continue;
    let t = day + (17 + Math.floor(rand() * 6)) * 3600e3 + Math.floor(rand() * 3600e3);
    for (let i = 0, n = 2 + Math.floor(rand() * rand() * 15); i < n; i++) {
      const sender = pick(members);
      if (rand() < 0.06) {
        const d = new Date(t);
        const name = `${String(photo++).padStart(8, '0')}-PHOTO-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.jpg`;
        const bytes = new Uint8Array(2000 + Math.floor(rand() * 6000));
        media.push([name, bytes]);
        g.push(`[${iosStamp(t)}] ${sender}: \u200e<attached: ${name}>`);
      } else if (rand() < 0.02) {
        g.push(`\u200e[${iosStamp(t)}] ${sender}: \u200eMissed voice call`);
      } else {
        g.push(`[${iosStamp(t)}] ${sender}: ${pick(rand() < 0.3 ? extra : lines)}`);
      }
      t += Math.floor((rand() < 0.75 ? rand() * 4 : 4 + rand() * 60) * 60000) + 1000;
    }
  }

  return [
    new File([a.join('\n') + '\n'], 'WhatsApp Chat with Nadia Haddad.txt', { type: 'text/plain' }),
    new File([buildStoredZip([['_chat.txt', g.join('\r\n') + '\r\n'], ...media])], `WhatsApp Chat - ${group}.zip`, { type: 'application/zip' }),
  ];
}

/*
 * Synthetic Google Takeout export of Google Chat, split over two zips the way a large
 * export is (the second part holds attachments and one group_info.json), with the
 * real quirks: U+202F before AM/PM, repeated attachment names stored as "name(1).ext",
 * a deleted message stub and an unsentmessages.json to ignore.
 */
function buildDemoChatZips(rand, pick, lines, startT, endT, stamp) {
  const me = { name: 'You', email: 'you@example.com', user_type: 'Human' };
  const people = {
    priya: { name: 'Priya Shah', email: 'priya.shah@example.com', user_type: 'Human' },
    ben: { name: 'Ben Okafor', email: 'ben.okafor@example.com', user_type: 'Human' },
    lena: { name: 'Lena Fischer', email: 'lena.f@example.com', user_type: 'Human' },
  };
  const convos = [
    { dir: 'DM 8uTneoAAAAE', members: [me, people.priya], perDay: 0.9 },
    { dir: 'DM 2kQpzlAAAAE', members: [me, people.ben], perDay: 0.35 },
    { dir: 'DM 7rWvcbAAAAE', members: [me, people.priya, people.lena], perDay: 0.15 },
    { dir: 'Space AAAA1SQJ1zo', name: 'Weekend Hikers', members: [me, people.priya, people.ben, people.lena], perDay: 0.45 },
  ];
  const chatLines = [...lines.filter((l) => !/^(?:Liked|Loved|Laughed|\S+ to “)/.test(l)), 'pushed the fix, can you take a look?', 'trail map attached', 'who is driving saturday?', 'in a meeting, will reply after'];

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const chatDate = (t) => {
    const d = new Date(t);
    const h = d.getUTCHours();
    const pad = (n) => String(n).padStart(2, '0');
    return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${h % 12 || 12}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}\u202f${h < 12 ? 'AM' : 'PM'} UTC`;
  };
  const randomBytes = (n) => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (rand() * 256) | 0;
    return b;
  };

  const root = 'Takeout/Google Chat/';
  const part1 = [];
  const part2 = [];
  const json = (o) => JSON.stringify(o, null, 2);
  part1.push([root + 'Users/User 111790196300230307452/user_info.json', json({
    user: me,
    membership_info: convos.map((c) => ({ group_id: c.dir, ...(c.name ? { group_name: c.name } : {}), membership_state: 'MEMBER_JOINED' })),
  })]);
  part1.push([root + 'Users/User 111790196300230307452/unsentmessages.json', json({ messages: [{ creator: me, created_date: chatDate(endT - 3600e3), text: 'draft I never sent' }] })]);

  const DAY = 86400000;
  const chatStart = Math.max(startT, endT - 540 * DAY);
  for (const c of convos) {
    const groupId = c.dir.slice(c.dir.indexOf(' ') + 1);
    const messages = [];
    const used = new Map();
    for (let day = chatStart; day < endT; day += DAY) {
      if (rand() > c.perDay) continue;
      // Chat clusters in daytime hours.
      let t = day + Math.min(23, 8 + Math.floor(rand() * rand() * 14)) * 3600e3 + Math.floor(rand() * 3600e3);
      const topic = rand().toString(36).slice(2, 13);
      const n = 1 + Math.floor(rand() * rand() * 12);
      let sender = rand() < 0.5 ? me : pick(c.members.slice(1));
      for (let i = 0; i < n; i++) {
        const msg = { creator: sender, created_date: chatDate(t) };
        if (rand() < 0.9) msg.text = pick(chatLines);
        if (!msg.text || rand() < 0.05) {
          const name = rand() < 0.6 ? 'image.png' : pick(['trail.jpg', 'clip.mp4', 'notes.pdf', 'party.gif']);
          const export_name = 'File-' + name;
          const nth = used.get(export_name) || 0;
          used.set(export_name, nth + 1);
          const dot = export_name.lastIndexOf('.');
          const disk = nth ? `${export_name.slice(0, dot)}(${nth})${export_name.slice(dot)}` : export_name;
          // Real images for photos and GIFs; the video and PDF are junk bytes, so the page falls back to a download link.
          const bytes = /\.(png|jpg)$/.test(name) ? demoPng(rand) : /\.gif$/.test(name) ? demoGif(rand) : randomBytes(800 + Math.floor(rand() * 4000));
          part2.push([`${root}Groups/${c.dir}/${disk}`, bytes]);
          msg.attached_files = [{ original_name: name, export_name }];
        }
        msg.topic_id = topic;
        msg.message_id = `${groupId}/${topic}/${rand().toString(36).slice(2, 13)}`;
        if (rand() < 0.08) msg.reactions = [{ emoji: { unicode: '👍' }, reactor_emails: [pick(c.members).email] }];
        messages.push(msg);
        if (rand() < 0.01) messages.push({ message_state: 'DELETED', deleted_date: chatDate(t + 1000), topic_id: topic, deletion_metadata: { deletion_type: 'CREATOR' }, message_id: `${groupId}/${topic}/deleted${i}` });
        sender = rand() < 0.35 ? sender : sender === me ? pick(c.members.slice(1)) : me;
        t += Math.floor((rand() < 0.8 ? rand() * 5 : 5 + rand() * 90) * 60000) + 1000;
      }
    }
    const info = json({ ...(c.name ? { name: c.name } : {}), members: c.members });
    (c.name ? part2 : part1).push([`${root}Groups/${c.dir}/group_info.json`, info]);
    part1.push([`${root}Groups/${c.dir}/messages.json`, json({ messages })]);
  }

  const name = (n) => `takeout-${stamp.slice(0, 8)}T${stamp.slice(8)}Z-1-00${n}.zip`;
  return [
    new File([buildStoredZip(part1)], name(1), { type: 'application/zip' }),
    new File([buildStoredZip(part2)], name(2), { type: 'application/zip' }),
  ];
}

const DEMO_CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(b, c = 0xffffffff) {
  for (let i = 0; i < b.length; i++) c = DEMO_CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A small landscape-ish PNG (sky gradient, sun, hills), uncompressed, for demo photo attachments. */
function demoPng(rand, w = 160, h = 120) {
  const hue = rand() * 360;
  const rgb = (hh, sat, light) => {
    const k = (n) => (n + hh / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    return [0, 8, 4].map((n) => Math.round(255 * (light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))));
  };
  const sunX = w * (0.2 + rand() * 0.6), sunY = h * (0.2 + rand() * 0.25), sunR = h * 0.12;
  const hills = [rand() * 6, rand() * 6, 0.45 + rand() * 0.2];
  const raw = new Uint8Array((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const ground = h * (hills[2] + 0.12 * Math.sin(x / 30 + hills[0]) + 0.06 * Math.sin(x / 13 + hills[1]));
      let c;
      if (y > ground) c = rgb((hue + 140) % 360, 0.45, 0.22 + 0.1 * ((y - ground) / h));
      else if ((x - sunX) ** 2 + (y - sunY) ** 2 < sunR ** 2) c = rgb((hue + 40) % 360, 0.9, 0.75);
      else c = rgb(hue, 0.65, 0.55 + 0.3 * (y / h));
      raw[p++] = c[0]; raw[p++] = c[1]; raw[p++] = c[2];
    }
  }
  // zlib stream of stored (uncompressed) deflate blocks
  const blocks = Math.ceil(raw.length / 65535);
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let q = 0;
  z[q++] = 0x78; z[q++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const len = Math.min(65535, raw.length - i * 65535);
    z[q++] = i === blocks - 1 ? 1 : 0;
    z[q++] = len & 255; z[q++] = len >> 8; z[q++] = ~len & 255; z[q++] = (~len >> 8) & 255;
    z.set(raw.subarray(i * 65535, i * 65535 + len), q);
    q += len;
  }
  let a1 = 1, a2 = 0;
  for (let i = 0; i < raw.length; i++) { a1 = (a1 + raw[i]) % 65521; a2 = (a2 + a1) % 65521; }
  z[q++] = a2 >> 8; z[q++] = a2 & 255; z[q++] = a1 >> 8; z[q++] = a1 & 255;
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

/**
 * A small looping animated GIF (moving confetti stripes) for demo GIF attachments.
 * Uses "uncompressed" LZW: 7-bit pixels sent as 8-bit codes with a clear code every
 * 126 pixels, so the code width never grows.
 */
function demoGif(rand, w = 160, h = 120, frames = 6) {
  const bytes = [];
  const push = (...b) => bytes.push(...b);
  const u16 = (n) => push(n & 255, n >> 8);
  push(...'GIF89a'.split('').map((c) => c.charCodeAt(0)));
  u16(w); u16(h);
  push(0xf6, 0, 0); // global color table, 128 entries
  const base = rand() * 360;
  for (let i = 0; i < 128; i++) {
    const hh = (base + i * 2.8) % 360;
    const k = (n) => (n + hh / 30) % 12;
    const a = 0.8 * Math.min(0.55, 0.45);
    for (const n of [0, 8, 4]) push(Math.round(255 * (0.55 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))));
  }
  push(0x21, 0xff, 11, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0); // loop forever
  for (let f = 0; f < frames; f++) {
    push(0x21, 0xf9, 4, 0, 10, 0, 0, 0); // 100 ms per frame
    push(0x2c); u16(0); u16(0); u16(w); u16(h); push(0);
    push(7); // LZW minimum code size
    const codes = [];
    let run = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (run === 0) codes.push(128); // clear
        codes.push(Math.floor(((x + y + f * 20) % 128) / 16) * 16 + ((x * 7 + y * 3) % 16));
        run = (run + 1) % 126;
      }
    }
    codes.push(129); // end of information
    for (let i = 0; i < codes.length; i += 255) {
      const block = codes.slice(i, i + 255);
      push(block.length, ...block);
    }
    push(0);
  }
  push(0x3b);
  return new Uint8Array(bytes);
}

/** Minimal zip writer (no compression) for the demo export. entries: [[path, string | Uint8Array]]. */
function buildStoredZip(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [path, content] of entries) {
    const name = enc.encode(path);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(local, name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.byteLength, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, eocd]);
}

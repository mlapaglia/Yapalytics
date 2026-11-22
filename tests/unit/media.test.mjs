import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES } from '../helpers/takeout.mjs';
import { loadApp } from '../helpers/load.mjs';
import { makeZip } from '../helpers/zip.mjs';

const { sniffHeic, heicLike, attType, onPicture, zipLib } = loadApp(['sniffHeic', 'heicLike', 'attType', 'onPicture', 'zipLib']);

describe('HEIC detection', () => {
  it('recognizes HEIC by its bytes, whatever the name says', async () => {
    assert.equal(await sniffHeic(new Blob([FIXTURES.landscapeHeic()])), true);
    assert.equal(await sniffHeic(new Blob([FIXTURES.portraitHeic()])), true);
    assert.equal(await sniffHeic(new Blob([FIXTURES.landscapeJpg()])), false);
    assert.equal(await sniffHeic(new Blob(['tiny'])), false);
  });

  it('maps names and types', () => {
    assert.equal(attType({ n: 'IMG_0001.HEIC' }), 'image/heic');
    assert.equal(attType({ n: 'x.heif' }), 'image/heif');
    assert.equal(attType({ n: 'photo', t: 'application/octet-stream', p: 'a/b.jpg' }), 'image/jpeg');
    assert.equal(heicLike('image/heic'), true);
    assert.equal(heicLike('image/jpeg'), false);
  });
});

describe('lightbox hit test (object-fit: contain)', () => {
  // A 1200×1600 portrait photo shown in a 1000×800 element at (100, 50): drawn 600×800, centered.
  const img = { naturalWidth: 1200, naturalHeight: 1600, getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 800 }) };

  it('counts the drawn picture as the picture', () => {
    assert.equal(onPicture(img, 600, 450), true);
    assert.equal(onPicture(img, 301, 60), true);
    assert.equal(onPicture(img, 899, 840), true);
  });

  it('counts the empty bands beside it as off the picture', () => {
    assert.equal(onPicture(img, 150, 450), false);
    assert.equal(onPicture(img, 1050, 450), false);
  });

  it('never closes on an image that has not loaded yet', () => {
    assert.equal(onPicture({ ...img, naturalWidth: 0 }, 150, 450), true);
  });
});

describe('zip reader', () => {
  const photo = FIXTURES.landscapeJpg();
  const zip = new File([makeZip([
    { name: 'Takeout/Google Chat/Groups/DM x/messages.json', data: '{"messages":[]}', deflate: true },
    { name: 'Takeout/Google Chat/Groups/DM x/naïve 😂.txt', data: 'stored text' },
    { name: 'photo.jpg', data: photo },
    { name: 'photo-deflated.jpg', data: photo, deflate: true },
  ])], 'takeout.zip');
  const { listZip, readEntryText, readEntryBlob } = zipLib();

  it('lists entries with UTF-8 names', async () => {
    const names = (await listZip(zip)).map((e) => e.name);
    assert.deepEqual(names, [
      'Takeout/Google Chat/Groups/DM x/messages.json',
      'Takeout/Google Chat/Groups/DM x/naïve 😂.txt',
      'photo.jpg',
      'photo-deflated.jpg',
    ]);
  });

  it('reads stored and deflated entries', async () => {
    const [json, txt, stored, deflated] = await listZip(zip);
    assert.equal(json.method, 8);
    assert.equal(await readEntryText(json), '{"messages":[]}');
    assert.equal(await readEntryText(txt), 'stored text');
    for (const e of [stored, deflated]) {
      const blob = await readEntryBlob(e, 'image/jpeg');
      assert.equal(blob.type, 'image/jpeg');
      assert.ok(Buffer.from(await blob.arrayBuffer()).equals(photo), e.name);
    }
  });
});

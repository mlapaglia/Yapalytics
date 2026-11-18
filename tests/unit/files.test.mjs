import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from '../helpers/load.mjs';

const { planFileChanges, canApplyFiles, sameFile } = loadScripts(['files.js'], ['planFileChanges', 'canApplyFiles', 'sameFile']);

const f = (id, on = true, extra = {}) => ({ id, on, ...extra });
const ids = (entries) => entries.map((e) => e.id);

describe('spec 006 managing loaded files', () => {
  it('AC14: no difference means nothing to do', () => {
    const current = [f(1), f(2, false)];
    const plan = planFileChanges(current, current.map((e) => ({ ...e })));
    assert.deepEqual({ ...plan, read: ids(plan.read) }, { changed: false, rebuild: false, read: [] });
    assert.equal(canApplyFiles(current, current.map((e) => ({ ...e }))), false);
  });

  it('AC14: additions only read just the new files', () => {
    const plan = planFileChanges([f(1)], [f(1), f(2), f(3, false)]);
    assert.equal(plan.changed, true);
    assert.equal(plan.rebuild, false);
    assert.deepEqual(ids(plan.read), [2]);
  });

  it('AC14: checking a file again reads just that file', () => {
    const plan = planFileChanges([f(1), f(2, false)], [f(1), f(2)]);
    assert.deepEqual({ changed: plan.changed, rebuild: plan.rebuild, read: ids(plan.read) }, { changed: true, rebuild: false, read: [2] });
  });

  it('AC14: unchecking or removing a loaded file reads every checked file again', () => {
    const unchecked = planFileChanges([f(1), f(2), f(3)], [f(1), f(2, false), f(3), f(4)]);
    assert.deepEqual({ rebuild: unchecked.rebuild, read: ids(unchecked.read) }, { rebuild: true, read: [1, 3, 4] });
    const removed = planFileChanges([f(1), f(2)], [f(2)]);
    assert.deepEqual({ rebuild: removed.rebuild, read: ids(removed.read) }, { rebuild: true, read: [2] });
  });

  it('AC14, AC18: checking a file read together with a loaded file of its kind reads everything again', () => {
    const ig = (id, on) => f(id, on, { kind: 'instagram' });
    const sms = (id, on) => f(id, on, { kind: 'sms' });
    const media = planFileChanges([sms(1), ig(2), ig(3, false)], [sms(1), ig(2), ig(3)]);
    assert.deepEqual({ rebuild: media.rebuild, read: ids(media.read) }, { rebuild: true, read: [1, 2, 3] });
    const wa = planFileChanges([f(1, true, { kind: 'whatsapp' })], [f(1, true, { kind: 'whatsapp' }), f(2, true, { kind: 'whatsapp' })]);
    assert.equal(wa.rebuild, true, 'WhatsApp date formats are worked out from every export at once');
    const gchat = planFileChanges([f(1, true, { kind: 'gchat' })], [f(1, true, { kind: 'gchat' }), f(2, true, { kind: 'gchat' })]);
    assert.equal(gchat.rebuild, true, 'a split Takeout spreads a conversation across parts');
    const apart = planFileChanges([sms(1)], [sms(1), sms(2)]);
    assert.deepEqual({ rebuild: apart.rebuild, read: ids(apart.read) }, { rebuild: false, read: [2] }, 'SMS backups are read one by one');
    const first = planFileChanges([sms(1)], [sms(1), ig(2), ig(3)]);
    assert.deepEqual({ rebuild: first.rebuild, read: ids(first.read) }, { rebuild: false, read: [2, 3] }, 'no Instagram loaded yet');
    const unchecked = planFileChanges([ig(1, false)], [ig(1, false), ig(2)]);
    assert.equal(unchecked.rebuild, false, 'an unchecked part of the kind is not loaded');
  });

  it('AC14: removing a file that was unchecked changes the list without reading', () => {
    const plan = planFileChanges([f(1), f(2, false)], [f(1)]);
    assert.deepEqual({ changed: plan.changed, rebuild: plan.rebuild, read: ids(plan.read) }, { changed: true, rebuild: false, read: [] });
  });

  it('AC10: unreadable rows are never read and alone are no change', () => {
    const bad = f(2, false, { error: "This is Telegram's HTML export" });
    assert.equal(planFileChanges([f(1)], [f(1), bad]).changed, false);
    assert.deepEqual(ids(planFileChanges([f(1)], [f(1), bad, f(3)]).read), [3]);
  });

  it('AC8, AC9: Apply needs a checked file, unless every file is removed', () => {
    assert.equal(canApplyFiles([f(1), f(2)], [f(1, false), f(2, false)]), false);
    assert.equal(canApplyFiles([f(1), f(2)], [f(1, false), f(2)]), true);
    assert.equal(canApplyFiles([f(1)], []), true);
    assert.equal(canApplyFiles([f(1)], [f(2, false, { error: 'bad' })]), true, 'only an unreadable row left: same as removing everything');
  });

  it('AC6: the same file is name, size and last-modified time', () => {
    const a = { name: 'sms.xml', size: 10, lastModified: 5 };
    assert.equal(sameFile(a, { ...a }), true);
    assert.equal(sameFile(a, { ...a, lastModified: 6 }), false);
    assert.equal(sameFile(a, { ...a, name: 'sms-2.xml' }), false);
  });
});

describe('spec 009 Messenger in the Files dialog', () => {
  const as = (id, kind, on = true) => f(id, on, { kind });

  it('AC16: reading a loaded file as the other app reads everything again', () => {
    const plan = planFileChanges([as(1, 'sms'), as(2, 'instagram')], [as(1, 'sms'), as(2, 'messenger')]);
    assert.deepEqual({ changed: plan.changed, rebuild: plan.rebuild, read: ids(plan.read) }, { changed: true, rebuild: true, read: [1, 2] });
    assert.equal(canApplyFiles([as(2, 'instagram')], [as(2, 'messenger')]), true);
  });

  it('AC16: changing the app of an unchecked file is a change, with nothing to read', () => {
    const plan = planFileChanges([as(1, 'sms'), as(2, 'instagram', false)], [as(1, 'sms'), as(2, 'messenger', false)]);
    assert.deepEqual({ changed: plan.changed, rebuild: plan.rebuild, read: ids(plan.read) }, { changed: true, rebuild: false, read: [] });
  });

  it('R11: Messenger files are read together, like Instagram parts', () => {
    const plan = planFileChanges([as(1, 'messenger'), as(2, 'messenger', false)], [as(1, 'messenger'), as(2, 'messenger')]);
    assert.deepEqual({ rebuild: plan.rebuild, read: ids(plan.read) }, { rebuild: true, read: [1, 2] });
  });
});

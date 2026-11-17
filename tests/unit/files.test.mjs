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

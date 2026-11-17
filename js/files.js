/* Loaded files (spec 006): the pure parts of the Files dialog. app.js holds the dialog and the loading. */

/** The same file again: name, size and last-modified time all match. */
const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * What applying the Files dialog's `draft` to the loaded `current` list takes. Entries are
 * `{ id, on, error? }`; rows with an `error` can't be read and are dropped. Reading only
 * ever adds, so newly checked files can load on their own, but leaving out a loaded file
 * means reading every checked file again (overlapping exports are deduplicated as they're
 * read, so one file's share can't be taken back out).
 * Returns `{ changed, rebuild, read }`: `read` is the entries to read, in draft order.
 */
function planFileChanges(current, draft) {
  const usable = draft.filter((e) => !e.error);
  const was = new Map(current.map((e) => [e.id, e]));
  const now = new Map(usable.map((e) => [e.id, e]));
  const rebuild = current.some((e) => e.on && !(now.has(e.id) && now.get(e.id).on));
  const changed = current.length !== usable.length || usable.some((e) => !was.has(e.id) || was.get(e.id).on !== e.on);
  const read = rebuild ? usable.filter((e) => e.on) : usable.filter((e) => e.on && !(was.has(e.id) && was.get(e.id).on));
  return { changed, rebuild, read };
}

/** Whether the dialog's Apply can run: something changed, and it isn't every file unchecked (R9). */
function canApplyFiles(current, draft) {
  const usable = draft.filter((e) => !e.error);
  return planFileChanges(current, draft).changed && (!usable.length || usable.some((e) => e.on));
}

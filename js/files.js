/* Loaded files (spec 006): the pure parts of the Files dialog. app.js holds the dialog and the loading. */

/** The same file again: name, size and last-modified time all match. */
const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * Kinds whose files are parsed together, so one can't be read alone next to others already
 * loaded (R16): a split Takeout spreads a conversation across parts, a split Instagram
 * export keeps its media in another part, and WhatsApp date formats are worked out from
 * every export at once.
 */
const READ_TOGETHER = new Set(['gchat', 'whatsapp', 'instagram', 'messenger']);

/**
 * What applying the Files dialog's `draft` to the loaded `current` list takes. Entries are
 * `{ id, on, kind, error? }`; rows with an `error` can't be read and are dropped. Reading
 * only ever adds, so newly checked files can usually load on their own. Everything is read
 * again (a rebuild) when a loaded file is left out, since overlapping exports are
 * deduplicated as they're read and one file's share can't be taken back out, or when a
 * new file must be read together with loaded files of its kind, or when a loaded file is
 * to be read as another app (spec 009 R13).
 * Returns `{ changed, rebuild, read }`: `read` is the entries to read, in draft order.
 */
function planFileChanges(current, draft) {
  const usable = draft.filter((e) => !e.error);
  const was = new Map(current.map((e) => [e.id, e]));
  const now = new Map(usable.map((e) => [e.id, e]));
  const loaded = (e) => was.has(e.id) && was.get(e.id).on;
  const kept = usable.filter((e) => e.on && loaded(e));
  const fresh = usable.filter((e) => e.on && !loaded(e));
  const dropped = current.some((e) => e.on && !(now.has(e.id) && now.get(e.id).on));
  const joins = fresh.some((e) => READ_TOGETHER.has(e.kind) && kept.some((k) => k.kind === e.kind));
  // A loaded file read as another app now (spec 009 R13): its messages have to come out and go back in.
  const recast = kept.some((e) => was.get(e.id).kind !== e.kind);
  const rebuild = dropped || joins || recast;
  const changed = current.length !== usable.length || usable.some((e) => !was.has(e.id) || was.get(e.id).on !== e.on || was.get(e.id).kind !== e.kind);
  return { changed, rebuild, read: rebuild ? usable.filter((e) => e.on) : fresh };
}

/** Whether the dialog's Apply can run: something changed, and it isn't every file unchecked (R9). */
function canApplyFiles(current, draft) {
  const usable = draft.filter((e) => !e.error);
  return planFileChanges(current, draft).changed && (!usable.length || usable.some((e) => e.on));
}

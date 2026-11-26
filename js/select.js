/*
 * What's picked on the dashboard (View) and what it selects (Select), spec 014 step 6.
 *
 * Select caches the selection and the numbers worked out from it (R7). Each value is
 * kept until something it depends on changes, so drawing again for a new theme, a
 * sorted table or another tab reuses them. Every key includes Data.version, which
 * Data.rederive bumps whenever records change (a load, owners, links).
 */

/** What's picked. Changing it doesn't redraw anything by itself. */
const View = {
  filter: { contact: 'all', source: 'all', groups: true, from: null, to: null },
  convoGap: CONVO_GAP, // silence that ends a conversation (picked in Settings and saved in Prefs, spec 015)
  appsGap: APPS_GAP, // the same, for the Across apps tab only (spec 007 R7)
  gran: 'auto', // timeline bars: auto / day / week / month
  moodScorer: 'vader', // 'vader' | 'ai' (spec 001): which scores the mood chart and pills use
  phrase: '', // word tracker query
  phraseGran: 'auto', // word tracker bars
  vocabMo: null, // month picked on the Vocabulary chart (null = the latest)
  calYear: null, // year shown on the calendar heatmap
  wrapYear: null, // year shown in Year in review
  otd: null, // { month, day } shown in On this day (null = today)
  leader: { sort: 'n', asc: false, all: false }, // leaderboard sorting
  // The message list: how many of the latest to show, the search, the mood chart's pick
  // ({ mo, o (null = both), kind: 'pos' | 'neg' | 'any' }) and whether scores show.
  browser: { limit: 200, query: '', mood: null, showMood: false },
  // What the date range is compared with (spec 021): 'before' (the same number of days
  // before it), 'year' (a year earlier) or 'custom' (from, to: ms, used only for custom).
  compare: { mode: 'before', from: null, to: null },
  emojiRx: true, // Top emoji counts reactions too (spec 027 R11)
};

/** `D`'s messages in a conversation (or 'all'), an app (or 'all'), with or without group chats. */
function selectMessages(D, { contact, source, groups }) {
  const ofApp = (m) => source === 'all' || (m.s || 0) === source;
  // A linked person (spec 005) spans apps, so the app filter still applies to it.
  if (contact !== 'all') {
    const own = D.messagesOf(contact); // the index, not a scan of every message (R11)
    return source === 'all' ? own : own.filter(ofApp);
  }
  if (source === 'all' && groups) return D.msgs;
  return D.msgs.filter((m) => ofApp(m) && (groups || !m.k.startsWith('g:')));
}

/** `D`'s calls in a conversation (or 'all'). Calls only come from SMS Backup & Restore. */
function selectCalls(D, { contact, source }) {
  if (source !== 'all' && source !== 0) return [];
  return contact === 'all' ? D.calls : D.calls.filter((c) => c.k === contact);
}

/** The part of a time-sorted array between `from` and `to` (ms, null = open), found by binary search. */
function inDates(arr, from, to) {
  if (from == null && to == null) return arr;
  const lower = (x) => {
    let a = 0, b = arr.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (arr[mid].t < x) a = mid + 1; else b = mid;
    }
    return a;
  };
  return arr.slice(from == null ? 0 : lower(from), to == null ? arr.length : lower(to + 1));
}

/** A one-value cache: `get(deps, compute)` recomputes only when a dependency differs. */
function cache() {
  let deps = null;
  let value;
  return {
    get(next, compute) {
      if (!deps || next.length !== deps.length || next.some((d, i) => d !== deps[i])) {
        value = compute();
        deps = next;
      }
      return value;
    },
  };
}

const Select = {
  caches: {
    base: cache(), range: cache(), calls: cache(), agg: cache(), content: cache(), cross: cache(), docFreq: cache(),
    periods: cache(), compareRange: cache(), compareAgg: cache(),
    rhythm: cache(), unusual: cache(), reactions: cache(),
  },

  baseDeps() {
    const { contact, source, groups } = View.filter;
    return [Data.version, contact, source, groups];
  },

  rangeDeps() {
    return [...this.baseDeps(), View.filter.from, View.filter.to];
  },

  /** Messages matching the conversation, app and group filters, at any date. */
  base() {
    return this.caches.base.get(this.baseDeps(), () => selectMessages(Data, View.filter));
  },

  /** base() within the date range: what the dashboard shows. */
  range() {
    return this.caches.range.get(this.rangeDeps(), () => inDates(this.base(), View.filter.from, View.filter.to));
  },

  /** Calls matching the filters, at any date. */
  calls() {
    return this.caches.calls.get(this.baseDeps(), () => selectCalls(Data, View.filter));
  },

  /** aggregateMessages over range(). */
  agg() {
    return this.caches.agg.get([...this.rangeDeps(), View.convoGap], () => aggregateMessages(this.range(), View.convoGap));
  },

  /** aggregateContent over range(), by the picked mood scorer. */
  content() {
    return this.caches.content.get([...this.rangeDeps(), View.moodScorer, AiMood.scoresVersion], () => aggregateContent(this.range(), View.moodScorer));
  },

  /** aggregateCrossApp over range() (spec 007). */
  cross() {
    return this.caches.cross.get([...this.rangeDeps(), View.appsGap], () => aggregateCrossApp(this.range(), View.appsGap));
  },

  compareDeps() {
    const { mode, from, to } = View.compare;
    return [...this.rangeDeps(), mode, from, to];
  },

  /**
   * The two periods to compare (spec 021): comparePeriods for the date range, or null with
   * no messages. History starts at the selection's first message, and ends where an open
   * date range ends everywhere else (the presets, the scope line): the last thing loaded.
   * Days after a conversation's last message still count, so going quiet shows.
   */
  periods() {
    return this.caches.periods.get(this.compareDeps(), () => {
      const base = this.base();
      if (!base.length) return null;
      return comparePeriods(View.filter, View.compare, { first: base[0].t, last: Math.max(base[base.length - 1].t, dataBounds().last) });
    });
  },

  /** base() within the period the date range is compared with ([] when there's none). */
  compareRange() {
    return this.caches.compareRange.get(this.compareDeps(), () => {
      const a = this.periods()?.a;
      return a ? inDates(this.base(), a.from, a.to) : [];
    });
  },

  /** aggregateMessages over compareRange(). The date range's own is agg(). */
  compareAgg() {
    return this.caches.compareAgg.get([...this.compareDeps(), View.convoGap], () => aggregateMessages(this.compareRange(), View.convoGap));
  },

  /** Your day, by rhythm day, with the schedule and time away worked out from it (spec 020). */
  rhythm() {
    return this.caches.rhythm.get(this.rangeDeps(), () => {
      const days = yourDays(this.range(), utcApps());
      return { days, schedule: sleepSchedule(days), away: awayStretches(days) };
    });
  },

  /** Days far busier or quieter than normal for a conversation (spec 020). */
  unusual() {
    return this.caches.unusual.get(this.rangeDeps(), () => unusualDays(this.range()));
  },

  /** aggregateReactions over the reactions in range() (spec 027 R9). */
  reactions() {
    return this.caches.reactions.get([...this.rangeDeps(), View.convoGap], () => aggregateReactions(
      selectReactions(Data.reactionEvents, View.filter),
      { gap: View.convoGap, byKey: Data.byKey },
    ));
  },

  /** How many conversations in the picked app use each word (for "What you talk about"). */
  docFreq() {
    const { source, groups } = View.filter;
    return this.caches.docFreq.get([Data.version, source, groups], () => buildDocFreq(selectMessages(Data, { contact: 'all', source, groups })));
  },

  /** One conversation's messages in the picked app and dates. */
  messagesOf(k) {
    const { source, from, to } = View.filter;
    return inDates(selectMessages(Data, { contact: k, source, groups: true }), from, to);
  },

  /**
   * conversationTerms of a conversation in the picked app and dates (spec 019): its words
   * and rare phrases, for inside jokes and "What you talk about". Kept per conversation
   * until the data, app, groups or dates change.
   */
  terms(k) {
    const { source, groups, from, to } = View.filter;
    const deps = [Data.version, source, groups, from, to].join('\n');
    if (this.termsDeps !== deps) {
      this.termsDeps = deps;
      this.termsByKey = new Map();
    }
    let t = this.termsByKey.get(k);
    if (!t) this.termsByKey.set(k, (t = conversationTerms(this.messagesOf(k), this.docFreq())));
    return t;
  },
  termsDeps: null,
  termsByKey: new Map(),
};

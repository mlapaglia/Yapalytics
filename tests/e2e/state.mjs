/*
 * The browser tests' one window into the app's internals (spec 014 R12). Specs read
 * state and call app functions only through inApp(), never through `S` or the app's
 * own function names, so when the app moves its state around only VIEW changes.
 *
 *   const n = await inApp(page, (app) => app.msgs.length);
 *   const p = await inApp(page, (app, key) => app.personOf.get(key), key);
 *
 * Like page.evaluate, the function runs in the page: it can't use variables from the
 * spec file, only `app`, its argument and the page's globals (library functions like
 * aggregateMessages, echarts, document).
 */

/**
 * Builds `app` in the page. It is serialized into the page, so it may only use the
 * page's globals.
 */
function VIEW() {
  return {
    // What's loaded
    get msgs() { return Data.msgs; },
    get calls() { return Data.calls; },
    get contacts() { return Data.contacts; },
    get personOf() { return Data.personOf; },
    get owners() { return Prefs.owners; },
    get reactions() { return Data.reactions; },
    get files() { return S.files; },

    // What's picked
    get filter() { return View.filter; },
    get moodScorer() { return View.moodScorer; },
    get convoGap() { return View.convoGap; },
    get appsGap() { return View.appsGap; },
    get phrase() { return View.phrase; },

    // What's shown
    get topRows() { return S.topRows; },
    get browserShown() { return S.browserShown; },
    get browserMood() { return View.browser.mood; },
    get phraseMsgs() { return S.phraseMsgs; },
    get vocab() { return S.vocab; },

    /** Messages matching the filters and the date range. */
    selection: () => Select.range(),
    /** Adds analyzed message records to what's loaded and redraws. */
    addMessages(list) {
      Data.addBatch(list, []);
      Data.finish();
      rederive();
      refresh();
    },
    /** Picks a month on the Vocabulary card. */
    setVocabMonth(mo) {
      View.vocabMo = mo;
      renderVocab();
    },
    openProfile: (key) => openProfile(key),
    plainName: (key) => plainName(key),
    readDay: (dayStart) => readDay(dayStart),
    showMoodMessages: (mo, o, kind) => showMoodMessages(mo, o, kind),
    explainMood: (body) => moodLib().explainMood(body),
    /** Picks two conversations under "Link by hand" in the People dialog. */
    pickToLink(a, b) {
      setPickerValue(document.querySelector('#peopleA'), a);
      setPickerValue(document.querySelector('#peopleB'), b);
      syncPeopleLink();
    },
  };
}

/** Runs `fn(app, arg)` in the page and returns its (awaited) result. */
export function inApp(page, fn, arg) {
  return page.evaluate(({ view, fn, arg }) => {
    const app = new Function(`return (${view})();`)();
    return new Function('app', 'arg', `return (${fn})(app, arg);`)(app, arg);
  }, { view: VIEW.toString(), fn: fn.toString(), arg });
}

/*
 * Startup. Everything else lives where it belongs (spec 014):
 *   sources.js   the apps that can be read          dataset.js  what's loaded (Data)
 *   store.js     settings (Prefs, Store)             select.js   what's picked (View), and its numbers (Select)
 *   panels.js    the dashboard's panels              panels/     one file per tab
 *   ui/          the filter bar, loading, dialogs, profile, theme
 */

/** What's loaded from files, and what's worked out from it. */
const Data = createDataset();

function init() {
  Prefs.load();
  initTheme();
  initLoader();
  initFilters();
  initOwners();
  initPeople();
  initFiles();
  initProfile();
  Panels.init();
  AiMood.init({ setScorer: setMoodScorer });
  AiAnalysis.init({ nameOf: plainName, senderOf: senderLabel, readDay });
  initViewer();
  initGallery();
  Tabs.init({ onShown: onTabShown, onHidden: onTabHidden });
}

document.addEventListener('DOMContentLoaded', init);

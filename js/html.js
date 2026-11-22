/*
 * Building HTML from strings without letting text become markup (spec 014 R3).
 *
 *   html`<b>${name}</b>`   escapes `name`. Values that are already SafeHtml (from html`…`
 *                          or raw()) go in as they are, so pieces nest; arrays are joined;
 *                          null, undefined and false become ''.
 *   raw(markup)            marks markup written in the code as safe. Never pass it text
 *                          that came from an export.
 *
 * A SafeHtml turns into its markup wherever a string is wanted (el.innerHTML = …). Chart
 * tooltip formatters must return a real string, so they return String(html`…`).
 */
class SafeHtml {
  constructor(markup) {
    this.markup = markup;
  }

  toString() {
    return this.markup;
  }
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function htmlPart(v) {
  if (v == null || v === false) return '';
  if (v instanceof SafeHtml) return v.markup;
  if (Array.isArray(v)) return v.map(htmlPart).join('');
  return escapeHtml(v);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += htmlPart(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

const raw = (markup) => new SafeHtml(String(markup));

// Read-only WebDriver executeScript body; does not invoke actions or refresh UI.
const prefix = 'P7_OUTLINE_DIAGNOSTICS_V1 ';
const nodes = [...document.querySelectorAll('.plugin-list-panel[title]')]
  .filter(node => node.getAttribute('title').startsWith(prefix));
if (nodes.length !== 1) return { ok: false, reason: 'diagnostic-panel-count', count: nodes.length };
const value = nodes[0].getAttribute('title').slice(prefix.length);
if (value === 'pending') return { ok: false, reason: 'pending' };
if (value.length > 8192) return { ok: false, reason: 'summary-budget' };
try {
  const result = JSON.parse(value);
  if (result.schema !== 1 || result.error) return { ok: false, reason: 'diagnostic-summary-error', result };
  return { ok: true, result };
} catch { return { ok: false, reason: 'invalid-json' }; }

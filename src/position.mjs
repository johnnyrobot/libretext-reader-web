const PREFIX = 'tts:pos:';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function savePosition(pageId, sentenceId) {
  try {
    localStorage.setItem(PREFIX + pageId, JSON.stringify({ sentenceId, updatedAt: Date.now() }));
  } catch { /* private mode or quota; position is a convenience, not a requirement */ }
}

export function loadPosition(pageId) {
  try {
    const raw = localStorage.getItem(PREFIX + pageId);
    if (!raw) return null;
    const { sentenceId, updatedAt } = JSON.parse(raw);
    if (!sentenceId || Date.now() - updatedAt > MAX_AGE_MS) return null;
    return sentenceId;
  } catch {
    return null;
  }
}

export function clearPosition(pageId) {
  try { localStorage.removeItem(PREFIX + pageId); } catch { /* ignore */ }
}

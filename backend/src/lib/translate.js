// Server-side proxy to the Gemini API (CLAUDE.md §13, 2026-08-21 exception —
// same shape as the Nominatim geocode proxy in routes/onboarding.js: the
// vendor key never reaches the client, and the caller gets back only the
// translated string, never the raw upstream response.
// flash-lite, not the flagship flash model: it answers a short-label
// translation in well under a second with no reasoning-token overhead, where
// the flagship model's mandatory "thinking" pass made this endpoint's
// latency swing wildly (observed 3-18s+, occasional 503s) for a task this
// simple. Override via env if a future model rename requires it.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

async function translateText(text, targetLang) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('Translation is not configured');
    err.status = 503;
    throw err;
  }
  const targetName = targetLang === 'ar' ? 'Arabic' : 'English';
  const prompt =
    `Translate the following text to ${targetName}. It is a short label from a` +
    ` bilingual business-app form. Return ONLY the translated text — no quotes,` +
    ` no notes, no alternate options.\n\n${text}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    const err = new Error('Translation service is unreachable');
    err.status = 502;
    throw err;
  }
  if (!upstream.ok) {
    const err = new Error('Translation service error');
    err.status = 502;
    throw err;
  }
  const data = await upstream.json();
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out || !out.trim()) {
    const err = new Error('Translation service returned no result');
    err.status = 502;
    throw err;
  }
  return out.trim();
}

module.exports = { translateText };

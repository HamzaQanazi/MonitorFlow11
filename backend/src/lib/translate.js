// Server-side proxy to the Gemini API (CLAUDE.md §13, 2026-08-21 exception —
// same shape as the Nominatim geocode proxy in routes/onboarding.js: the
// vendor key never reaches the client, and the caller gets back only the
// translated string, never the raw upstream response.
// flash-lite, not the flagship flash model — see the flagship model's own
// quota problems documented in lib/chatbot.js. Override via env if a future
// model rename requires it.
// STALE, keep for the record: this comment used to say flash-lite answers
// "well under a second." Re-measured 2026-09-22 — this Gemini API version
// runs a mandatory internal "thinking" pass on gemini-3.5-flash-lite
// regardless of task size (confirmed: ~20-30s even for a two-word
// translation, same finding as lib/chatbot.js). thinkingBudget: 0 is
// rejected by this model (400); thinkingLevel: 'LOW' is the lowest setting
// it accepts and is applied below — it cuts latency meaningfully (~30s to
// ~22s observed) but nowhere near "under a second" anymore.
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
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { thinkingConfig: { thinkingLevel: 'LOW' } },
      }),
      // Was 8000 — far short of this model's real ~20-30s latency (see the
      // MODEL comment above), so every call was failing before this fix.
      // 35s, not 30s, to match lib/chatbot.js's same-model timeout — 30s cut
      // it too close and a real request timed out against it during testing.
      signal: AbortSignal.timeout(35000),
    });
  } catch (fetchErr) {
    // Was silently swallowed before — same fix as lib/chatbot.js. Logging
    // the real cause (timeout vs DNS vs connection refused) is the only way
    // to diagnose "unreachable" instead of guessing.
    console.error(`translate: fetch to Gemini failed: ${fetchErr.name}: ${fetchErr.message}`);
    const err = new Error('Translation service is unreachable');
    err.status = 502;
    throw err;
  }
  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    console.error(`translate: Gemini returned ${upstream.status}: ${body.slice(0, 300)}`);
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

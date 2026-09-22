// Server-side proxy to the Groq API (CLAUDE.md §13, 2026-08-21 exception —
// same shape as the Nominatim geocode proxy in routes/onboarding.js: the
// vendor key never reaches the client, and the caller gets back only the
// translated string, never the raw upstream response.
// Switched from Gemini to Groq 2026-09-22, user-directed: Gemini's
// gemini-3.5-flash-lite runs a mandatory internal "thinking" pass regardless
// of task size (~20-30s even for a two-word label, see git history on this
// file). Groq runs open-weight models on inference hardware built for low
// latency with no reasoning step by default — openai/gpt-oss-20b is more
// than enough for a short-label translation (measured ~600ms). OpenAI-
// compatible chat completions API, not Gemini's generateContent shape.
// Override via env if a future model rename requires it (Groq's catalogue
// churns — check https://console.groq.com/docs/models if this 404s).
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

async function translateText(text, targetLang) {
  const apiKey = process.env.GROQ_API_KEY;
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

  let upstream;
  try {
    upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (fetchErr) {
    console.error(`translate: fetch to Groq failed: ${fetchErr.name}: ${fetchErr.message}`);
    const err = new Error('Translation service is unreachable');
    err.status = 502;
    throw err;
  }
  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    console.error(`translate: Groq returned ${upstream.status}: ${body.slice(0, 300)}`);
    const err = new Error(upstream.status === 429 ? 'Translation is busy, try again shortly' : 'Translation service error');
    err.status = upstream.status === 429 ? 429 : 502;
    throw err;
  }
  const data = await upstream.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out || !out.trim()) {
    const err = new Error('Translation service returned no result');
    err.status = 502;
    throw err;
  }
  return out.trim();
}

module.exports = { translateText };

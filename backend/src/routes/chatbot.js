// POST /chatbot/message — in-app help/FAQ assistant (CLAUDE.md §13, chatbot
// exception). Answers "how do I..." questions from a fixed app-description
// grounding (lib/chatbot.js), not live data — any authenticated account kind
// may call it (I2's three kinds all get help). No capability gate: it has no
// write path and touches no per-user data, so I3's two gates don't apply —
// there's nothing here to scope by department or ownership.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { askChatbot } = require('../lib/chatbot');

const router = express.Router();
router.use(requireAuth);

const MAX_MESSAGE_LEN = 1000;
const MAX_HISTORY_ITEMS = 20;

// Per-user cap, same shape as auth.js's rateLimitLogin — this endpoint is
// authenticated (unlike login), so the real risk isn't brute force, it's one
// account burning the shared Gemini quota/cost.
const WINDOW_MS = 5 * 60 * 1000;
const MAX_MESSAGES = 20;
const messageCounts = new Map();

function rateLimitChat(req, res, next) {
  const key = req.user.id;
  const now = Date.now();
  const entry = messageCounts.get(key);
  if (!entry || now > entry.resetAt) {
    messageCounts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  if (entry.count >= MAX_MESSAGES) {
    return res.status(429).json({ error: 'Too many messages, try again in a few minutes' });
  }
  entry.count += 1;
  next();
}

router.post('/message', rateLimitChat, async (req, res, next) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const historyIn = Array.isArray(req.body?.history) ? req.body.history : [];
    const page = typeof req.body?.page === 'string' ? req.body.page.trim().slice(0, 60) : undefined;
    // Same trust level as `page` — advisory context for the model, not a security
    // boundary (this endpoint takes no gated action), so no need to validate
    // against the real capability catalogue. Capped so a bad client can't bloat
    // the prompt.
    const capabilities = Array.isArray(req.body?.capabilities)
      ? req.body.capabilities.filter((c) => typeof c === 'string').slice(0, 20)
      : undefined;
    const features = Array.isArray(req.body?.features)
      ? req.body.features.filter((f) => typeof f === 'string').slice(0, 20)
      : undefined;
    const errors = {};
    if (!message) errors.message = 'Message is required';
    else if (message.length > MAX_MESSAGE_LEN) errors.message = `Must be ${MAX_MESSAGE_LEN} characters or fewer`;
    if (historyIn.length > MAX_HISTORY_ITEMS) {
      errors.history = `Must be ${MAX_HISTORY_ITEMS} items or fewer`;
    } else if (
      historyIn.some(
        (h) =>
          !h ||
          (h.role !== 'user' && h.role !== 'assistant') ||
          typeof h.text !== 'string' ||
          h.text.length > MAX_MESSAGE_LEN
      )
    ) {
      errors.history = 'Invalid history item';
    }
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const reply = await askChatbot(message, historyIn, req.user.role, page, capabilities, features);
    res.json({ reply });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;

// API suite for Events and the Knowledge Base — neither had one. Covers the
// two backend changes from the 2026-08-22 page review: an event can no longer
// be saved ending before it starts via a partial update, and the KB list is
// searchable.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll, query } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('events_kb_api');
  // The fixture company onboards with time_clock only; these two modules are
  // feature-gated, so turn them on the documented way (§15, test DB only).
  await query(`UPDATE company SET features = features || '{events,knowledge_base}'`);
  tokens = await loginAll();
});

after(() => stopServer());

async function newEvent(startsAt, endsAt = null) {
  const res = await api('POST', '/events', {
    token: tokens.admin,
    body: { title: { en: 'Town hall', ar: 'اجتماع' }, startsAt, endsAt },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.event.id;
}

// ---- Events

test('an end before the start is refused on create', async () => {
  const res = await api('POST', '/events', {
    token: tokens.admin,
    body: {
      title: { en: 'Backwards', ar: 'معكوس' },
      startsAt: '2026-09-10T10:00:00Z',
      endsAt: '2026-09-10T09:00:00Z',
    },
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.endsAt);
});

test('moving only the end, back past the stored start, is refused too', async () => {
  const id = await newEvent('2026-09-10T10:00:00Z', '2026-09-10T12:00:00Z');
  // The partial update sends no startsAt, so the check had nothing to compare
  // against and let the event end before it began.
  const res = await api('PATCH', `/events/${id}`, {
    token: tokens.admin,
    body: { endsAt: '2026-09-10T08:00:00Z' },
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.ok(res.body.errors.endsAt);
});

test('moving only the start, forward past the stored end, is refused', async () => {
  const id = await newEvent('2026-09-11T10:00:00Z', '2026-09-11T12:00:00Z');
  const res = await api('PATCH', `/events/${id}`, {
    token: tokens.admin,
    body: { startsAt: '2026-09-11T18:00:00Z' },
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.ok(res.body.errors.startsAt);
});

test('a legitimate partial move still works', async () => {
  const id = await newEvent('2026-09-12T10:00:00Z', '2026-09-12T12:00:00Z');
  const res = await api('PATCH', `/events/${id}`, {
    token: tokens.admin,
    body: { endsAt: '2026-09-12T14:00:00Z' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('GET /events/:id carries the attendee names the detail view renders', async () => {
  const id = await newEvent('2026-09-13T10:00:00Z');
  assert.equal((await api('POST', `/events/${id}/rsvp`, { token: tokens.root })).status, 204);

  const res = await api('GET', `/events/${id}`, { token: tokens.admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.event.attendeeCount, 1);
  assert.equal(res.body.event.attendeeNames.length, 1);
});

// ---- Knowledge base

async function newArticle(titleEn, bodyEn) {
  const res = await api('POST', '/knowledge-base', {
    token: tokens.admin,
    body: { title: { en: titleEn, ar: titleEn }, body: { en: bodyEn, ar: bodyEn } },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.article.id;
}

test('the article list is searchable by title and by body', async () => {
  await newArticle('Fire safety', 'Where the extinguishers live');
  await newArticle('Holiday policy', 'How to request annual leave');

  const all = await api('GET', '/knowledge-base', { token: tokens.admin });
  assert.ok(all.body.articles.length >= 2);

  const byTitle = await api('GET', '/knowledge-base?q=holiday', { token: tokens.admin });
  assert.equal(byTitle.body.articles.length, 1);
  assert.equal(byTitle.body.articles[0].title.en, 'Holiday policy');

  // Matching on body text is the point — a title-only search would miss this.
  const byBody = await api('GET', '/knowledge-base?q=extinguishers', { token: tokens.admin });
  assert.equal(byBody.body.articles.length, 1);
  assert.equal(byBody.body.articles[0].title.en, 'Fire safety');

  const none = await api('GET', '/knowledge-base?q=zzzznothing', { token: tokens.admin });
  assert.equal(none.body.articles.length, 0);
});

test('an article carries its body, which is what the reader renders', async () => {
  const id = await newArticle('Readable', 'The text a manager actually needs');
  const res = await api('GET', `/knowledge-base/${id}`, { token: tokens.admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.article.body.en, 'The text a manager actually needs');
});

test('a field employee can read the knowledge base but not write to it', async () => {
  assert.equal((await api('GET', '/knowledge-base', { token: tokens.field1 })).status, 200);
  const write = await api('POST', '/knowledge-base', {
    token: tokens.field1,
    body: { title: { en: 'No', ar: 'لا' }, body: { en: 'No', ar: 'لا' } },
  });
  assert.equal(write.status, 403);
});

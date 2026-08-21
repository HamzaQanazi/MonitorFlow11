// Lateness is judged against shift_template.start_time, which a manager types
// as local wall clock. Before COMPANY_TZ existed the comparison ran in UTC, so
// on this UTC+3 deployment an 11:30 local clock-in against a 09:00 shift was
// not "late" — the Late clock-ins counter under-reported by the whole offset.
// COMPANY_TZ is read once at require() time, so it must be set first; node
// --test runs each file in its own process, so this doesn't leak.
process.env.COMPANY_TZ = 'Asia/Gaza'; // UTC+3, no DST in the relevant window

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { companyDate, companyDayIndex, computeAttendance } = require('../src/lib/timeClock');

const defaultShift = { expectedStartTime: '09:00:00', expectedEndTime: '17:00:00' };
const shiftAt = (clockInAt, clockOutAt) => ({ clockInAt, clockOutAt, status: 'completed' });

test('a clock-in after the local start time is late', () => {
  // 09:05 local = 06:05Z — used to read as 06:05 vs 09:00 and pass as on time.
  const r = computeAttendance({ shift: shiftAt('2026-08-03T06:05:00Z', '2026-08-03T14:00:00Z'), defaultShift });
  assert.equal(r.lateClockIn, true);
});

test('a clock-in before the local start time is not late', () => {
  // 08:55 local = 05:55Z
  const r = computeAttendance({ shift: shiftAt('2026-08-03T05:55:00Z', '2026-08-03T14:00:00Z'), defaultShift });
  assert.equal(r.lateClockIn, false);
});

test('a clock-out after the local end time is late', () => {
  // out 18:00 local = 15:00Z, against a 17:00 local end
  const r = computeAttendance({ shift: shiftAt('2026-08-03T05:55:00Z', '2026-08-03T15:00:00Z'), defaultShift });
  assert.equal(r.lateClockOut, true);
});

test('the calendar day is the company’s, not UTC’s', () => {
  // 22:00Z Monday is 01:00 Tuesday local — it belongs to Tuesday's column.
  assert.equal(companyDate(new Date('2026-08-03T22:00:00Z')), '2026-08-04');
  assert.equal(companyDayIndex('2026-08-03', '2026-08-03T22:00:00Z'), 1);
  assert.equal(companyDayIndex('2026-08-03', '2026-08-03T09:00:00Z'), 0);
});

test('the scheduled-start absence gate also runs on local time', () => {
  // 08:00 local = 05:00Z, before a 09:00 local start → not yet absent.
  const early = computeAttendance({ shift: null, defaultShift, date: '2026-08-03', now: new Date('2026-08-03T05:00:00Z') });
  assert.equal(early.absent, false);
  // 10:00 local = 07:00Z → absent.
  const late = computeAttendance({ shift: null, defaultShift, date: '2026-08-03', now: new Date('2026-08-03T07:00:00Z') });
  assert.equal(late.absent, true);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateManualShift, validateClockInLocation, computeAttendance, computeTimesheetDay } = require('../src/lib/timeClock');

// COMPANY_TZ is read at require() time and defaults to UTC, so every case here
// reasons in UTC. The timezone behaviour itself is covered in
// timeClockTz.test.js, which sets the env before requiring the module (node
// --test gives each file its own process).

test('accepts a well-formed past shift', () => {
  const clockInAt = new Date(Date.now() - 2 * 3600e3).toISOString();
  const clockOutAt = new Date(Date.now() - 1 * 3600e3).toISOString();
  assert.equal(validateManualShift({ clockInAt, clockOutAt }), null);
});

test('rejects missing or unparseable times', () => {
  assert.deepEqual(validateManualShift({ clockInAt: '', clockOutAt: '' }), {
    clockInAt: 'A valid clock-in time is required',
    clockOutAt: 'A valid clock-out time is required',
  });
  assert.ok(validateManualShift({ clockInAt: 'nope', clockOutAt: '2026-01-01T00:00:00Z' }).clockInAt);
});

test('rejects clock-out at or before clock-in', () => {
  const t = new Date().toISOString();
  const errors = validateManualShift({ clockInAt: t, clockOutAt: t });
  assert.equal(errors.clockOutAt, 'Clock-out must be after clock-in');
});

test('rejects a clock-out in the future', () => {
  const clockInAt = new Date(Date.now() - 3600e3).toISOString();
  const clockOutAt = new Date(Date.now() + 3600e3).toISOString();
  const errors = validateManualShift({ clockInAt, clockOutAt });
  assert.equal(errors.clockOutAt, 'Clock-out cannot be in the future');
});

test('rejects a shift longer than 24 hours', () => {
  const clockInAt = new Date(Date.now() - 30 * 3600e3).toISOString();
  const clockOutAt = new Date(Date.now() - 1 * 3600e3).toISOString();
  const errors = validateManualShift({ clockInAt, clockOutAt });
  assert.equal(errors.clockOutAt, 'A single shift cannot exceed 24 hours');
});

// validateClockInLocation — mandatory device fix at clock-in (I10-scoped).

test('accepts a well-formed location', () => {
  assert.equal(validateClockInLocation({ lat: 32.22, lng: 35.26 }), null);
});

test('rejects a missing location', () => {
  assert.deepEqual(validateClockInLocation(undefined), { location: 'A device location is required to clock in' });
  assert.deepEqual(validateClockInLocation(null), { location: 'A device location is required to clock in' });
});

test('rejects out-of-range or malformed coordinates', () => {
  assert.ok(validateClockInLocation({ lat: 91, lng: 0 }));
  assert.ok(validateClockInLocation({ lat: 0, lng: 181 }));
  assert.ok(validateClockInLocation({ lat: 'nope', lng: 0 }));
  assert.ok(validateClockInLocation({ lat: 0 })); // lng missing
  assert.ok(validateClockInLocation({ lat: 0, lng: 0, extra: 1 })); // unknown key
});

// computeAttendance — the Today tab's per-employee math.

test('no shift, a schedule entry exists and the start time has passed → absent', () => {
  const defaultShift = { expectedStartTime: '09:00:00', expectedEndTime: '17:00:00' };
  const r = computeAttendance({ shift: null, defaultShift, date: '2026-08-03', now: new Date('2026-08-03T09:30:00Z') });
  assert.equal(r.absent, true);
  assert.equal(r.totalHours, null);
});

test('no shift, but the scheduled start has not arrived yet → not absent', () => {
  const defaultShift = { expectedStartTime: '09:00:00', expectedEndTime: '17:00:00' };
  const r = computeAttendance({ shift: null, defaultShift, date: '2026-08-03', now: new Date('2026-08-03T08:00:00Z') });
  assert.equal(r.absent, false);
});

test('no shift on a past scheduled day → absent regardless of the time of day', () => {
  const defaultShift = { expectedStartTime: '09:00:00', expectedEndTime: '17:00:00' };
  const r = computeAttendance({ shift: null, defaultShift, date: '2026-08-02', now: new Date('2026-08-03T00:30:00Z') });
  assert.equal(r.absent, true);
});

test('no shift, no schedule entry for the date → never absent', () => {
  const r = computeAttendance({ shift: null, defaultShift: null });
  assert.equal(r.absent, false);
});

test('on-time clock-in, on-time clock-out, no overtime', () => {
  const shift = { clockInAt: '2026-08-03T09:00:00Z', clockOutAt: '2026-08-03T17:00:00Z', status: 'completed' };
  const defaultShift = { expectedStartTime: '09:00:00', expectedEndTime: '17:00:00' };
  const r = computeAttendance({ shift, defaultShift });
  assert.equal(r.lateClockIn, false);
  assert.equal(r.lateClockOut, false);
  assert.equal(r.totalHours, 8);
  assert.equal(r.overtimeHours, 0);
});

test('late clock-in, late clock-out, overtime, break time subtracted', () => {
  const shift = { clockInAt: '2026-08-03T09:30:00Z', clockOutAt: '2026-08-03T18:00:00Z', status: 'completed' };
  const defaultShift = { expectedStartTime: '09:00:00', expectedEndTime: '17:00:00' };
  const r = computeAttendance({ shift, breakSeconds: 1800, defaultShift });
  assert.equal(r.lateClockIn, true);
  assert.equal(r.lateClockOut, true);
  assert.equal(r.totalHours, 8); // 8.5h span - 0.5h break
  assert.equal(r.overtimeHours, 0);
});

test('currently working shift computes hours against now, not clock-out', () => {
  const now = new Date('2026-08-03T13:00:00Z');
  const shift = { clockInAt: '2026-08-03T09:00:00Z', clockOutAt: null, status: 'active' };
  const r = computeAttendance({ shift, now });
  assert.equal(r.currentlyWorking, true);
  assert.equal(r.totalHours, 4);
  assert.equal(r.lateClockOut, false); // no clock-out yet, never flagged late
});

// computeTimesheetDay — the Timesheets tab's per-day math (multiple shifts/day).

test('sums multiple shifts in one day and flags overtime against the baseline', () => {
  const shifts = [
    { clockInAt: '2026-08-03T09:00:00Z', clockOutAt: '2026-08-03T12:00:00Z', breakSeconds: 0 },
    { clockInAt: '2026-08-03T13:00:00Z', clockOutAt: '2026-08-03T18:00:00Z', breakSeconds: 0 },
  ];
  const r = computeTimesheetDay({ shifts, defaultShift: { expectedStartTime: '09:00:00', expectedEndTime: '17:00:00' } });
  assert.equal(r.totalHours, 8);
  assert.equal(r.overtimeHours, 0);
});

test('no baseline → zero overtime, still totals hours', () => {
  const shifts = [{ clockInAt: '2026-08-03T09:00:00Z', clockOutAt: '2026-08-03T17:00:00Z', breakSeconds: 0 }];
  const r = computeTimesheetDay({ shifts, defaultShift: null });
  assert.equal(r.totalHours, 8);
  assert.equal(r.overtimeHours, 0);
});

test('no shifts that day → zero hours', () => {
  const r = computeTimesheetDay({ shifts: [], defaultShift: null });
  assert.equal(r.totalHours, 0);
  assert.equal(r.overtimeHours, 0);
});

// Open-shift accrual cap — a forgotten clock-out used to grow against now()
// forever and land in the weekly total and the payroll CSV (96h by Friday).

test('an open shift stops accruing after 24 hours', () => {
  const clockInAt = new Date('2026-08-03T09:00:00Z').toISOString();
  const now = new Date('2026-08-07T09:00:00Z'); // four days later
  const r = computeTimesheetDay({ shifts: [{ clockInAt, clockOutAt: null, breakSeconds: 0 }], defaultShift: null, now });
  assert.equal(r.totalHours, 24);
  assert.equal(r.unclosed, true);
});

test('a still-running shift inside 24h still accrues live', () => {
  const shift = { clockInAt: '2026-08-03T09:00:00Z', clockOutAt: null, status: 'active' };
  const r = computeAttendance({ shift, now: new Date('2026-08-03T13:00:00Z') });
  assert.equal(r.totalHours, 4);
});

test('a closed day is never flagged unclosed', () => {
  const shifts = [{ clockInAt: '2026-08-03T09:00:00Z', clockOutAt: '2026-08-03T17:00:00Z', breakSeconds: 0 }];
  assert.equal(computeTimesheetDay({ shifts, defaultShift: null }).unclosed, false);
});

// Overnight templates (end time at or before start — a 17:00–01:00 night).
// The expected duration used to clamp to 0, so a normal 8h night billed as 8h
// of overtime, and every pre-midnight clock-out beat the 01:00 end time.

test('an overnight shift worked in full is not overtime', () => {
  const defaultShift = { expectedStartTime: '17:00:00', expectedEndTime: '01:00:00' };
  const shift = { clockInAt: '2026-08-03T17:00:00Z', clockOutAt: '2026-08-04T01:00:00Z', status: 'completed' };
  const r = computeAttendance({ shift, defaultShift });
  assert.equal(r.totalHours, 8);
  assert.equal(r.overtimeHours, 0);
  assert.equal(r.lateClockOut, false);
});

test('leaving an overnight shift early is not a late clock-out', () => {
  const defaultShift = { expectedStartTime: '17:00:00', expectedEndTime: '01:00:00' };
  const shift = { clockInAt: '2026-08-03T17:00:00Z', clockOutAt: '2026-08-03T23:00:00Z', status: 'completed' };
  assert.equal(computeAttendance({ shift, defaultShift }).lateClockOut, false);
});

test('staying past an overnight shift’s end is still flagged and counted', () => {
  const defaultShift = { expectedStartTime: '17:00:00', expectedEndTime: '01:00:00' };
  const shift = { clockInAt: '2026-08-03T17:00:00Z', clockOutAt: '2026-08-04T01:30:00Z', status: 'completed' };
  const r = computeAttendance({ shift, defaultShift });
  assert.equal(r.lateClockOut, true);
  assert.equal(r.overtimeHours, 0.5);
});

test('a same-day shift keeps the plain late-clock-out comparison', () => {
  const defaultShift = { expectedStartTime: '09:00:00', expectedEndTime: '17:00:00' };
  const late = { clockInAt: '2026-08-03T09:00:00Z', clockOutAt: '2026-08-03T18:00:00Z', status: 'completed' };
  const onTime = { clockInAt: '2026-08-03T09:00:00Z', clockOutAt: '2026-08-03T16:30:00Z', status: 'completed' };
  assert.equal(computeAttendance({ shift: late, defaultShift }).lateClockOut, true);
  assert.equal(computeAttendance({ shift: onTime, defaultShift }).lateClockOut, false);
});

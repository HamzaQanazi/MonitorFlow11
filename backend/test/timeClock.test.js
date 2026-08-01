const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateManualShift, computeAttendance, computeTimesheetDay } = require('../src/lib/timeClock');

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

// computeAttendance — the Today tab's per-employee math.

test('no shift, a schedule entry exists for the date → absent', () => {
  const defaultShift = { expectedStartTime: '09:00:00', expectedEndTime: '17:00:00' };
  const r = computeAttendance({ shift: null, defaultShift });
  assert.equal(r.absent, true);
  assert.equal(r.totalHours, null);
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

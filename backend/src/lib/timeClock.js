// Pure validation for the one piece of Time Clock logic worth a unit test
// without a DB: a manually-entered shift's time bounds (§14-style branch
// coverage). Route-level DB glue (routes/timeclock.js) follows the same
// thin-wrapper pattern as reports.js/tasks.js and isn't unit tested directly.
function validateManualShift({ clockInAt, clockOutAt }) {
  const errors = {};
  const inDate = new Date(clockInAt);
  const outDate = new Date(clockOutAt);
  if (!clockInAt || Number.isNaN(inDate.getTime())) errors.clockInAt = 'A valid clock-in time is required';
  if (!clockOutAt || Number.isNaN(outDate.getTime())) errors.clockOutAt = 'A valid clock-out time is required';
  if (!errors.clockInAt && !errors.clockOutAt) {
    if (outDate <= inDate) errors.clockOutAt = 'Clock-out must be after clock-in';
    else if (outDate.getTime() > Date.now()) errors.clockOutAt = 'Clock-out cannot be in the future';
    else if (outDate - inDate > 24 * 60 * 60 * 1000) errors.clockOutAt = 'A single shift cannot exceed 24 hours';
  }
  return Object.keys(errors).length ? errors : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// pg returns TIME columns as 'HH:MM:SS' strings.
function timeStringToSeconds(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

// UTC time-of-day, matching the server's now()-stamped clock_in_at/clock_out_at.
function timeOfDaySeconds(date) {
  return date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
}

// ponytail: overnight shifts (expectedEndTime < expectedStartTime) aren't
// modeled — clamped to 0 expected seconds. Add wraparound if a company needs it.
function expectedSecondsFromDefault(defaultShift) {
  if (!defaultShift?.expectedStartTime || !defaultShift?.expectedEndTime) return null;
  return Math.max(
    0,
    timeStringToSeconds(defaultShift.expectedEndTime) - timeStringToSeconds(defaultShift.expectedStartTime)
  );
}

// Today-tab attendance for one employee: at most one (the most recent) shift
// on the given date, plus their default-shift baseline for late/overtime. No
// baseline set → absent is never flagged and late/overtime stay null (§9's
// "record-only until a manager configures it" shape, same as feature flags).
function computeAttendance({ shift, breakSeconds = 0, defaultShift, date, now = new Date() }) {
  const isExpectedDay = !!defaultShift?.expectedDays?.includes(date.getUTCDay());

  if (!shift) {
    return {
      totalHours: null,
      overtimeHours: null,
      lateClockIn: false,
      lateClockOut: false,
      absent: isExpectedDay,
      currentlyWorking: false,
    };
  }

  const clockInAt = new Date(shift.clockInAt);
  const clockOutAt = shift.clockOutAt ? new Date(shift.clockOutAt) : null;
  const workedSeconds = Math.max(0, (clockOutAt || now) - clockInAt) / 1000 - breakSeconds;
  const totalHours = round2(Math.max(0, workedSeconds) / 3600);

  const expectedSeconds = expectedSecondsFromDefault(defaultShift);
  return {
    totalHours,
    overtimeHours: expectedSeconds == null ? null : round2(Math.max(0, workedSeconds - expectedSeconds) / 3600),
    lateClockIn: !!defaultShift?.expectedStartTime && timeOfDaySeconds(clockInAt) > timeStringToSeconds(defaultShift.expectedStartTime),
    lateClockOut:
      !!clockOutAt &&
      !!defaultShift?.expectedEndTime &&
      timeOfDaySeconds(clockOutAt) > timeStringToSeconds(defaultShift.expectedEndTime),
    absent: false,
    currentlyWorking: shift.status === 'active',
  };
}

// Timesheet-tab total for one employee/day: sums every shift that landed
// that day (a manual entry and a clocked shift can coexist) rather than
// picking one, unlike computeAttendance's "most recent shift" Today view.
function computeTimesheetDay({ shifts, defaultShift, now = new Date() }) {
  let workedSeconds = 0;
  for (const s of shifts) {
    const start = new Date(s.clockInAt);
    const end = s.clockOutAt ? new Date(s.clockOutAt) : now;
    workedSeconds += Math.max(0, (end - start) / 1000 - (s.breakSeconds || 0));
  }
  const expectedSeconds = expectedSecondsFromDefault(defaultShift);
  return {
    totalHours: round2(workedSeconds / 3600),
    overtimeHours: expectedSeconds == null ? 0 : round2(Math.max(0, workedSeconds - expectedSeconds) / 3600),
  };
}

module.exports = { validateManualShift, computeAttendance, computeTimesheetDay, round2 };

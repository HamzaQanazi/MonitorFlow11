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

// Same lat/lng bounds as the dynamic form engine's `location` field type
// (validateFormResponse.js) for one consistent contract.
function isValidLatLng(location) {
  if (!location || typeof location !== 'object') return false;
  const keysOk = Object.keys(location).length === 2 && 'lat' in location && 'lng' in location;
  const latOk = keysOk && typeof location.lat === 'number' && Number.isFinite(location.lat)
    && location.lat >= -90 && location.lat <= 90;
  const lngOk = keysOk && typeof location.lng === 'number' && Number.isFinite(location.lng)
    && location.lng >= -180 && location.lng <= 180;
  return latOk && lngOk;
}

// Clock-in requires a one-shot device location fix (mandatory, I10-scoped —
// see 026_time_shift_location.sql's header). The coordinate itself is now
// also stored (028_time_shift_clock_coordinates.sql) for the manager view.
function validateClockInLocation(location) {
  if (location === undefined || location === null || typeof location !== 'object') {
    return { location: 'A device location is required to clock in' };
  }
  if (!isValidLatLng(location)) {
    return { location: 'location must be {lat, lng} with lat in [-90,90] and lng in [-180,180]' };
  }
  return null;
}

// Clock-out's location is best-effort (028_time_shift_clock_coordinates.sql):
// unlike clock-in, a missing/failed device fix never blocks the action — a
// field employee without a signal can still clock out. Only the shape gets
// checked when a location IS provided; absent/null just means "not captured".
function validateOptionalLocation(location) {
  if (location === undefined || location === null) return null;
  if (!isValidLatLng(location)) {
    return { location: 'location must be {lat, lng} with lat in [-90,90] and lng in [-180,180]' };
  }
  return null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// pg returns TIME columns as 'HH:MM:SS' strings.
function timeStringToSeconds(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

// The company's wall-clock timezone. shift_template.start_time/end_time are
// typed by a manager as local wall clock (<input type="time">), so lateness
// has to be judged in that same zone — comparing against a UTC time-of-day
// under-reported it by the whole UTC offset (on a UTC+3 deployment nobody was
// "late" until 12:00 local). Defaults to UTC, which is exactly the old
// behaviour, so an unset env changes nothing.
// ponytail: one zone per deployment (one company per deployment, §13) — set
// COMPANY_TZ in .env. Per-branch zones would need a real column on `branch`.
const COMPANY_TZ = process.env.COMPANY_TZ || 'UTC';

// Intl over a hand-rolled offset: it handles DST, which a fixed number can't.
const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: COMPANY_TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: COMPANY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Time-of-day in the company's zone, as seconds past its local midnight.
function timeOfDaySeconds(date) {
  const [h, m, sec] = TIME_FMT.format(date).split(':').map(Number);
  // %24: some ICU builds render local midnight as hour 24 under hour12:false.
  return (h % 24) * 3600 + m * 60 + sec;
}

// The calendar date (YYYY-MM-DD) an instant falls on in the company's zone —
// the same bucketing the /today and /timesheets SQL applies with AT TIME ZONE.
function companyDate(date) {
  return DATE_FMT.format(date);
}

// Which column of the weekly grid an instant belongs to, bucketed by the
// company's calendar day rather than UTC's (a 01:00 local shift is the
// previous UTC day and was landing in the wrong column).
function companyDayIndex(weekStart, instant) {
  const day = Date.parse(`${companyDate(new Date(instant))}T00:00:00Z`);
  return Math.round((day - Date.parse(`${weekStart}T00:00:00Z`)) / 86400000);
}

// A shift left open (employee forgot to clock out) would otherwise accrue
// against now() forever — four days later it read as 96 worked hours, in the
// weekly total and in the payroll CSV. Cap its accrual at the same 24h bound
// validateManualShift already enforces; the day cell also carries `unclosed`
// so the manager can find it and correct the clock-out.
const MAX_OPEN_SHIFT_MS = 24 * 60 * 60 * 1000;

function shiftEnd(clockOutAt, clockInAt, now) {
  if (clockOutAt) return new Date(clockOutAt);
  return new Date(Math.min(now.getTime(), new Date(clockInAt).getTime() + MAX_OPEN_SHIFT_MS));
}

// A template whose end time is at or before its start crosses midnight (a
// 17:00–01:00 night shift). It used to clamp to 0 expected seconds, which
// billed the entire shift as overtime — an 8h night read as 8h of overtime.
function isOvernight(defaultShift) {
  return timeStringToSeconds(defaultShift.expectedEndTime) <= timeStringToSeconds(defaultShift.expectedStartTime);
}

function expectedSecondsFromDefault(defaultShift) {
  if (!defaultShift?.expectedStartTime || !defaultShift?.expectedEndTime) return null;
  const start = timeStringToSeconds(defaultShift.expectedStartTime);
  const end = timeStringToSeconds(defaultShift.expectedEndTime);
  return end > start ? end - start : end + 86400 - start;
}

// Did this clock-out land after the shift's end time? The plain comparison
// holds for a same-day shift. For an overnight one the end time is a small
// number (01:00) and every pre-midnight clock-out beats it, so leaving two
// hours EARLY got flagged late — restrict the late window to the stretch
// between the end time and the next shift's start.
// ponytail: a clock-in far enough past the start to wrap the ring is still
// not flagged (either shape) — model the shift as an interval, not two
// times, if that case ever matters.
function isLateAgainst(tod, defaultShift, boundaryTime) {
  const boundary = timeStringToSeconds(boundaryTime);
  if (!isOvernight(defaultShift)) return tod > boundary;
  return tod > boundary && tod < timeStringToSeconds(defaultShift.expectedStartTime);
}

// Has the employee's scheduled start time arrived yet on `date`? A past date
// is always "passed" (they never showed); a future one never is. `date` is the
// grid's day as YYYY-MM-DD; it defaults to the company's today, the only date
// the Today tab requests unless the manager picks another.
function scheduledStartPassed(date, defaultShift, now) {
  const today = companyDate(now);
  const day = date || today;
  if (day !== today) return day < today;
  if (!defaultShift.expectedStartTime) return true;
  return timeOfDaySeconds(now) >= timeStringToSeconds(defaultShift.expectedStartTime);
}

// Today-tab attendance for one employee: at most one (the most recent) shift
// on the given date, plus that date's schedule_entry baseline for late/overtime
// (defaultShift is already resolved per-date by the caller). No schedule entry
// for the date → absent is never flagged and late/overtime stay null (§9's
// "record-only until a manager configures it" shape, same as feature flags).
function computeAttendance({ shift, breakSeconds = 0, defaultShift, date, now = new Date() }) {
  if (!shift) {
    return {
      totalHours: null,
      overtimeHours: null,
      lateClockIn: false,
      lateClockOut: false,
      // Absent only once the scheduled start has actually passed — a 09:00
      // shift shouldn't count someone absent at 08:00, which made the
      // Absences counter show the whole scheduled team every morning.
      absent: !!defaultShift && scheduledStartPassed(date, defaultShift, now),
      currentlyWorking: false,
    };
  }

  const clockInAt = new Date(shift.clockInAt);
  const clockOutAt = shift.clockOutAt ? new Date(shift.clockOutAt) : null;
  const workedSeconds = Math.max(0, shiftEnd(shift.clockOutAt, shift.clockInAt, now) - clockInAt) / 1000 - breakSeconds;
  const totalHours = round2(Math.max(0, workedSeconds) / 3600);

  const expectedSeconds = expectedSecondsFromDefault(defaultShift);
  return {
    totalHours,
    overtimeHours: expectedSeconds == null ? null : round2(Math.max(0, workedSeconds - expectedSeconds) / 3600),
    lateClockIn: !!defaultShift?.expectedStartTime && timeOfDaySeconds(clockInAt) > timeStringToSeconds(defaultShift.expectedStartTime),
    lateClockOut:
      !!clockOutAt &&
      !!defaultShift?.expectedEndTime &&
      !!defaultShift?.expectedStartTime &&
      isLateAgainst(timeOfDaySeconds(clockOutAt), defaultShift, defaultShift.expectedEndTime),
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
    const end = shiftEnd(s.clockOutAt, s.clockInAt, now);
    workedSeconds += Math.max(0, (end - start) / 1000 - (s.breakSeconds || 0));
  }
  const expectedSeconds = expectedSecondsFromDefault(defaultShift);
  return {
    totalHours: round2(workedSeconds / 3600),
    overtimeHours: expectedSeconds == null ? 0 : round2(Math.max(0, workedSeconds - expectedSeconds) / 3600),
    // Flags the day cell so a forgotten clock-out is visible as a correction
    // to make, not just a capped number.
    unclosed: shifts.some((s) => !s.clockOutAt),
  };
}

module.exports = {
  COMPANY_TZ,
  companyDate,
  companyDayIndex,
  validateManualShift,
  validateClockInLocation,
  validateOptionalLocation,
  computeAttendance,
  computeTimesheetDay,
  round2,
};

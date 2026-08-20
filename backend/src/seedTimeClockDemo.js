// Demo data for the clock-in/clock-out location feature (028_time_shift_
// clock_coordinates.sql) — a handful of past `clock`-sourced shifts with
// varied locations so the Time Clock Today tab and Timesheets grid have
// something to look at without manually clocking in/out for days. Follows
// seedChecklists.js's shape: a standalone, re-runnable script, not ad-hoc SQL
// dropped into a session (CLAUDE.md §16). Only touches past days — never
// today, so a fresh live clock-in/out on the seeded employees still works.
//
//   cd backend && node src/seedTimeClockDemo.js
require('dotenv').config();
const pool = require('./db');

// Same city RequestsMapView already centers on (NABLUS) — a real office
// point plus one clearly-different "field site" point a few km away, so the
// clock-in vs. clock-out pins visibly differ on the map.
const OFFICE = { lat: 32.2211, lng: 35.2544 };
const FIELD_SITE = { lat: 32.235, lng: 35.27 };

function daysAgo(n, hour, minute = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

// One row per demo shift. `clockOut: null` models a best-effort miss (the
// coordinate legitimately absent, not an error — see validateOptionalLocation).
function shiftsFor(employeeId) {
  return [
    { clockIn: daysAgo(3, 9, 2), clockOut: daysAgo(3, 17, 5), clockInLoc: OFFICE, clockOutLoc: OFFICE },
    { clockIn: daysAgo(2, 8, 55), clockOut: daysAgo(2, 16, 40), clockInLoc: OFFICE, clockOutLoc: FIELD_SITE },
    { clockIn: daysAgo(1, 9, 10), clockOut: daysAgo(1, 17, 20), clockInLoc: FIELD_SITE, clockOutLoc: null },
  ].map((s) => ({ ...s, employeeId }));
}

async function seedEmployeeShifts(companyId, employeeId, name) {
  let created = 0;
  for (const s of shiftsFor(employeeId)) {
    // Idempotent — skip a shift that already starts at this exact timestamp
    // for this employee (re-running the script twice shouldn't double it up).
    // eslint-disable-next-line no-await-in-loop
    const { rows: existing } = await pool.query(
      `SELECT id FROM time_shift WHERE employee_id = $1 AND clock_in_at = $2`,
      [s.employeeId, s.clockIn]
    );
    if (existing.length) continue;

    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `INSERT INTO time_shift
         (employee_id, company_id, clock_in_at, clock_out_at, source, status, approval_status,
          location_captured, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng)
       VALUES ($1, $2, $3, $4, 'clock', 'completed', 'approved',
               true, $5, $6, $7, $8)`,
      [
        s.employeeId,
        companyId,
        s.clockIn,
        s.clockOut,
        s.clockInLoc.lat,
        s.clockInLoc.lng,
        s.clockOutLoc ? s.clockOutLoc.lat : null,
        s.clockOutLoc ? s.clockOutLoc.lng : null,
      ]
    );
    created += 1;
  }
  console.log(`${name}: created ${created} demo shift(s).`);
}

async function main() {
  try {
    const { rows: co } = await pool.query('SELECT id FROM company LIMIT 1');
    if (!co.length) throw new Error('No company exists yet — complete onboarding first.');

    const { rows: employees } = await pool.query(
      `SELECT id, name FROM users WHERE role = 'employee' AND is_active ORDER BY id LIMIT 5`
    );
    if (!employees.length) {
      throw new Error('No active employees exist yet — hire at least one, then re-run.');
    }

    for (const emp of employees) {
      // eslint-disable-next-line no-await-in-loop
      await seedEmployeeShifts(co[0].id, emp.id, emp.name);
    }
  } catch (err) {
    console.error(`seedTimeClockDemo failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();

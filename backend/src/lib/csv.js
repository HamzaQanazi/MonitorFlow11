// Shared CSV cell guard (Section 7): a leading =, +, -, or @ makes a
// spreadsheet treat the cell as a formula; prefix with ' to neutralize, then
// apply normal CSV quoting. Used by every CSV export (reports, timesheets).
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

module.exports = { csvCell };

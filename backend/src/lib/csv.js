// Shared CSV cell guard (Section 7): a leading =, +, -, or @ makes a
// spreadsheet treat the cell as a formula; prefix with ' to neutralize, then
// apply normal CSV quoting. Used by every CSV export (reports, timesheets).
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

// Minimal RFC4180-ish CSV parsing for bulk employee import (routes/employees.js
// POST /employees/import). No external dependency — quoted fields, escaped ""
// inside quotes, and CRLF/LF line endings are all this needs; a full parser
// library would be more code to reason about for one call site, not less.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      pushField();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) pushRow();
  // A trailing newline produces one empty row — drop it, not a real data row.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Rows → objects keyed by lowercased/trimmed header (order-independent
// columns). Empty input or a header-only file returns [].
function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
}

module.exports = { csvCell, parseCsv, csvToObjects };

/**
 * Minimal RFC-4180 CSV parser for the product import (spec §3.2).
 *
 * Handles the subset we accept: comma-separated fields, `"` quoted fields
 * with `""` escapes, LF/CRLF row endings, a leading UTF-8 BOM, and a trailing
 * empty line. No dependency — the file caps are enforced by the importer
 * before this ever runs, so inputs stay small.
 */

export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let fieldStarted = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStarted = false;
    } else if (ch !== "\r") {
      field += ch;
      fieldStarted = true;
    }
  }
  if (fieldStarted || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Maps parsed rows to objects using the header row; 1-based `line` = the source line in the file. */
export function csvRecords(
  rows: string[][],
):
  | { header: string[]; records: { line: number; record: Record<string, string> }[] }
  | { error: string } {
  const headerRow = rows[0];
  if (!headerRow || headerRow.length === 0) {
    return { error: "The file is empty." };
  }
  const header = headerRow.map((column) => column.trim().toLowerCase());
  if (header.some((column) => column.length === 0)) {
    return { error: "The header row contains an empty column name." };
  }
  const records = rows.slice(1).map((cells, index) => {
    const record: Record<string, string> = {};
    header.forEach((column, columnIndex) => {
      record[column] = (cells[columnIndex] ?? "").trim();
    });
    return { line: index + 2, record };
  });
  return { header, records };
}

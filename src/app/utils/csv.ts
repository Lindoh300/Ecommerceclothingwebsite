/**
 * One CSV cell. A value that starts with =, +, - or @ (or a tab or carriage return) would be run as a formula by a
 * spreadsheet, so it gets a leading apostrophe, which makes the spreadsheet read it as text. The cell is then always
 * quoted, with quotes doubled, so commas and line breaks are safe.
 */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Rows to CSV text with CRLF line ends and a byte-order mark, so Excel reads the UTF-8 right. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | null | undefined>>): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

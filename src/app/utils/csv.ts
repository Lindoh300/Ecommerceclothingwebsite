// A phone number such as +27 82 123 4567: a plus sign, then only digits, spaces, brackets and hyphens.
const PHONE_NUMBER = /^\+[\d\s()-]+$/;

/**
 * One CSV cell. A value that starts with =, +, - or @ (or a tab or carriage return, after any leading spaces) would be
 * run as a formula by a spreadsheet, so it gets a leading apostrophe, which makes the spreadsheet read it as text. A
 * whole value that is a phone number (+ then digits, spaces, brackets and hyphens) is not a formula and is left alone.
 * The cell is then always quoted, with quotes doubled, so commas and line breaks are safe.
 */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? "";
  if (!PHONE_NUMBER.test(text) && /^\s*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Rows to CSV text with CRLF line ends and a byte-order mark, so Excel reads the UTF-8 right. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | null | undefined>>): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

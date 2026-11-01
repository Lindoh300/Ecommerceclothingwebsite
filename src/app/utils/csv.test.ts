import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from './csv'

const BOM = '﻿'

describe('csvCell', () => {
  it('always wraps a plain value in double quotes', () => {
    expect(csvCell('Thandi')).toBe('"Thandi"')
  })

  it('returns an empty quoted cell for an empty, null or undefined value', () => {
    expect(csvCell('')).toBe('""')
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
  })

  it('keeps commas inside the quotes', () => {
    expect(csvCell('Dlamini, Thandi')).toBe('"Dlamini, Thandi"')
  })

  it('doubles double quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('keeps a newline inside the quotes', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
  })

  it('keeps a CRLF inside the quotes', () => {
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"')
  })

  it('leaves an apostrophe and a plain equals sign in the middle alone', () => {
    expect(csvCell("O'Brien")).toBe('"O\'Brien"')
    expect(csvCell('a=b')).toBe('"a=b"')
  })

  it.each([
    ['=', '=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['+', '+cmd|calc', "'+cmd|calc"],
    ['-', '-5', "'-5"],
    ['@', '@cmd', "'@cmd"],
    ['tab', '\t=cmd', "'\t=cmd"],
    ['carriage return', '\r=cmd', "'\r=cmd"],
  ])('guards a value starting with %s against formula injection', (_name, input, guarded) => {
    expect(csvCell(input)).toBe(`"${guarded}"`)
  })

  it('leaves a phone number with a plus sign unguarded', () => {
    expect(csvCell('+27 82 123 4567')).toBe('"+27 82 123 4567"')
    expect(csvCell('+27 (0) 82-123-4567')).toBe('"+27 (0) 82-123-4567"')
    expect(csvCell('+447700900123')).toBe('"+447700900123"')
  })

  it('guards a formula that starts after leading spaces', () => {
    expect(csvCell(' =cmd')).toBe('"\' =cmd"')
    expect(csvCell('  +cmd|calc')).toBe('"\'  +cmd|calc"')
  })

  it('guards and escapes together for a formula that also has quotes', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"')
  })
})

describe('toCsv', () => {
  it('starts with a byte-order mark and ends with CRLF', () => {
    const csv = toCsv([['Name'], ['Thandi']])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('writes the header and rows with CRLF line ends', () => {
    expect(toCsv([['Name', 'Email'], ['Thandi', 't@example.com']])).toBe(
      `${BOM}"Name","Email"\r\n"Thandi","t@example.com"\r\n`,
    )
  })

  it('writes null and undefined cells as empty quoted cells', () => {
    expect(toCsv([['a', null, undefined, 'b']])).toBe(`${BOM}"a","","","b"\r\n`)
  })

  it('escapes commas, quotes and newlines in the rows', () => {
    expect(toCsv([['Dlamini, "T"', 'x\ny']])).toBe(`${BOM}"Dlamini, ""T""","x\ny"\r\n`)
  })

  it('guards a formula cell in a row', () => {
    expect(toCsv([['=1+1', 'ok']])).toBe(`${BOM}"'=1+1","ok"\r\n`)
  })

  it('returns only the mark and a line end for no rows', () => {
    expect(toCsv([])).toBe(`${BOM}\r\n`)
  })
})

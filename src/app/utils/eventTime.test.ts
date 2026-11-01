import { afterEach, describe, expect, it } from 'vitest'
import { daysUntil, eventDateTag, formatClock, formatEventDay, formatEventDate, formatPrice, inputToIso, isoToInput } from './eventTime'

const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe('formatEventDate', () => {
  it('shows a UTC time in South African time (UTC+2)', () => {
    expect(formatEventDate('2026-12-05T16:00:00.000Z')).toBe('Sat 5 Dec 2026, 18:00')
  })

  it('pads the hour and minute to two digits', () => {
    expect(formatEventDate('2026-07-04T05:05:00Z')).toBe('Sat 4 Jul 2026, 07:05')
  })

  it('moves to 1 January when 22:30 UTC on 31 December falls after midnight in South Africa', () => {
    expect(formatEventDate('2026-12-31T22:30:00Z')).toBe('Fri 1 Jan 2027, 00:30')
  })

  it('stays on 31 December at 23:59 just before the change', () => {
    expect(formatEventDate('2026-12-31T21:59:00Z')).toBe('Thu 31 Dec 2026, 23:59')
  })

  it('shows exactly midnight on 1 January at the change', () => {
    expect(formatEventDate('2026-12-31T22:00:00Z')).toBe('Fri 1 Jan 2027, 00:00')
  })

  it('moves to 1 March from the last hour of February', () => {
    expect(formatEventDate('2026-02-28T23:00:00Z')).toBe('Sun 1 Mar 2026, 01:00')
  })

  it('converts an ISO time that has its own offset', () => {
    expect(formatEventDate('2026-12-05T13:00:00-03:00')).toBe('Sat 5 Dec 2026, 18:00')
  })

  it('returns an empty string for a bad or empty date', () => {
    expect(formatEventDate('not a date')).toBe('')
    expect(formatEventDate('')).toBe('')
  })
})

describe('formatClock', () => {
  it('shows the South African clock time', () => {
    expect(formatClock('2026-12-05T16:00:00.000Z')).toBe('18:00')
    expect(formatClock('2026-07-04T05:05:00Z')).toBe('07:05')
  })

  it('shows 00:30 for 22:30 UTC on 31 December', () => {
    expect(formatClock('2026-12-31T22:30:00Z')).toBe('00:30')
  })

  it('returns an empty string for a bad or empty date', () => {
    expect(formatClock('not a date')).toBe('')
    expect(formatClock('')).toBe('')
  })
})

describe('isoToInput', () => {
  it('gives the datetime-local value in South African time', () => {
    expect(isoToInput('2026-12-05T16:00:00.000Z')).toBe('2026-12-05T18:00')
  })

  it('gives the next year when the time is after midnight in South Africa', () => {
    expect(isoToInput('2026-12-31T22:30:00.000Z')).toBe('2027-01-01T00:30')
  })

  it('drops the seconds and milliseconds', () => {
    expect(isoToInput('2026-12-05T16:00:30.500Z')).toBe('2026-12-05T18:00')
  })

  it('returns an empty string for null, undefined, empty or bad input', () => {
    expect(isoToInput(null)).toBe('')
    expect(isoToInput(undefined)).toBe('')
    expect(isoToInput('')).toBe('')
    expect(isoToInput('not a date')).toBe('')
  })
})

describe('inputToIso', () => {
  it('reads the value as South African time and returns UTC', () => {
    expect(inputToIso('2026-12-05T18:00')).toBe('2026-12-05T16:00:00.000Z')
  })

  it('goes back to the previous year for 1 January at 00:30', () => {
    expect(inputToIso('2027-01-01T00:30')).toBe('2026-12-31T22:30:00.000Z')
  })

  it('goes back to the previous month for 1 December at 00:30', () => {
    expect(inputToIso('2026-12-01T00:30')).toBe('2026-11-30T22:30:00.000Z')
  })

  it('ignores spaces around the value', () => {
    expect(inputToIso('  2026-12-05T18:00 ')).toBe('2026-12-05T16:00:00.000Z')
  })

  it.each([
    ['an empty string', ''],
    ['only spaces', '   '],
    ['a space instead of T', '2026-12-05 18:00'],
    ['seconds', '2026-12-05T18:00:00'],
    ['a day-first date', '05/12/2026T18:00'],
    ['words', 'tomorrow evening'],
  ])('returns null for %s', (_label, value) => {
    expect(inputToIso(value)).toBeNull()
  })

  it('returns null for a day that does not exist, such as 30 February', () => {
    expect(inputToIso('2026-02-30T10:00')).toBeNull()
  })

  it('returns null for a month above 12', () => {
    expect(inputToIso('2026-13-05T10:00')).toBeNull()
  })
})

describe('round trips between input values and ISO times', () => {
  const isoTimes = [
    '2026-12-05T16:00:00.000Z',
    '2026-12-31T22:30:00.000Z',
    '2026-02-28T23:59:00.000Z',
    '2026-06-15T07:45:00.000Z',
    '2026-01-01T00:00:00.000Z',
  ]

  it.each(isoTimes)('ISO to input and back gives the same ISO time: %s', (iso) => {
    expect(inputToIso(isoToInput(iso))).toBe(iso)
  })

  const inputs = ['2026-12-05T18:00', '2027-01-01T00:30', '2026-12-01T00:00', '2026-06-15T07:45']

  it.each(inputs)('input to ISO and back gives the same input value: %s', (value) => {
    expect(isoToInput(inputToIso(value) as string)).toBe(value)
  })

  it('loses the seconds, so an ISO time with seconds does not round-trip exactly', () => {
    expect(inputToIso(isoToInput('2026-12-05T16:00:30.000Z'))).toBe('2026-12-05T16:00:00.000Z')
  })
})

describe('device timezone', () => {
  // Each zone is set through process.env.TZ. The guard checks the device clock really moved, so the test cannot pass
  // by accident on a runner that ignores the change.
  const zones: [string, number][] = [
    ['America/New_York', 300],
    ['Asia/Kolkata', -330],
    ['Pacific/Kiritimati', -840],
  ]

  it.each(zones)('gives the same South African times when the device is in %s', (zone, offsetMinutes) => {
    process.env.TZ = zone
    expect(new Date('2026-12-05T16:00:00.000Z').getTimezoneOffset()).toBe(offsetMinutes)

    expect(formatEventDate('2026-12-05T16:00:00.000Z')).toBe('Sat 5 Dec 2026, 18:00')
    expect(formatClock('2026-12-31T22:30:00Z')).toBe('00:30')
    expect(isoToInput('2026-12-31T22:30:00.000Z')).toBe('2027-01-01T00:30')
    expect(inputToIso('2027-01-01T00:30')).toBe('2026-12-31T22:30:00.000Z')
  })
})

describe('formatPrice', () => {
  it('shows zero as Free', () => {
    expect(formatPrice(0)).toBe('Free')
  })

  it('drops the cents when they are .00', () => {
    expect(formatPrice(250)).toBe('R250')
    expect(formatPrice(1000)).toBe('R1000')
  })

  it('keeps two decimal places otherwise', () => {
    expect(formatPrice(250.5)).toBe('R250.50')
    expect(formatPrice(249.99)).toBe('R249.99')
    expect(formatPrice(0.5)).toBe('R0.50')
    expect(formatPrice(0.01)).toBe('R0.01')
  })

  it('rounds to the nearest cent', () => {
    expect(formatPrice(99.999)).toBe('R100')
  })

  it('does not add a thousands separator', () => {
    expect(formatPrice(1234.5)).toBe('R1234.50')
  })
})

describe('eventDateTag', () => {
  it('gives the South African day and year', () => {
    expect(eventDateTag('2026-12-05T16:00:00.000Z')).toEqual({ day: '5 Dec', year: '2026' })
  })

  it('rolls to the next South African day after 22:00 UTC', () => {
    expect(eventDateTag('2026-12-31T22:30:00.000Z')).toEqual({ day: '1 Jan', year: '2027' })
  })

  it('is empty for a bad date', () => {
    expect(eventDateTag('nope')).toEqual({ day: '', year: '' })
  })
})

describe('formatEventDay', () => {
  it('shows weekday, day, month and year', () => {
    expect(formatEventDay('2026-12-05T16:00:00.000Z')).toBe('Sat 5 Dec 2026')
  })

  it('uses the South African date near midnight UTC', () => {
    expect(formatEventDay('2026-12-05T22:00:00.000Z')).toBe('Sun 6 Dec 2026')
    expect(formatEventDay('2026-12-05T21:59:00.000Z')).toBe('Sat 5 Dec 2026')
  })

  it('is empty for a bad date', () => {
    expect(formatEventDay('')).toBe('')
  })
})

describe('daysUntil', () => {
  const event = '2026-12-05T16:00:00.000Z'

  it('is 0 on the same South African day', () => {
    expect(daysUntil(event, Date.parse('2026-12-05T00:00:00.000Z'))).toBe(0)
    expect(daysUntil(event, Date.parse('2026-12-04T22:00:00.000Z'))).toBe(0)
  })

  it('counts whole calendar days ahead and behind', () => {
    expect(daysUntil(event, Date.parse('2026-12-04T12:00:00.000Z'))).toBe(1)
    expect(daysUntil(event, Date.parse('2026-11-25T12:00:00.000Z'))).toBe(10)
    expect(daysUntil(event, Date.parse('2026-12-07T12:00:00.000Z'))).toBe(-2)
  })

  it('flips to the next day at 22:00 UTC, which is midnight in South Africa', () => {
    expect(daysUntil(event, Date.parse('2026-12-04T21:59:59.000Z'))).toBe(1)
    expect(daysUntil(event, Date.parse('2026-12-04T22:00:00.000Z'))).toBe(0)
    expect(daysUntil(event, Date.parse('2026-12-05T21:59:59.000Z'))).toBe(0)
    expect(daysUntil(event, Date.parse('2026-12-05T22:00:00.000Z'))).toBe(-1)
  })

  it('uses the South African date of the event too', () => {
    // 22:30 UTC on 4 Dec is 00:30 on 5 Dec in South Africa.
    expect(daysUntil('2026-12-04T22:30:00.000Z', Date.parse('2026-12-04T12:00:00.000Z'))).toBe(1)
  })
})

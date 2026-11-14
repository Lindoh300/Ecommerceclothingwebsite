// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminTicket } from '../api/types'
import {
  extractCode,
  loadDoorState,
  saveDoorState,
  scanLocally,
  summarise,
  toDoorTicket,
  upsertTicket,
  type DoorState,
  type DoorTicket,
} from './door'

const CODE_A = 'abcdef0123456789'
const CODE_B = 'zyxwvu9876543210'
const CHECK_IN_TIME = '2026-12-05T16:00:00.000Z'
const LATER_TIME = '2026-12-05T16:30:00.000Z'

function ticket(overrides: Partial<DoorTicket> = {}): DoorTicket {
  return {
    code: CODE_A,
    holderName: 'Thandi Nkosi',
    ticketTypeName: 'General',
    checkedInAt: null,
    voidedAt: null,
    ...overrides,
  }
}

function adminTicket(overrides: Partial<AdminTicket> = {}): AdminTicket {
  return {
    id: 't1',
    code: 'ABCDEF0123456789',
    groupId: 'g1',
    eventId: 'evt-1',
    eventTitle: 'Night Run',
    eventSlug: 'night-run',
    startsAt: '2026-12-05T16:00:00.000Z',
    venue: 'Hall',
    city: 'Cape Town',
    ticketTypeId: 'tt1',
    ticketTypeName: 'General',
    holderName: 'Thandi Nkosi',
    holderPhone: '+27821234567',
    holderEmail: 'thandi@example.test',
    source: 'issued',
    checkedInAt: null,
    voidedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  }
}

function doorState(overrides: Partial<DoorState> = {}): DoorState {
  return {
    tickets: [ticket()],
    queue: [],
    conflicts: [],
    savedAt: '2026-12-05T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('extractCode', () => {
  it('returns a bare code in lower case', () => {
    expect(extractCode('ABCDEF0123456789')).toBe('abcdef0123456789')
  })

  it('trims spaces and line breaks around a bare code', () => {
    expect(extractCode('  ABCDEF0123456789\r\n')).toBe('abcdef0123456789')
  })

  it('takes the code out of a full ticket URL', () => {
    expect(extractCode('https://example.test/ticket/ABCDEF0123456789')).toBe('abcdef0123456789')
  })

  it.each([
    ['a trailing slash', 'https://example.test/ticket/ABCDEF0123456789/'],
    ['a query string', 'https://example.test/ticket/ABCDEF0123456789?from=scan'],
    ['a hash', 'https://example.test/ticket/ABCDEF0123456789#top'],
  ])('takes the code out of a ticket URL with %s', (_label, url) => {
    expect(extractCode(url)).toBe('abcdef0123456789')
  })

  it('accepts codes of exactly 16 and 64 characters', () => {
    expect(extractCode('a'.repeat(16))).toBe('a'.repeat(16))
    expect(extractCode('B'.repeat(64))).toBe('b'.repeat(64))
  })

  it('rejects a bare code of 15 or 65 characters', () => {
    expect(extractCode('a'.repeat(15))).toBeNull()
    expect(extractCode('a'.repeat(65))).toBeNull()
  })

  it('rejects a ticket URL whose code is 65 characters', () => {
    expect(extractCode(`https://example.test/ticket/${'a'.repeat(65)}`)).toBeNull()
  })

  it('rejects a code with a character outside letters and digits', () => {
    expect(extractCode('ABCDEF-0123456789')).toBeNull()
  })

  it('rejects a ticket URL where the code is followed by other characters', () => {
    expect(extractCode('https://example.test/ticket/abcdef0123456789.png')).toBeNull()
  })

  it('rejects a path that is not the ticket path', () => {
    expect(extractCode('https://example.test/tickets/abcdef0123456789')).toBeNull()
  })

  it('returns null for empty, blank and unrelated input', () => {
    expect(extractCode('')).toBeNull()
    expect(extractCode('   ')).toBeNull()
    expect(extractCode('https://example.test/ticket/')).toBeNull()
    expect(extractCode('hello world')).toBeNull()
  })
})

describe('toDoorTicket', () => {
  it('keeps only the door fields and lower-cases the code', () => {
    expect(toDoorTicket(adminTicket())).toEqual({
      code: 'abcdef0123456789',
      holderName: 'Thandi Nkosi',
      ticketTypeName: 'General',
      checkedInAt: null,
      voidedAt: null,
    })
  })

  it('carries over the check-in and void times', () => {
    const result = toDoorTicket(adminTicket({ checkedInAt: CHECK_IN_TIME, voidedAt: LATER_TIME }))
    expect(result.checkedInAt).toBe(CHECK_IN_TIME)
    expect(result.voidedAt).toBe(LATER_TIME)
  })

  it('holds no phone number or email, even though the admin ticket has them', () => {
    const result = toDoorTicket(adminTicket())
    expect(Object.keys(result).sort()).toEqual(['checkedInAt', 'code', 'holderName', 'ticketTypeName', 'voidedAt'])
    const text = JSON.stringify(result)
    expect(text).not.toContain('+27821234567')
    expect(text).not.toContain('thandi@example.test')
  })
})

describe('summarise', () => {
  it('counts nothing for an empty list', () => {
    expect(summarise([])).toEqual({ sold: 0, checkedIn: 0 })
  })

  it('leaves void tickets out of both counts', () => {
    const tickets = [
      ticket({ code: 'aaaaaaaaaaaaaaaa' }),
      ticket({ code: 'bbbbbbbbbbbbbbbb', checkedInAt: CHECK_IN_TIME }),
      ticket({ code: 'cccccccccccccccc', voidedAt: CHECK_IN_TIME }),
      ticket({ code: 'dddddddddddddddd', voidedAt: CHECK_IN_TIME, checkedInAt: CHECK_IN_TIME }),
    ]
    expect(summarise(tickets)).toEqual({ sold: 2, checkedIn: 1 })
  })
})

describe('scanLocally', () => {
  it('returns unknown, with the same list, for a code not on the list', () => {
    const tickets = [ticket()]
    const result = scanLocally(tickets, CODE_B, CHECK_IN_TIME)
    expect(result.result).toBe('unknown')
    expect(result.tickets).toBe(tickets)
  })

  it('marks a valid ticket as used at the given time, in a new list', () => {
    const tickets = [ticket(), ticket({ code: CODE_B, holderName: 'Sipho' })]
    const result = scanLocally(tickets, CODE_A, CHECK_IN_TIME)
    expect(result.result).toBe('ok')
    if (result.result === 'unknown') throw new Error('expected a match')
    expect(result.ticket.checkedInAt).toBe(CHECK_IN_TIME)
    expect(result.tickets[0].checkedInAt).toBe(CHECK_IN_TIME)
    expect(result.tickets[1]).toEqual(tickets[1])
    expect(tickets[0].checkedInAt).toBeNull()
  })

  it('reports a second scan of the same code as already used, with the first time', () => {
    const first = scanLocally([ticket()], CODE_A, CHECK_IN_TIME)
    if (first.result === 'unknown') throw new Error('expected a match')
    const second = scanLocally(first.tickets, CODE_A, LATER_TIME)
    expect(second.result).toBe('already')
    if (second.result === 'unknown') throw new Error('expected a match')
    expect(second.ticket.checkedInAt).toBe(CHECK_IN_TIME)
    expect(second.tickets).toEqual(first.tickets)
  })

  it('reports a void ticket as void and never marks it used', () => {
    const tickets = [ticket({ voidedAt: CHECK_IN_TIME })]
    const result = scanLocally(tickets, CODE_A, LATER_TIME)
    expect(result.result).toBe('void')
    expect(result.tickets).toBe(tickets)
    expect(result.tickets[0].checkedInAt).toBeNull()
  })

  it('reports void ahead of already-used when a ticket is both', () => {
    const result = scanLocally([ticket({ voidedAt: LATER_TIME, checkedInAt: CHECK_IN_TIME })], CODE_A, LATER_TIME)
    expect(result.result).toBe('void')
  })

  it('compares codes exactly, so the caller must pass the code from extractCode', () => {
    // scanLocally does not lower-case its input. AdminDoor always passes extractCode output, which is lower case.
    const result = scanLocally([ticket()], 'ABCDEF0123456789', CHECK_IN_TIME)
    expect(result.result).toBe('unknown')
  })

  it('keeps an offline check-in when the list is saved and loaded again', () => {
    const tickets = [ticket()]
    const offline = scanLocally(tickets, CODE_A, CHECK_IN_TIME)
    if (offline.result === 'unknown') throw new Error('expected a match')
    saveDoorState('evt-1', doorState({ tickets: offline.tickets, queue: [{ code: CODE_A, at: CHECK_IN_TIME }] }))

    const reloaded = loadDoorState('evt-1')
    expect(reloaded?.queue).toEqual([{ code: CODE_A, at: CHECK_IN_TIME }])
    const again = scanLocally(reloaded!.tickets, CODE_A, LATER_TIME)
    expect(again.result).toBe('already')
    if (again.result === 'unknown') throw new Error('expected a match')
    expect(again.ticket.checkedInAt).toBe(CHECK_IN_TIME)
  })
})

describe('upsertTicket', () => {
  it('adds a ticket whose code is not on the list, at the end', () => {
    const list = [ticket()]
    const result = upsertTicket(list, ticket({ code: CODE_B, holderName: 'Sipho' }))
    expect(result.map((t) => t.code)).toEqual([CODE_A, CODE_B])
    expect(list).toHaveLength(1)
  })

  it('replaces the ticket with the same code in place', () => {
    const list = [ticket({ code: CODE_B }), ticket({ code: CODE_A })]
    const result = upsertTicket(list, ticket({ code: CODE_A, checkedInAt: CHECK_IN_TIME }))
    expect(result).toHaveLength(2)
    expect(result[0].code).toBe(CODE_B)
    expect(result[1]).toEqual(ticket({ checkedInAt: CHECK_IN_TIME }))
    expect(list[1].checkedInAt).toBeNull()
  })
})

describe('loadDoorState and saveDoorState', () => {
  it('returns null when nothing is saved for the event', () => {
    expect(loadDoorState('evt-1')).toBeNull()
  })

  it('reads back the state it saved', () => {
    const state = doorState({
      tickets: [ticket({ checkedInAt: CHECK_IN_TIME }), ticket({ code: CODE_B, voidedAt: LATER_TIME })],
      queue: [{ code: CODE_A, at: CHECK_IN_TIME }],
      conflicts: [{ code: CODE_B, name: 'Sipho', scannedAt: CHECK_IN_TIME, reason: 'void', checkedInAt: null }],
    })
    expect(saveDoorState('evt-1', state)).toBe(true)
    expect(loadDoorState('evt-1')).toEqual(state)
  })

  it('keeps two events apart, under a key with the version and event id', () => {
    const first = doorState({ tickets: [ticket()] })
    const second = doorState({ tickets: [ticket({ code: CODE_B, holderName: 'Sipho' })] })
    saveDoorState('evt-1', first)
    saveDoorState('evt-2', second)

    expect(loadDoorState('evt-1')).toEqual(first)
    expect(loadDoorState('evt-2')).toEqual(second)
    expect(loadDoorState('evt-3')).toBeNull()
    expect(window.localStorage.getItem('door_state_v1_evt-1')).not.toBeNull()
  })

  it('does not throw on corrupt JSON and returns null', () => {
    window.localStorage.setItem('door_state_v1_evt-1', '{"tickets":')
    expect(() => loadDoorState('evt-1')).not.toThrow()
    expect(loadDoorState('evt-1')).toBeNull()
  })

  it.each([
    ['an empty string', ''],
    ['the JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a plain string', '"hello"'],
    ['tickets that are not an array', '{"tickets":"x","queue":[],"conflicts":[],"savedAt":"2026-12-05T10:00:00.000Z"}'],
    ['no savedAt', '{"tickets":[],"queue":[],"conflicts":[]}'],
  ])('returns null for stored data that is %s', (_label, text) => {
    window.localStorage.setItem('door_state_v1_evt-1', text)
    expect(loadDoorState('evt-1')).toBeNull()
  })

  it('returns null, without throwing, when reading storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    expect(loadDoorState('evt-1')).toBeNull()
  })

  it('returns false, without throwing, when storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(saveDoorState('evt-1', doorState())).toBe(false)
    expect(window.localStorage.getItem('door_state_v1_evt-1')).toBeNull()
  })

  it('stores no phone number or email from the admin ticket', () => {
    saveDoorState('evt-1', doorState({ tickets: [toDoorTicket(adminTicket())] }))
    const stored = window.localStorage.getItem('door_state_v1_evt-1') ?? ''
    expect(stored).toContain('Thandi Nkosi')
    expect(stored).not.toContain('+27821234567')
    expect(stored).not.toContain('thandi@example.test')
  })
})

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminCustomers, matchesCustomer } from './AdminCustomers'
import { listCustomers } from '../api/customersAdmin'
import type { CustomerSummary } from '../api/types'

vi.mock('../api/customersAdmin', () => ({
  listCustomers: vi.fn(),
}))

const thandi: CustomerSummary = {
  phone: '082 123 4567',
  name: 'Thandi Mokoena',
  email: 'thandi@example.com',
  orders: 1,
  spent: 250,
  lastOrderAt: '2026-10-30T10:00:00Z',
  subscribed: true,
}

const sipho: CustomerSummary = {
  phone: '+27 71 555 0199',
  name: 'Sipho Dlamini',
  email: null,
  orders: 2,
  spent: 1234.5,
  lastOrderAt: '2026-10-29T10:00:00Z',
  subscribed: false,
}

const unusable: CustomerSummary = {
  phone: '12',
  name: 'Lerato Ndlovu',
  email: null,
  orders: 3,
  spent: 0,
  lastOrderAt: '2026-10-28T10:00:00Z',
  subscribed: false,
}

beforeEach(() => {
  vi.mocked(listCustomers).mockResolvedValue([thandi, sipho])
})

describe('matchesCustomer', () => {
  const customer = thandi

  it('matches the name, ignoring case', () => {
    expect(matchesCustomer(customer, 'mokoe')).toBe(true)
    expect(matchesCustomer(customer, 'THANDI')).toBe(true)
    expect(matchesCustomer(customer, 'sipho')).toBe(false)
  })

  it('matches the email, ignoring case, and never matches a missing email', () => {
    expect(matchesCustomer(customer, 'EXAMPLE.com')).toBe(true)
    expect(matchesCustomer({ ...customer, email: null }, 'example')).toBe(false)
  })

  it('matches the phone on digits, so spaces in either side do not matter', () => {
    expect(matchesCustomer(customer, '082 123')).toBe(true)
    expect(matchesCustomer(customer, '0821234567')).toBe(true)
    expect(matchesCustomer(customer, '082 999')).toBe(false)
  })

  it('matches a +27 search against a stored +27 number', () => {
    const international = { ...customer, phone: '+27 82 123 4567' }
    expect(matchesCustomer(international, '+27 82')).toBe(true)
    expect(matchesCustomer(international, '+27 83')).toBe(false)
  })

  it('never matches the phone when the query has letters', () => {
    expect(matchesCustomer({ ...customer, name: 'Sipho' }, 'a1')).toBe(false)
    expect(matchesCustomer({ ...customer, name: 'Sipho' }, '0821234567x')).toBe(false)
  })

  it('matches everyone for a blank query', () => {
    expect(matchesCustomer(customer, '')).toBe(true)
    expect(matchesCustomer(customer, '   ')).toBe(true)
  })
})

describe('AdminCustomers', () => {
  it('renders every field for each customer', async () => {
    render(<AdminCustomers onApiError={() => {}} />)

    expect(await screen.findByRole('heading', { name: 'Thandi Mokoena' })).toBeInTheDocument()
    expect(screen.getByText('082 123 4567')).toBeInTheDocument()
    expect(screen.getByText('thandi@example.com')).toBeInTheDocument()
    expect(screen.getByText('1 order · Spent R250.00')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sipho Dlamini' })).toBeInTheDocument()
    expect(screen.getByText('+27 71 555 0199')).toBeInTheDocument()
    expect(screen.getByText('2 orders · Spent R1234.50')).toBeInTheDocument()
    expect(screen.getByText('Last order 30 Oct 2026')).toBeInTheDocument()
  })

  it('shows "On the list" only for subscribed customers', async () => {
    render(<AdminCustomers onApiError={() => {}} />)
    await screen.findByRole('heading', { name: 'Thandi Mokoena' })

    expect(screen.getAllByText('On the list')).toHaveLength(1)
    const card = screen.getByRole('heading', { name: 'Thandi Mokoena' }).closest('div')!
    expect(card).toHaveTextContent('On the list')
    expect(screen.getByRole('heading', { name: 'Sipho Dlamini' }).closest('div')).not.toHaveTextContent('On the list')
  })

  it('leaves out the email line when the email is null', async () => {
    render(<AdminCustomers onApiError={() => {}} />)
    await screen.findByRole('heading', { name: 'Sipho Dlamini' })

    expect(screen.getByText('thandi@example.com')).toBeInTheDocument()
    expect(screen.getAllByText(/@/)).toHaveLength(1)
  })

  it('links to WhatsApp with a greeting, in a new tab', async () => {
    render(<AdminCustomers onApiError={() => {}} />)
    await screen.findByRole('heading', { name: 'Thandi Mokoena' })

    const links = screen.getAllByRole('link', { name: 'Message on WhatsApp' })
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute(
      'href',
      'https://wa.me/27821234567?text=Hi%20Thandi%2C%20this%20is%204Nguru%20The%20Brand%20here.',
    )
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0]).toHaveAttribute('rel', 'noreferrer')
    expect(links[1]).toHaveAttribute(
      'href',
      'https://wa.me/27715550199?text=Hi%20Sipho%2C%20this%20is%204Nguru%20The%20Brand%20here.',
    )
  })

  it('shows no WhatsApp link when the phone number is unusable', async () => {
    vi.mocked(listCustomers).mockResolvedValue([thandi, unusable])
    render(<AdminCustomers onApiError={() => {}} />)
    await screen.findByRole('heading', { name: 'Lerato Ndlovu' })

    expect(screen.getAllByRole('link', { name: 'Message on WhatsApp' })).toHaveLength(1)
    const card = screen.getByRole('heading', { name: 'Lerato Ndlovu' }).closest('div')!.parentElement!
    expect(card).not.toHaveTextContent('Message on WhatsApp')
  })

  it('filters by search and updates the count', async () => {
    const user = userEvent.setup()
    render(<AdminCustomers onApiError={() => {}} />)
    await screen.findByRole('heading', { name: 'Thandi Mokoena' })

    expect(screen.getByText('2 customers')).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: 'Search customers' })

    await user.type(search, 'thandi')
    expect(screen.getByText('1 customer')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sipho Dlamini' })).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'zzz')
    expect(screen.getByText('0 customers')).toBeInTheDocument()
    expect(screen.getByText('No customers match.')).toBeInTheDocument()

    await user.clear(search)
    expect(screen.getByText('2 customers')).toBeInTheDocument()
  })

  it('shows the empty state when there are no customers', async () => {
    vi.mocked(listCustomers).mockResolvedValue([])
    render(<AdminCustomers onApiError={() => {}} />)

    expect(await screen.findByText('No customers yet.')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('shows the no-match state when the search finds nobody', async () => {
    const user = userEvent.setup()
    render(<AdminCustomers onApiError={() => {}} />)
    await screen.findByRole('heading', { name: 'Thandi Mokoena' })

    await user.type(screen.getByRole('searchbox', { name: 'Search customers' }), 'nobody here')
    await waitFor(() => expect(screen.getByText('No customers match.')).toBeInTheDocument())
  })
})

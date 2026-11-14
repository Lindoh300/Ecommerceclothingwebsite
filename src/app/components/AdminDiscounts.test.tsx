// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminDiscounts, parseDiscountForm, type DiscountFormValues } from './AdminDiscounts'
import { ApiError } from '../api/client'
import { listDiscounts, saveDiscount } from '../api/discountsAdmin'
import { toast } from '../lib/toast'
import { formatEventDate } from '../utils/eventTime'
import type { Discount } from '../api/types'

vi.mock('../api/discountsAdmin', () => ({
  listDiscounts: vi.fn(),
  saveDiscount: vi.fn(),
}))
vi.mock('../lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const welcome: Discount = {
  id: 'd-1',
  code: 'WELCOME10',
  kind: 'percent',
  value: 10,
  minSpend: 0,
  expiresAt: null,
  maxUses: null,
  uses: 3,
  active: true,
  createdAt: '2026-10-01T10:00:00Z',
}
const save50: Discount = {
  id: 'd-2',
  code: 'SAVE50',
  kind: 'fixed',
  value: 50,
  minSpend: 200,
  expiresAt: '2099-12-05T16:00:00Z',
  maxUses: 10,
  uses: 3,
  active: false,
  createdAt: '2026-10-02T10:00:00Z',
}
const old: Discount = {
  id: 'd-3',
  code: 'OLD20',
  kind: 'percent',
  value: 20,
  minSpend: 0,
  expiresAt: '2020-01-01T10:00:00Z',
  maxUses: null,
  uses: 0,
  active: true,
  createdAt: '2019-12-01T10:00:00Z',
}

const base: DiscountFormValues = {
  code: 'SUMMER20',
  kind: 'percent',
  amount: '20',
  minSpend: '',
  expires: '',
  maxUses: '',
}
const withForm = (over: Partial<DiscountFormValues>): DiscountFormValues => ({ ...base, ...over })

const noop = () => {}

beforeEach(() => {
  vi.mocked(listDiscounts).mockResolvedValue([welcome, save50])
  vi.mocked(saveDiscount).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(toast.success).mockReset()
})

describe('parseDiscountForm', () => {
  it('returns a new active code, upper-cased and trimmed, with blanks read as none', () => {
    expect(parseDiscountForm(withForm({ code: '  summer20 ', amount: ' 20 ' }))).toEqual({
      input: { code: 'SUMMER20', kind: 'percent', value: 20, minSpend: 0, expiresAt: null, maxUses: null, active: true },
    })
  })

  it('accepts a code of 3 to 20 letters, digits or hyphens', () => {
    expect(parseDiscountForm(withForm({ code: 'ab-' }))).toHaveProperty('input.code', 'AB-')
    expect(parseDiscountForm(withForm({ code: '123' }))).toHaveProperty('input.code', '123')
    expect(parseDiscountForm(withForm({ code: 'A'.repeat(20) }))).toHaveProperty('input.code', 'A'.repeat(20))
  })

  it('refuses a code outside 3 to 20 characters or with other characters', () => {
    const msg = { error: 'Code must be 3 to 20 letters, digits or hyphens' }
    expect(parseDiscountForm(withForm({ code: 'AB' }))).toEqual(msg)
    expect(parseDiscountForm(withForm({ code: '' }))).toEqual(msg)
    expect(parseDiscountForm(withForm({ code: 'A'.repeat(21) }))).toEqual(msg)
    expect(parseDiscountForm(withForm({ code: 'AB_C' }))).toEqual(msg)
    expect(parseDiscountForm(withForm({ code: 'AB C' }))).toEqual(msg)
  })

  it('asks for an amount when it is blank', () => {
    expect(parseDiscountForm(withForm({ amount: '  ' }))).toEqual({ error: 'Enter an amount' })
  })

  it('takes a percent from above 0 up to 100, edges included', () => {
    expect(parseDiscountForm(withForm({ amount: '0.01' }))).toHaveProperty('input.value', 0.01)
    expect(parseDiscountForm(withForm({ amount: '100' }))).toHaveProperty('input.value', 100)
  })

  it('refuses a percent of 0 or above 100', () => {
    expect(parseDiscountForm(withForm({ amount: '0' }))).toEqual({
      error: 'Percent off must be above 0 and at most 100',
    })
    expect(parseDiscountForm(withForm({ amount: '100.01' }))).toEqual({
      error: 'Percent off must be above 0 and at most 100',
    })
  })

  it('takes a Rand amount from above 0 up to 100000, edges included', () => {
    const rand = withForm({ kind: 'fixed', amount: '0.01' })
    expect(parseDiscountForm(rand)).toHaveProperty('input.value', 0.01)
    expect(parseDiscountForm(withForm({ kind: 'fixed', amount: '100000' }))).toHaveProperty('input.value', 100000)
    expect(parseDiscountForm(withForm({ kind: 'fixed', amount: '100.01' }))).toHaveProperty('input.value', 100.01)
  })

  it('refuses a Rand amount of 0 or above 100000', () => {
    expect(parseDiscountForm(withForm({ kind: 'fixed', amount: '0' }))).toEqual({
      error: 'Rand off must be above 0 and at most 100000',
    })
    expect(parseDiscountForm(withForm({ kind: 'fixed', amount: '100000.01' }))).toEqual({
      error: 'Rand off must be above 0 and at most 100000',
    })
  })

  it('refuses an amount with more than two decimal places', () => {
    expect(parseDiscountForm(withForm({ amount: '20.005' }))).toEqual({
      error: 'Amount can have at most 2 decimal places',
    })
  })

  it('takes a minimum spend of 0 or more, and reads blank as 0', () => {
    expect(parseDiscountForm(withForm({ minSpend: '' }))).toHaveProperty('input.minSpend', 0)
    expect(parseDiscountForm(withForm({ minSpend: '0' }))).toHaveProperty('input.minSpend', 0)
    expect(parseDiscountForm(withForm({ minSpend: '0.5' }))).toHaveProperty('input.minSpend', 0.5)
    expect(parseDiscountForm(withForm({ minSpend: '10000000' }))).toHaveProperty('input.minSpend', 10000000)
  })

  it('refuses a minimum spend below 0, above 10000000, or with more than two decimal places', () => {
    const range = { error: 'Minimum spend must be from 0 to 10000000' }
    expect(parseDiscountForm(withForm({ minSpend: '-1' }))).toEqual(range)
    expect(parseDiscountForm(withForm({ minSpend: '10000000.01' }))).toEqual(range)
    expect(parseDiscountForm(withForm({ minSpend: '12.345' }))).toEqual({
      error: 'Minimum spend can have at most 2 decimal places',
    })
  })

  it('reads a blank expiry as none, and a datetime-local value as South African time', () => {
    expect(parseDiscountForm(withForm({ expires: '' }))).toHaveProperty('input.expiresAt', null)
    expect(parseDiscountForm(withForm({ expires: '2026-12-05T18:00' }))).toHaveProperty(
      'input.expiresAt',
      '2026-12-05T16:00:00.000Z',
    )
  })

  it('refuses an expiry that does not exist', () => {
    expect(parseDiscountForm(withForm({ expires: '2026-02-30T10:00' }))).toEqual({
      error: 'Enter a valid expiry date and time',
    })
  })

  it('takes a whole use limit of 1 or more, and reads blank as no limit', () => {
    expect(parseDiscountForm(withForm({ maxUses: '' }))).toHaveProperty('input.maxUses', null)
    expect(parseDiscountForm(withForm({ maxUses: '1' }))).toHaveProperty('input.maxUses', 1)
    expect(parseDiscountForm(withForm({ maxUses: '1000000' }))).toHaveProperty('input.maxUses', 1000000)
  })

  it('refuses a use limit of 0, a fraction, or above 1000000', () => {
    const msg = { error: 'Use limit must be a whole number from 1 to 1000000' }
    expect(parseDiscountForm(withForm({ maxUses: '0' }))).toEqual(msg)
    expect(parseDiscountForm(withForm({ maxUses: '1.5' }))).toEqual(msg)
    expect(parseDiscountForm(withForm({ maxUses: '1000001' }))).toEqual(msg)
  })
})

describe('AdminDiscounts', () => {
  it('sends exactly the new code with a UUID id, the code upper-cased, and shows it in the list', async () => {
    const user = userEvent.setup()
    const created: Discount = { ...welcome, id: 'new-id', code: 'SUMMER20', value: 20, uses: 0 }
    vi.mocked(listDiscounts).mockResolvedValueOnce([]).mockResolvedValue([created])
    vi.mocked(saveDiscount).mockResolvedValue(created)
    render(<AdminDiscounts onApiError={noop} />)
    await screen.findByText('No discount codes yet.')

    await user.type(screen.getByLabelText('Code'), 'summer20')
    await user.type(screen.getByLabelText('Amount'), '20')
    await user.click(screen.getByRole('button', { name: 'Add code' }))

    await waitFor(() => expect(saveDiscount).toHaveBeenCalledTimes(1))
    const [id, body] = vi.mocked(saveDiscount).mock.calls[0]
    expect(id).toMatch(UUID_RE)
    expect(body).toEqual({
      code: 'SUMMER20',
      kind: 'percent',
      value: 20,
      minSpend: 0,
      expiresAt: null,
      maxUses: null,
      active: true,
    })
    expect(toast.success).toHaveBeenCalledWith('Added SUMMER20')
    expect(await screen.findByText('SUMMER20')).toBeInTheDocument()
  })

  it('sends every field for a Rand code with a minimum, an expiry and a use limit', async () => {
    const user = userEvent.setup()
    vi.mocked(saveDiscount).mockResolvedValue(save50)
    render(<AdminDiscounts onApiError={noop} />)
    await screen.findByText('WELCOME10')

    await user.type(screen.getByLabelText('Code'), 'save50')
    await user.selectOptions(screen.getByLabelText('Type'), 'fixed')
    await user.type(screen.getByLabelText('Amount'), '50')
    await user.type(screen.getByLabelText('Minimum spend (optional)'), '200')
    fireEvent.change(screen.getByLabelText('Expires (optional)'), { target: { value: '2026-12-05T18:00' } })
    await user.type(screen.getByLabelText('Use limit (optional)'), '10')
    await user.click(screen.getByRole('button', { name: 'Add code' }))

    await waitFor(() => expect(saveDiscount).toHaveBeenCalledTimes(1))
    expect(vi.mocked(saveDiscount).mock.calls[0][1]).toEqual({
      code: 'SAVE50',
      kind: 'fixed',
      value: 50,
      minSpend: 200,
      expiresAt: '2026-12-05T16:00:00.000Z',
      maxUses: 10,
      active: true,
    })
  })

  it('sends nothing and toasts when the form is not valid', async () => {
    const user = userEvent.setup()
    render(<AdminDiscounts onApiError={noop} />)
    await screen.findByText('WELCOME10')

    await user.type(screen.getByLabelText('Code'), 'AB')
    await user.type(screen.getByLabelText('Amount'), '20')
    await user.click(screen.getByRole('button', { name: 'Add code' }))

    expect(saveDiscount).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Code must be 3 to 20 letters, digits or hyphens')
  })

  it('on a 409 code_taken shows the server message and keeps the form', async () => {
    const user = userEvent.setup()
    vi.mocked(saveDiscount).mockRejectedValue(
      new ApiError(409, 'That code already exists', { error: 'That code already exists', code: 'code_taken' }),
    )
    const onApiError = vi.fn()
    render(<AdminDiscounts onApiError={onApiError} />)
    await screen.findByText('WELCOME10')

    await user.type(screen.getByLabelText('Code'), 'WELCOME10')
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.click(screen.getByRole('button', { name: 'Add code' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That code already exists'))
    expect(screen.getByLabelText('Code')).toHaveValue('WELCOME10')
    expect(onApiError).not.toHaveBeenCalled()
  })

  it('hands any other create error to onApiError', async () => {
    const user = userEvent.setup()
    const failure = new ApiError(500, 'Database is down')
    vi.mocked(saveDiscount).mockRejectedValue(failure)
    const onApiError = vi.fn()
    render(<AdminDiscounts onApiError={onApiError} />)
    await screen.findByText('WELCOME10')

    await user.type(screen.getByLabelText('Code'), 'SUMMER20')
    await user.type(screen.getByLabelText('Amount'), '20')
    await user.click(screen.getByRole('button', { name: 'Add code' }))

    await waitFor(() => expect(onApiError).toHaveBeenCalledWith(failure))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows the note about codes not being deleted', async () => {
    render(<AdminDiscounts onApiError={noop} />)
    expect(screen.getByText("Codes can't be deleted. Turn one off to stop it working.")).toBeInTheDocument()
    await screen.findByText('WELCOME10')
  })

  it('shows each card line for a percent code with no minimum, expiry or limit', async () => {
    render(<AdminDiscounts onApiError={noop} />)

    const code = await screen.findByText('WELCOME10')
    expect(code).toHaveClass('font-mono')
    expect(screen.getByText('10% off')).toBeInTheDocument()
    expect(screen.getByText('Used 3')).toBeInTheDocument()
    expect(screen.getAllByText(/Spend at least/)).toHaveLength(1)
    expect(screen.getAllByText(/^Expires [A-Z][a-z]{2} \d/)).toHaveLength(1)
  })

  it('shows the minimum, expiry and use limit for a Rand code', async () => {
    render(<AdminDiscounts onApiError={noop} />)

    await screen.findByText('SAVE50')
    expect(screen.getByText('R50 off')).toBeInTheDocument()
    expect(screen.getByText('Spend at least R200')).toBeInTheDocument()
    expect(screen.getByText(`Expires ${formatEventDate(save50.expiresAt as string)}`)).toBeInTheDocument()
    expect(screen.getByText('Used 3 of 10')).toBeInTheDocument()
  })

  it('shows Expired for a code whose date has passed', async () => {
    vi.mocked(listDiscounts).mockResolvedValue([old])
    render(<AdminDiscounts onApiError={noop} />)

    expect(await screen.findByText('Expired')).toBeInTheDocument()
    expect(screen.queryByText(/^Expires [A-Z][a-z]{2} \d/)).not.toBeInTheDocument()
  })

  it('saves On straight away with the full values and only active changed', async () => {
    const user = userEvent.setup()
    vi.mocked(saveDiscount).mockResolvedValue({ ...save50, active: true })
    render(<AdminDiscounts onApiError={noop} />)
    await screen.findByText('SAVE50')

    await user.click(screen.getAllByRole('checkbox', { name: 'On' })[1])

    await waitFor(() => expect(saveDiscount).toHaveBeenCalledTimes(1))
    expect(saveDiscount).toHaveBeenCalledWith('d-2', {
      code: 'SAVE50',
      kind: 'fixed',
      value: 50,
      minSpend: 200,
      expiresAt: '2099-12-05T16:00:00Z',
      maxUses: 10,
      active: true,
    })
    expect(screen.getAllByRole('checkbox', { name: 'On' })[1]).toBeChecked()
  })

  it('turns a code off with its full values', async () => {
    const user = userEvent.setup()
    vi.mocked(saveDiscount).mockResolvedValue({ ...welcome, active: false })
    render(<AdminDiscounts onApiError={noop} />)
    await screen.findByText('WELCOME10')

    await user.click(screen.getAllByRole('checkbox', { name: 'On' })[0])

    await waitFor(() => expect(saveDiscount).toHaveBeenCalledTimes(1))
    expect(saveDiscount).toHaveBeenCalledWith('d-1', {
      code: 'WELCOME10',
      kind: 'percent',
      value: 10,
      minSpend: 0,
      expiresAt: null,
      maxUses: null,
      active: false,
    })
    expect(screen.getAllByRole('checkbox', { name: 'On' })[0]).not.toBeChecked()
  })

  it('puts the On checkbox back when the save fails, and hands the error to onApiError', async () => {
    const user = userEvent.setup()
    const failure = new ApiError(500, 'Database is down')
    vi.mocked(saveDiscount).mockRejectedValue(failure)
    const onApiError = vi.fn()
    render(<AdminDiscounts onApiError={onApiError} />)
    await screen.findByText('WELCOME10')

    const box = screen.getAllByRole('checkbox', { name: 'On' })[0]
    await user.click(box)

    await waitFor(() => expect(onApiError).toHaveBeenCalledWith(failure))
    expect(screen.getAllByRole('checkbox', { name: 'On' })[0]).toBeChecked()
  })

  it('shows the empty state when there are no codes', async () => {
    vi.mocked(listDiscounts).mockResolvedValue([])
    render(<AdminDiscounts onApiError={noop} />)

    expect(await screen.findByText('No discount codes yet.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'On' })).not.toBeInTheDocument()
  })

  it('shows a load failure and no codes', async () => {
    vi.mocked(listDiscounts).mockRejectedValue(new Error('Network down'))
    render(<AdminDiscounts onApiError={noop} />)

    expect(await screen.findByText("Couldn't load discount codes: Network down")).toBeInTheDocument()
    expect(screen.queryByText('No discount codes yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'On' })).not.toBeInTheDocument()
  })
})

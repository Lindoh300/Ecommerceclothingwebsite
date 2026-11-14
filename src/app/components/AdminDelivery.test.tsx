// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminDelivery, parseDeliveryPrice } from './AdminDelivery'
import { ApiError } from '../api/client'
import { listDeliveryOptionsAdmin, updateDeliveryOption } from '../api/deliveryAdmin'
import { toast } from '../lib/toast'
import type { DeliveryOptionAdmin } from '../api/types'

vi.mock('../api/deliveryAdmin', () => ({
  listDeliveryOptionsAdmin: vi.fn(),
  updateDeliveryOption: vi.fn(),
}))
vi.mock('../lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const door: DeliveryOptionAdmin = { id: 'opt-1', name: 'Door delivery', price: 95, active: true, sort: 1 }
const locker: DeliveryOptionAdmin = { id: 'opt-2', name: 'Locker pickup', price: 60, active: false, sort: 2 }

const noop = () => {}

beforeEach(() => {
  vi.mocked(listDeliveryOptionsAdmin).mockResolvedValue([door, locker])
  vi.mocked(updateDeliveryOption).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(toast.success).mockReset()
})

describe('parseDeliveryPrice', () => {
  it('accepts a whole or a two-decimal price, as a number', () => {
    expect(parseDeliveryPrice('95')).toEqual({ price: 95 })
    expect(parseDeliveryPrice(' 12.5 ')).toEqual({ price: 12.5 })
    expect(parseDeliveryPrice('0.1')).toEqual({ price: 0.1 })
    expect(parseDeliveryPrice('0')).toEqual({ price: 0 })
    expect(parseDeliveryPrice('10000')).toEqual({ price: 10000 })
  })

  it('asks for a price when the text is blank', () => {
    expect(parseDeliveryPrice('')).toEqual({ error: 'Enter a price' })
    expect(parseDeliveryPrice('   ')).toEqual({ error: 'Enter a price' })
  })

  it('refuses a negative price', () => {
    expect(parseDeliveryPrice('-1')).toEqual({ error: 'Price must be a number from 0 to 10000' })
  })

  it('refuses a price above 10000', () => {
    expect(parseDeliveryPrice('10000.01')).toEqual({ error: 'Price must be a number from 0 to 10000' })
  })

  it('refuses more than two decimal places', () => {
    expect(parseDeliveryPrice('1.005')).toEqual({ error: 'Price can have at most 2 decimal places' })
    expect(parseDeliveryPrice('12.345')).toEqual({ error: 'Price can have at most 2 decimal places' })
  })

  it('refuses text that is not a number', () => {
    expect(parseDeliveryPrice('abc')).toEqual({ error: 'Price must be a number from 0 to 10000' })
    expect(parseDeliveryPrice('R95')).toEqual({ error: 'Price must be a number from 0 to 10000' })
  })
})

describe('AdminDelivery', () => {
  it('lists every option, including one that is off', async () => {
    render(<AdminDelivery onApiError={noop} />)

    expect(await screen.findByDisplayValue('Door delivery')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Locker pickup')).toBeInTheDocument()
    expect(screen.getByDisplayValue('95')).toBeInTheDocument()
    expect(screen.getByDisplayValue('60')).toBeInTheDocument()

    const boxes = screen.getAllByRole('checkbox', { name: 'On' })
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).toBeChecked()
    expect(boxes[1]).not.toBeChecked()
  })

  it('sends exactly name, price and active for that option, then shows the saved values', async () => {
    const user = userEvent.setup()
    vi.mocked(updateDeliveryOption).mockResolvedValue({
      id: 'opt-2',
      name: 'Locker pickup (Soweto)',
      price: 65.5,
      active: true,
      sort: 2,
    })
    render(<AdminDelivery onApiError={noop} />)
    await screen.findByDisplayValue('Locker pickup')

    const nameInputs = screen.getAllByLabelText('Name')
    const priceInputs = screen.getAllByLabelText('Price (R)')
    const boxes = screen.getAllByRole('checkbox', { name: 'On' })
    const saveButtons = screen.getAllByRole('button', { name: 'Save' })

    await user.clear(nameInputs[1])
    await user.type(nameInputs[1], 'Locker pickup (Soweto)')
    await user.clear(priceInputs[1])
    await user.type(priceInputs[1], '65.5')
    await user.click(boxes[1])
    await user.click(saveButtons[1])

    await waitFor(() => expect(updateDeliveryOption).toHaveBeenCalledTimes(1))
    expect(updateDeliveryOption).toHaveBeenCalledWith('opt-2', {
      name: 'Locker pickup (Soweto)',
      price: 65.5,
      active: true,
    })

    await waitFor(() => expect(screen.getAllByLabelText('Name')[1]).toHaveValue('Locker pickup (Soweto)'))
    expect(screen.getAllByLabelText('Price (R)')[1]).toHaveValue(65.5)
    expect(screen.getAllByRole('checkbox', { name: 'On' })[1]).toBeChecked()
    expect(toast.success).toHaveBeenCalledWith('Saved Locker pickup (Soweto)')
  })

  it('sends nothing and toasts when the name is blank', async () => {
    const user = userEvent.setup()
    render(<AdminDelivery onApiError={noop} />)
    await screen.findByDisplayValue('Door delivery')

    await user.clear(screen.getAllByLabelText('Name')[0])
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0])

    expect(updateDeliveryOption).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Enter a delivery name')
  })

  it('sends nothing and toasts when the price is not valid', async () => {
    const user = userEvent.setup()
    render(<AdminDelivery onApiError={noop} />)
    await screen.findByDisplayValue('Door delivery')

    await user.clear(screen.getAllByLabelText('Price (R)')[0])
    await user.type(screen.getAllByLabelText('Price (R)')[0], '12.345')
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0])

    expect(updateDeliveryOption).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Price can have at most 2 decimal places')
  })

  it('on a 409 shows the server message and ticks On again', async () => {
    const user = userEvent.setup()
    vi.mocked(listDeliveryOptionsAdmin).mockResolvedValue([door])
    vi.mocked(updateDeliveryOption).mockRejectedValue(
      new ApiError(409, 'Keep at least one delivery option on', { code: 'last_active' }),
    )
    const onApiError = vi.fn()
    render(<AdminDelivery onApiError={onApiError} />)
    await screen.findByDisplayValue('Door delivery')

    const box = screen.getByRole('checkbox', { name: 'On' })
    await user.click(box)
    expect(box).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Keep at least one delivery option on'))
    expect(updateDeliveryOption).toHaveBeenCalledWith('opt-1', { name: 'Door delivery', price: 95, active: false })
    expect(screen.getByRole('checkbox', { name: 'On' })).toBeChecked()
    expect(onApiError).not.toHaveBeenCalled()
  })

  it('hands any other API error to onApiError', async () => {
    const user = userEvent.setup()
    const failure = new ApiError(500, 'Database is down')
    vi.mocked(updateDeliveryOption).mockRejectedValue(failure)
    const onApiError = vi.fn()
    render(<AdminDelivery onApiError={onApiError} />)
    await screen.findByDisplayValue('Door delivery')

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => expect(onApiError).toHaveBeenCalledWith(failure))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows a load failure', async () => {
    vi.mocked(listDeliveryOptionsAdmin).mockRejectedValue(new Error('Network down'))
    render(<AdminDelivery onApiError={noop} />)

    expect(await screen.findByText("Couldn't load delivery options: Network down")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})

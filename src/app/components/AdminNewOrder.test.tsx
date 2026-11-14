// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { AdminNewOrder } from './AdminNewOrder'
import { ApiError } from '../api/client'
import { checkDiscountCode, createAdminOrder, getShopConfig, listDeliveryOptions } from '../api/orders'
import { listAllProducts } from '../api/products'
import type { Order, Product } from '../api/types'

vi.mock('../api/orders', () => ({
  checkDiscountCode: vi.fn(),
  createAdminOrder: vi.fn(),
  getShopConfig: vi.fn(),
  listDeliveryOptions: vi.fn(),
}))
vi.mock('../api/products', () => ({ listAllProducts: vi.fn() }))
vi.mock('../hooks/useProducts', () => ({ loadProducts: vi.fn(() => Promise.resolve([])) }))
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
// The picker is not under test: two buttons add one unit of a variant each.
vi.mock('./AdminOrderLinePicker', () => ({
  MAX_LINES: 20,
  MAX_LINE_QUANTITY: 50,
  variantLabel: (v: { size?: string; color?: string }) => [v.size, v.color].filter(Boolean).join(' · ') || 'Standard',
  AdminOrderLinePicker: ({ products, onAdd }: { products: Product[]; onAdd: (p: Product, v: Product['variants'][number], q: number) => boolean }) => (
    <div>
      {products.map((p) => (
        <button key={p.id} type="button" onClick={() => onAdd(p, p.variants[0], 1)}>
          add {p.name}
        </button>
      ))}
    </div>
  ),
}))

const product = (id: string, name: string, price: number): Product => ({
  id,
  slug: id,
  name,
  category: 'tshirts',
  price,
  description: '',
  image: '',
  images: [],
  sizes: ['M'],
  colors: ['Black'],
  stock: 10,
  active: true,
  createdAt: '2026-10-01T10:00:00Z',
  variants: [{ id: `${id}-v`, sku: `${id}-sku`, size: 'M', color: 'Black', stock: 10 }],
})

const tee = product('p1', 'Tee', 100)
const cap = product('p2', 'Cap', 50)

const created = (extra: Partial<Order> = {}): Order =>
  ({
    id: 'o1',
    ref: 'REF-1',
    status: 'pending',
    total: 90,
    customer: { name: 'Sam', phone: '0821234567' },
    lines: [{ productId: 'p1', name: 'Tee', quantity: 1 }],
    expiresAt: null,
    ...extra,
  }) as unknown as Order

async function setup() {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <AdminNewOrder onApiError={vi.fn()} />
    </MemoryRouter>,
  )
  await screen.findByRole('button', { name: 'add Tee' })
  return user
}

async function fillCustomer(_user?: ReturnType<typeof userEvent.setup>) {
  typeInto(screen.getByLabelText('Name'), 'Sam')
  typeInto(screen.getByLabelText('Phone'), '0821234567')
}

const typeInto = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })
const codeBox = () => screen.getByLabelText(/Discount code/)
const submit = () => screen.getByRole('button', { name: 'Create order' })

beforeEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.mocked(listAllProducts).mockResolvedValue([tee, cap])
  vi.mocked(listDeliveryOptions).mockResolvedValue([])
  vi.mocked(getShopConfig).mockResolvedValue({ onlinePayments: false } as Awaited<ReturnType<typeof getShopConfig>>)
})

vi.setConfig({ testTimeout: 30000 })

describe('AdminNewOrder discount code', () => {
  it('applies a valid code, lowers the estimate and sends the code with the order', async () => {
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: 'SAVE10', amount: 10 })
    vi.mocked(createAdminOrder).mockResolvedValue(created({ discountCode: 'SAVE10', discountAmount: 10 }))
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'add Tee' }))
    typeInto(codeBox(), 'save10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('SAVE10: -R10.00')).toBeTruthy()
    expect(screen.getByText('R90.00')).toBeTruthy()
    expect(checkDiscountCode).toHaveBeenCalledWith([{ productId: 'p1', size: 'M', color: 'Black', quantity: 1 }], 'save10')
    await fillCustomer(user)
    await user.click(submit())
    await waitFor(() => expect(createAdminOrder).toHaveBeenCalled())
    expect(vi.mocked(createAdminOrder).mock.calls[0][0].discountCode).toBe('SAVE10')
    expect(await screen.findByText('Discount (SAVE10): -R10.00')).toBeTruthy()
  })

  it('shows the server message for an invalid code and sends no code', async () => {
    vi.mocked(checkDiscountCode).mockResolvedValue({ error: 'That code is not valid', code: 'discount_invalid' })
    vi.mocked(createAdminOrder).mockResolvedValue(created())
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'add Tee' }))
    typeInto(codeBox(), 'nope')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('That code is not valid')).toBeTruthy()
    await fillCustomer(user)
    await user.click(submit())
    await waitFor(() => expect(createAdminOrder).toHaveBeenCalled())
    expect('discountCode' in vi.mocked(createAdminOrder).mock.calls[0][0]).toBe(false)
  })

  it('handles empty code, no lines and a failed check', async () => {
    vi.mocked(checkDiscountCode).mockRejectedValue(new Error('boom'))
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Enter a discount code')).toBeTruthy()
    typeInto(codeBox(), 'abc')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Add an item first')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'add Tee' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Could not check the code. Please try again.')).toBeTruthy()
  })

  it('makes the code stale when the lines change, and does not send it', async () => {
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: 'SAVE10', amount: 10 })
    vi.mocked(createAdminOrder).mockResolvedValue(created())
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'add Tee' }))
    typeInto(codeBox(), 'SAVE10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByText('SAVE10: -R10.00')
    await user.click(screen.getByRole('button', { name: 'add Cap' }))
    expect(await screen.findByText('Check your code again')).toBeTruthy()
    expect(screen.queryByText('SAVE10: -R10.00')).toBeNull()
    expect(screen.getByText('R150.00')).toBeTruthy()
    await fillCustomer(user)
    await user.click(submit())
    await waitFor(() => expect(createAdminOrder).toHaveBeenCalled())
    expect('discountCode' in vi.mocked(createAdminOrder).mock.calls[0][0]).toBe(false)
  })

  it('keeps the form on a 409 discount refusal, hides shortages and uses a new id next time', async () => {
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: 'SAVE10', amount: 10 })
    vi.mocked(createAdminOrder)
      .mockRejectedValueOnce(new ApiError(409, 'This code has been used up', { code: 'discount_invalid', short: [{ productId: 'p1', size: 'M', color: 'Black', requested: 1, available: 0 }] }))
      .mockResolvedValueOnce(created())
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'add Tee' }))
    typeInto(codeBox(), 'SAVE10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByText('SAVE10: -R10.00')
    await fillCustomer(user)
    await user.click(submit())
    expect(await screen.findByText('Discount code not applied. Remove it or try another.')).toBeTruthy()
    expect(screen.getByText('This code has been used up')).toBeTruthy()
    expect(screen.queryByText(/left, you asked for/)).toBeNull()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Sam')
    await user.click(submit())
    await waitFor(() => expect(createAdminOrder).toHaveBeenCalledTimes(2))
    const [first, second] = vi.mocked(createAdminOrder).mock.calls.map((c) => c[0])
    expect(first.id).not.toBe(second.id)
    expect('discountCode' in second).toBe(false)
  })

  it('treats a 409 stock refusal as before', async () => {
    vi.mocked(createAdminOrder).mockRejectedValue(
      new ApiError(409, 'Not enough stock', { short: [{ productId: 'p1', size: 'M', color: 'Black', requested: 1, available: 0 }] }),
    )
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'add Tee' }))
    await fillCustomer(user)
    await user.click(submit())
    expect(await screen.findByText(/Not enough stock for some items/)).toBeTruthy()
    expect(screen.getByText('Only 0 left, you asked for 1.')).toBeTruthy()
    expect(screen.queryByText('Discount code not applied. Remove it or try another.')).toBeNull()
  })

  it('sends no discountCode key when there is no code', async () => {
    vi.mocked(createAdminOrder).mockResolvedValue(created())
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'add Tee' }))
    await fillCustomer(user)
    await user.click(submit())
    await waitFor(() => expect(createAdminOrder).toHaveBeenCalled())
    expect('discountCode' in vi.mocked(createAdminOrder).mock.calls[0][0]).toBe(false)
  })

  it('applies the code on Enter without submitting the form', async () => {
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: 'SAVE10', amount: 10 })
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'add Tee' }))
    await fillCustomer(user)
    typeInto(codeBox(), 'SAVE10')
    fireEvent.keyDown(codeBox(), { key: 'Enter' })
    expect(await screen.findByText('SAVE10: -R10.00')).toBeTruthy()
    expect(checkDiscountCode).toHaveBeenCalledTimes(1)
    expect(createAdminOrder).not.toHaveBeenCalled()
  })
})

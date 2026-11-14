import { describe, expect, it } from 'vitest'
import { buildRestockMessage, restockMailto, restockOption } from './restock'

const PRODUCT_URL = 'https://shop.example/product/classic-cotton-t-shirt'

describe('restockOption', () => {
  it('joins size and colour with a slash', () => {
    expect(restockOption({ size: 'M', color: 'Black' })).toBe('M / Black')
  })

  it('returns just the size when the colour is empty', () => {
    expect(restockOption({ size: 'L', color: '' })).toBe('L')
  })

  it('returns just the colour when the size is empty', () => {
    expect(restockOption({ size: '', color: 'Forest Green' })).toBe('Forest Green')
  })

  it('returns an empty string when neither is set', () => {
    expect(restockOption({ size: '', color: '' })).toBe('')
  })
})

describe('buildRestockMessage', () => {
  it('names the product and its size and colour', () => {
    expect(
      buildRestockMessage({ productName: 'Classic Cotton T-Shirt', size: 'M', color: 'Black' }, PRODUCT_URL)
    ).toBe(
      'Hi, the Classic Cotton T-Shirt (M / Black) you asked about is back in stock at 4Nguru: https://shop.example/product/classic-cotton-t-shirt'
    )
  })

  it('leaves out the brackets when the variant has no size or colour', () => {
    expect(buildRestockMessage({ productName: 'Cap', size: '', color: '' }, PRODUCT_URL)).toBe(
      'Hi, the Cap you asked about is back in stock at 4Nguru: https://shop.example/product/classic-cotton-t-shirt'
    )
  })
})

describe('restockMailto', () => {
  const request = {
    productName: 'Classic Cotton T-Shirt',
    size: 'M',
    color: 'Black',
    email: 'jane@example.com',
  }

  it('addresses the customer and sets an encoded subject and body', () => {
    expect(restockMailto(request, PRODUCT_URL)).toBe(
      'mailto:jane@example.com?subject=Back%20in%20stock%3A%20Classic%20Cotton%20T-Shirt' +
        '&body=Hi%2C%20the%20Classic%20Cotton%20T-Shirt%20(M%20%2F%20Black)%20you%20asked%20about' +
        '%20is%20back%20in%20stock%20at%204Nguru%3A%20https%3A%2F%2Fshop.example%2Fproduct%2Fclassic-cotton-t-shirt'
    )
  })

  it('decodes the body to the same text as buildRestockMessage', () => {
    const link = restockMailto(request, PRODUCT_URL)
    const body = new URL(link).searchParams.get('body')
    expect(body).toBe(buildRestockMessage(request, PRODUCT_URL))
  })

  it('leaves the address empty when the customer gave no email', () => {
    const link = restockMailto({ ...request, email: null }, PRODUCT_URL)
    expect(link.startsWith('mailto:?subject=')).toBe(true)
  })
})

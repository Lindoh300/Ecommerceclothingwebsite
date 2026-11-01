import { describe, expect, it } from 'vitest'
import type { Product, PublicEvent } from '../api/types'
import { shop } from '../config/shop'
import {
  OG_FALLBACK_IMAGE,
  ROBOTS,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  absoluteUrl,
  categoryLabel,
  categoryMeta,
  defaultMeta,
  eventMeta,
  eventPath,
  homeMeta,
  originFromMatches,
  originOf,
  pageMeta,
  productMeta,
  productPath,
  truncate,
} from './seo'

const ORIGIN = 'https://4nguru.example'

type Tag = Record<string, string>

/** Flattens a tag list into keys like "name:description", "property:og:title", "link:canonical" or "title". */
function byKey(tags: Tag[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of tags) {
    if (t.title !== undefined) out.title = t.title
    else if (t.tagName === 'link') out[`link:${t.rel}`] = t.href
    else if (t.name !== undefined) out[`name:${t.name}`] = t.content
    else if (t.property !== undefined) out[`property:${t.property}`] = t.content
  }
  return out
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-1',
    slug: 'classic-cotton-t-shirt',
    name: 'Classic Cotton T-Shirt',
    category: 'tshirts',
    price: 250,
    description: 'A soft everyday tee in heavyweight cotton.',
    image: '',
    images: [],
    sizes: ['S', 'M', 'L'],
    colors: ['Black'],
    stock: 10,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    variants: [],
    ...overrides,
  }
}

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: 'e-1',
    slug: 'summer-run',
    title: 'Summer Run',
    description: 'Five kilometres through the city.',
    startsAt: '2026-12-05T18:00:00+02:00',
    endsAt: null,
    venue: 'Company Gardens',
    city: 'Cape Town',
    image: '',
    ticketTypes: [],
    ...overrides,
  }
}

describe('constants', () => {
  it('pins the site name, titles, fallback image and robots value', () => {
    expect(SITE_NAME).toBe('4Nguru')
    expect(SITE_TITLE).toBe('4Nguru The Brand Online')
    expect(SITE_DESCRIPTION).toBe(
      'South African clothing brand. T-shirts, jerseys, shorts, pants and accessories. Shop online or order on WhatsApp.',
    )
    expect(OG_FALLBACK_IMAGE).toBe('/images/og-default.png')
    expect(ROBOTS).toBe('noindex, nofollow')
  })
})

describe('originOf', () => {
  it('returns the origin of a plain request', () => {
    expect(originOf(new Request('http://localhost:3101/product/tee'))).toBe('http://localhost:3101')
  })

  it('upgrades to https when the proxy says the request was https', () => {
    const request = new Request('http://shop.example/product/tee', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(originOf(request)).toBe('https://shop.example')
  })

  it('reads the first protocol when a chain of proxies lists several', () => {
    const request = new Request('http://shop.example/', {
      headers: { 'x-forwarded-proto': 'https, http' },
    })
    expect(originOf(request)).toBe('https://shop.example')
  })

  it('stays http when the proxy says http', () => {
    const request = new Request('http://shop.example/', { headers: { 'x-forwarded-proto': 'http' } })
    expect(originOf(request)).toBe('http://shop.example')
  })

  it('keeps an https request as https with no header', () => {
    expect(originOf(new Request('https://shop.example/x'))).toBe('https://shop.example')
  })
})

describe('absoluteUrl', () => {
  it('leaves an absolute http or https URL unchanged', () => {
    expect(absoluteUrl(ORIGIN, 'https://cdn.example/tee.jpg')).toBe('https://cdn.example/tee.jpg')
    expect(absoluteUrl(ORIGIN, 'http://cdn.example/tee.jpg')).toBe('http://cdn.example/tee.jpg')
    expect(absoluteUrl(ORIGIN, 'HTTPS://cdn.example/tee.jpg')).toBe('HTTPS://cdn.example/tee.jpg')
  })

  it('prefixes a root-relative path with the origin', () => {
    expect(absoluteUrl(ORIGIN, '/images/tee.png')).toBe('https://4nguru.example/images/tee.png')
  })

  it('adds the slash when a relative path has none', () => {
    expect(absoluteUrl(ORIGIN, 'images/tee.png')).toBe('https://4nguru.example/images/tee.png')
  })
})

describe('truncate', () => {
  it('collapses whitespace and trims the ends', () => {
    expect(truncate('  Soft \n\n  cotton\ttee.  ', 160)).toBe('Soft cotton tee.')
  })

  it('returns text up to the limit unchanged', () => {
    expect(truncate('a'.repeat(160), 160)).toBe('a'.repeat(160))
  })

  it('cuts text longer than the limit to exactly the limit', () => {
    expect(truncate('a'.repeat(200), 160)).toBe('a'.repeat(160))
  })

  it('does not leave a lone surrogate when the cut falls inside an emoji', () => {
    const text = `${'a'.repeat(159)}\u{1F600}tail`
    expect(/[\uD800-\uDBFF]$/.test(truncate(text, 160))).toBe(false)
  })
})

describe('pageMeta', () => {
  it('builds the full tag set for a page, with the fallback image', () => {
    const tags = pageMeta({ origin: ORIGIN, title: 'About | 4Nguru', description: 'About us.', path: '/about' })
    expect(byKey(tags)).toEqual({
      title: 'About | 4Nguru',
      'name:description': 'About us.',
      'name:robots': 'noindex, nofollow',
      'property:og:site_name': '4Nguru',
      'property:og:title': 'About | 4Nguru',
      'property:og:description': 'About us.',
      'property:og:type': 'website',
      'property:og:url': 'https://4nguru.example/about',
      'property:og:image': 'https://4nguru.example/images/og-default.png',
      'name:twitter:card': 'summary_large_image',
      'name:twitter:title': 'About | 4Nguru',
      'name:twitter:description': 'About us.',
      'name:twitter:image': 'https://4nguru.example/images/og-default.png',
    })
  })

  it('keeps robots at noindex, nofollow whether or not noindex is passed', () => {
    const base = { origin: ORIGIN, title: 'T', description: 'D', path: '/' }
    expect(byKey(pageMeta(base))['name:robots']).toBe('noindex, nofollow')
    expect(byKey(pageMeta({ ...base, noindex: false }))['name:robots']).toBe('noindex, nofollow')
    expect(byKey(pageMeta({ ...base, noindex: true }))['name:robots']).toBe('noindex, nofollow')
  })

  it('adds a canonical link only when a canonical path is given', () => {
    const withCanonical = pageMeta({ origin: ORIGIN, title: 'T', description: 'D', path: '/x', canonical: '/x' })
    expect(byKey(withCanonical)['link:canonical']).toBe('https://4nguru.example/x')
    const without = pageMeta({ origin: ORIGIN, title: 'T', description: 'D', path: '/x' })
    expect(without.some((t) => t.tagName === 'link')).toBe(false)
  })

  it('appends extra tags after the standard set', () => {
    const tags = pageMeta({
      origin: ORIGIN,
      title: 'T',
      description: 'D',
      path: '/',
      extra: [{ property: 'custom:thing', content: 'yes' }],
    })
    expect(tags[tags.length - 1]).toEqual({ property: 'custom:thing', content: 'yes' })
  })

  it('uses the type given, and website when none is given', () => {
    expect(byKey(pageMeta({ origin: ORIGIN, title: 'T', description: 'D', path: '/' }))['property:og:type']).toBe(
      'website',
    )
    expect(
      byKey(pageMeta({ origin: ORIGIN, title: 'T', description: 'D', path: '/', type: 'article' }))['property:og:type'],
    ).toBe('article')
  })

  it('keeps an absolute path as the og:url', () => {
    const tags = pageMeta({ origin: ORIGIN, title: 'T', description: 'D', path: 'https://other.example/page' })
    expect(byKey(tags)['property:og:url']).toBe('https://other.example/page')
  })

  it('uses an explicit absolute image as given', () => {
    const tags = pageMeta({
      origin: ORIGIN,
      title: 'T',
      description: 'D',
      path: '/',
      image: 'https://cdn.example/hero.jpg',
    })
    expect(byKey(tags)['property:og:image']).toBe('https://cdn.example/hero.jpg')
    expect(byKey(tags)['name:twitter:image']).toBe('https://cdn.example/hero.jpg')
  })
})

describe('defaultMeta', () => {
  it('describes the whole site at the origin root by default', () => {
    const tags = defaultMeta(ORIGIN)
    const keys = byKey(tags)
    expect(keys.title).toBe('4Nguru The Brand Online')
    expect(keys['name:description']).toBe(SITE_DESCRIPTION)
    expect(keys['property:og:url']).toBe('https://4nguru.example/')
    expect(keys['name:robots']).toBe('noindex, nofollow')
    expect(keys['link:canonical']).toBeUndefined()
  })

  it('uses the path given for og:url', () => {
    expect(byKey(defaultMeta(ORIGIN, '/about'))['property:og:url']).toBe('https://4nguru.example/about')
  })
})

describe('homeMeta', () => {
  it('builds the home title, description with the shop phone, and canonical root', () => {
    const keys = byKey(homeMeta(ORIGIN))
    expect(keys.title).toBe('4Nguru The Brand Online | Clothing')
    expect(shop.phone).toBe('+27 67 868 4428')
    expect(keys['name:description']).toBe(
      'Shop 4Nguru clothing online and order on WhatsApp. Delivery across South Africa. Call or WhatsApp +27 67 868 4428.',
    )
    expect(keys['link:canonical']).toBe('https://4nguru.example/')
    expect(keys['property:og:url']).toBe('https://4nguru.example/')
    expect(keys['property:og:type']).toBe('website')
    expect(keys['name:robots']).toBe('noindex, nofollow')
  })
})

describe('categoryLabel', () => {
  it('gives the legacy categories their display names', () => {
    expect(categoryLabel('tshirts')).toBe('T-Shirts')
    expect(categoryLabel('jerseys')).toBe('Jerseys')
    expect(categoryLabel('shorts')).toBe('Shorts')
    expect(categoryLabel('pants')).toBe('Pants')
    expect(categoryLabel('accessories')).toBe('Accessories')
  })

  it('turns other ids into title case words', () => {
    expect(categoryLabel('new-arrivals')).toBe('New Arrivals')
    expect(categoryLabel('summer_sale')).toBe('Summer Sale')
    expect(categoryLabel('kids')).toBe('Kids')
    expect(categoryLabel('--sale--')).toBe('Sale')
  })

  it('gives an id that names a built-in object property a plain title, not that property', () => {
    expect(typeof categoryLabel('constructor')).toBe('string')
    expect(categoryLabel('constructor')).toBe('Constructor')
  })
})

describe('categoryMeta', () => {
  it('builds the title, description, canonical and og:url for a category', () => {
    const keys = byKey(categoryMeta(ORIGIN, 'tshirts', '/tshirts'))
    expect(keys.title).toBe('T-Shirts | 4Nguru')
    expect(keys['name:description']).toBe(
      'Shop T-Shirts from 4Nguru The Brand Online. Order on WhatsApp, delivery across South Africa.',
    )
    expect(keys['link:canonical']).toBe('https://4nguru.example/tshirts')
    expect(keys['property:og:url']).toBe('https://4nguru.example/tshirts')
    expect(keys['property:og:image']).toBe('https://4nguru.example/images/og-default.png')
    expect(keys['name:robots']).toBe('noindex, nofollow')
  })
})

describe('productPath', () => {
  it('uses the slug', () => {
    expect(productPath(product())).toBe('/product/classic-cotton-t-shirt')
  })

  it('falls back to the id when there is no slug', () => {
    expect(productPath({ id: 'p-1', slug: '' })).toBe('/product/p-1')
  })

  it('encodes characters that are not safe in a path', () => {
    expect(productPath({ id: 'p-1', slug: 'tee & cap/2' })).toBe('/product/tee%20%26%20cap%2F2')
  })
})

describe('productMeta', () => {
  it('builds the full product tag set, with price in ZAR and the canonical slug URL', () => {
    expect(byKey(productMeta(ORIGIN, product()))).toEqual({
      title: 'Classic Cotton T-Shirt | 4Nguru',
      'name:description': 'A soft everyday tee in heavyweight cotton.',
      'name:robots': 'noindex, nofollow',
      'property:og:site_name': '4Nguru',
      'property:og:title': 'Classic Cotton T-Shirt | 4Nguru',
      'property:og:description': 'A soft everyday tee in heavyweight cotton.',
      'property:og:type': 'product',
      'property:og:url': 'https://4nguru.example/product/classic-cotton-t-shirt',
      'property:og:image': 'https://4nguru.example/images/og-default.png',
      'name:twitter:card': 'summary_large_image',
      'name:twitter:title': 'Classic Cotton T-Shirt | 4Nguru',
      'name:twitter:description': 'A soft everyday tee in heavyweight cotton.',
      'name:twitter:image': 'https://4nguru.example/images/og-default.png',
      'link:canonical': 'https://4nguru.example/product/classic-cotton-t-shirt',
      'property:product:price:amount': '250.00',
      'property:product:price:currency': 'ZAR',
    })
  })

  it('writes the price with two decimal places', () => {
    const keys = byKey(productMeta(ORIGIN, product({ price: 249.5 })))
    expect(keys['property:product:price:amount']).toBe('249.50')
    expect(byKey(productMeta(ORIGIN, product({ price: 1000 })))['property:product:price:amount']).toBe('1000.00')
  })

  it('uses the id in the canonical URL when there is no slug', () => {
    const keys = byKey(productMeta(ORIGIN, product({ slug: '' })))
    expect(keys['link:canonical']).toBe('https://4nguru.example/product/p-1')
    expect(keys['property:og:url']).toBe('https://4nguru.example/product/p-1')
  })

  it('uses the first non-empty product image as the preview image', () => {
    const keys = byKey(
      productMeta(ORIGIN, product({ images: ['', 'https://cdn.example/tee-front.jpg', 'https://cdn.example/back.jpg'] })),
    )
    expect(keys['property:og:image']).toBe('https://cdn.example/tee-front.jpg')
    expect(keys['name:twitter:image']).toBe('https://cdn.example/tee-front.jpg')
  })

  it('makes a relative product image absolute, with or without a leading slash', () => {
    expect(byKey(productMeta(ORIGIN, product({ images: ['/images/tee.png'] })))['property:og:image']).toBe(
      'https://4nguru.example/images/tee.png',
    )
    expect(byKey(productMeta(ORIGIN, product({ images: ['uploads/tee.png'] })))['property:og:image']).toBe(
      'https://4nguru.example/uploads/tee.png',
    )
  })

  it('uses the single image field when the images list is empty', () => {
    const keys = byKey(productMeta(ORIGIN, product({ images: [], image: 'https://cdn.example/solo.jpg' })))
    expect(keys['property:og:image']).toBe('https://cdn.example/solo.jpg')
  })

  it('falls back to the default image when the product has no image', () => {
    const keys = byKey(productMeta(ORIGIN, product({ images: [], image: '' })))
    expect(keys['property:og:image']).toBe('https://4nguru.example/images/og-default.png')
    expect(keys['name:twitter:image']).toBe('https://4nguru.example/images/og-default.png')
  })

  it('writes a line about the product when the description is empty', () => {
    const keys = byKey(productMeta(ORIGIN, product({ description: '' })))
    expect(keys['name:description']).toBe('Classic Cotton T-Shirt from 4Nguru The Brand Online.')
  })

  it('collapses whitespace in the description', () => {
    const keys = byKey(productMeta(ORIGIN, product({ description: 'Soft\n\n  cotton   tee.' })))
    expect(keys['name:description']).toBe('Soft cotton tee.')
  })

  it('cuts a long description to 160 characters', () => {
    const keys = byKey(productMeta(ORIGIN, product({ description: 'a'.repeat(200) })))
    expect(keys['name:description']).toBe('a'.repeat(160))
  })

  it('falls back to the product line when the description is only spaces', () => {
    const keys = byKey(productMeta(ORIGIN, product({ description: '   ' })))
    expect(keys['name:description']).toBe('Classic Cotton T-Shirt from 4Nguru The Brand Online.')
  })

  it('keeps quotes and angle brackets in the name as plain data', () => {
    const name = 'Tee "Classic" <Black> & Gold'
    const keys = byKey(
      productMeta(ORIGIN, product({ name, description: 'Say "hi" <b>now</b> & enjoy', slug: 'tee-classic' })),
    )
    expect(keys.title).toBe('Tee "Classic" <Black> & Gold | 4Nguru')
    expect(keys['property:og:title']).toBe('Tee "Classic" <Black> & Gold | 4Nguru')
    expect(keys['name:twitter:title']).toBe('Tee "Classic" <Black> & Gold | 4Nguru')
    expect(keys['name:description']).toBe('Say "hi" <b>now</b> & enjoy')
    expect(keys['property:og:description']).toBe('Say "hi" <b>now</b> & enjoy')
  })

  it('percent-encodes quotes in the slug so the canonical URL stays a valid href', () => {
    const keys = byKey(productMeta(ORIGIN, product({ slug: 'tee"x' })))
    expect(keys['link:canonical']).toBe('https://4nguru.example/product/tee%22x')
    expect(keys['property:og:url']).toBe('https://4nguru.example/product/tee%22x')
  })
})

describe('eventPath', () => {
  it('builds the event path from the slug', () => {
    expect(eventPath('summer-run')).toBe('/event/summer-run')
    expect(eventPath('a/b')).toBe('/event/a%2Fb')
  })
})

describe('eventMeta', () => {
  it('describes the date in South African time, then the venue and city, then the description', () => {
    const keys = byKey(eventMeta(ORIGIN, event()))
    expect(keys.title).toBe('Summer Run | 4Nguru')
    expect(keys['name:description']).toBe(
      'Sat 5 Dec 2026, 18:00 at Company Gardens, Cape Town. Five kilometres through the city.',
    )
    expect(keys['link:canonical']).toBe('https://4nguru.example/event/summer-run')
    expect(keys['property:og:url']).toBe('https://4nguru.example/event/summer-run')
    expect(keys['property:og:type']).toBe('website')
    expect(keys['name:robots']).toBe('noindex, nofollow')
  })

  it('shows the same South African time for a UTC start time', () => {
    // 16:00 UTC is 18:00 in South Africa.
    const keys = byKey(eventMeta(ORIGIN, event({ startsAt: '2026-12-05T16:00:00Z' })))
    expect(keys['name:description']).toBe(
      'Sat 5 Dec 2026, 18:00 at Company Gardens, Cape Town. Five kilometres through the city.',
    )
  })

  it('leaves out the venue join when there is no venue or city', () => {
    const keys = byKey(eventMeta(ORIGIN, event({ venue: '', city: '' })))
    expect(keys['name:description']).toBe('Sat 5 Dec 2026, 18:00. Five kilometres through the city.')
  })

  it('uses only the date and venue when the event has no description', () => {
    const keys = byKey(eventMeta(ORIGIN, event({ description: '' })))
    expect(keys['name:description']).toBe('Sat 5 Dec 2026, 18:00 at Company Gardens, Cape Town')
  })

  it('falls back to the title line when there is no usable date or description', () => {
    const keys = byKey(
      eventMeta(ORIGIN, event({ startsAt: 'not a date', venue: '', city: '', description: '' })),
    )
    expect(keys['name:description']).toBe('Summer Run from 4Nguru The Brand Online.')
  })

  it('uses the event image, made absolute, and the default image when there is none', () => {
    expect(byKey(eventMeta(ORIGIN, event({ image: 'https://cdn.example/run.jpg' })))['property:og:image']).toBe(
      'https://cdn.example/run.jpg',
    )
    expect(byKey(eventMeta(ORIGIN, event({ image: '/images/run.png' })))['property:og:image']).toBe(
      'https://4nguru.example/images/run.png',
    )
    expect(byKey(eventMeta(ORIGIN, event({ image: '' })))['property:og:image']).toBe(
      'https://4nguru.example/images/og-default.png',
    )
  })
})

describe('originFromMatches', () => {
  it('returns the origin from the root match', () => {
    const matches = [
      { id: 'root', data: { origin: 'https://4nguru.example' } },
      { id: 'routes/product', data: { origin: 'ignored' } },
    ]
    expect(originFromMatches(matches)).toBe('https://4nguru.example')
  })

  it('skips empty entries and finds the root wherever it sits', () => {
    const matches = [undefined, { id: 'routes/product' }, { id: 'root', data: { origin: 'https://x.example' } }]
    expect(originFromMatches(matches)).toBe('https://x.example')
  })

  it('returns an empty string when there is no root match', () => {
    expect(originFromMatches([{ id: 'routes/product', data: { origin: 'https://x.example' } }])).toBe('')
  })

  it('returns an empty string when the root data has no origin or is null', () => {
    expect(originFromMatches([{ id: 'root', data: {} }])).toBe('')
    expect(originFromMatches([{ id: 'root', data: null }])).toBe('')
    expect(originFromMatches([])).toBe('')
  })
})

describe('robots on every page', () => {
  it('is noindex, nofollow on every page builder, as the owner set it', () => {
    const pages = [
      defaultMeta(ORIGIN),
      homeMeta(ORIGIN),
      categoryMeta(ORIGIN, 'tshirts', '/tshirts'),
      productMeta(ORIGIN, product()),
      eventMeta(ORIGIN, event()),
    ]
    for (const tags of pages) {
      expect(byKey(tags)['name:robots']).toBe('noindex, nofollow')
    }
  })
})

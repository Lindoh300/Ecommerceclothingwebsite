// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FIT_SLOTS, FitWall } from './FitWall'
import type { PublicFitPhoto } from '../api/types'

const photo = (n: number, overrides: Partial<PublicFitPhoto> = {}): PublicFitPhoto => ({
  id: `fit-${n}`,
  image: `https://cdn.example.com/fit-${n}.jpg`,
  username: `user${n}`,
  permalink: `https://www.instagram.com/p/post${n}/`,
  postedAt: '2026-10-30T10:00:00Z',
  ...overrides,
})

const placeholders = ['https://img.example.com/p0.jpg', 'https://img.example.com/p1.jpg', 'https://img.example.com/p2.jpg']

function tiles(container: HTMLElement) {
  return Array.from(container.querySelectorAll('li'))
}

describe('FitWall', () => {
  it('always renders six tiles', () => {
    expect(FIT_SLOTS).toBe(6)
    for (const count of [0, 3, 7]) {
      const photos = Array.from({ length: count }, (_, i) => photo(i))
      const { container, unmount } = render(<FitWall photos={photos} placeholders={placeholders} />)
      expect(tiles(container)).toHaveLength(6)
      unmount()
    }
  })

  it('keeps the photos in the given order and links each to its permalink in a new tab', () => {
    const photos = [photo(1), photo(2)]
    const { container } = render(<FitWall photos={photos} placeholders={placeholders} />)
    const live = tiles(container).filter((li) => li.classList.contains('cm-spot-live'))
    expect(live).toHaveLength(2)

    const first = within(live[0]).getByRole('link', { name: 'Photo by @user1 on Instagram' })
    expect(first.getAttribute('href')).toBe('https://www.instagram.com/p/post1/')
    expect(first.getAttribute('target')).toBe('_blank')
    expect(first.getAttribute('rel')).toBe('noopener noreferrer')
    expect(live[0].querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/fit-1.jpg')

    const second = within(live[1]).getByRole('link', { name: 'Photo by @user2 on Instagram' })
    expect(second.getAttribute('href')).toBe('https://www.instagram.com/p/post2/')
  })

  it('shows at most six photos when there are seven', () => {
    const photos = Array.from({ length: 7 }, (_, i) => photo(i))
    const { container } = render(<FitWall photos={photos} placeholders={placeholders} />)
    expect(container.querySelectorAll('.cm-spot-live')).toHaveLength(6)
    expect(screen.queryByRole('link', { name: 'Photo by @user6 on Instagram' })).toBeNull()
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0)
  })

  it('falls back to a plain label when the username is empty', () => {
    const { container } = render(
      <FitWall photos={[photo(1, { username: '' })]} placeholders={placeholders} />,
    )
    const link = screen.getByRole('link', { name: 'Photo on Instagram' })
    expect(link.getAttribute('href')).toBe('https://www.instagram.com/p/post1/')
    expect(within(link).getByText('Instagram')).toBeTruthy()
    expect(container.querySelectorAll('.cm-spot-live')).toHaveLength(1)
  })

  it('gives six placeholders marked aria-hidden when there are no photos', () => {
    const { container } = render(<FitWall photos={[]} placeholders={placeholders} />)
    const items = tiles(container)
    expect(items).toHaveLength(6)
    for (const li of items) {
      expect(li.getAttribute('aria-hidden')).toBe('true')
      expect(li.classList.contains('cm-spot-live')).toBe(false)
      expect(li.textContent).toContain('Your photo here')
    }
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('gives three live tiles and three placeholders for three photos', () => {
    const photos = [photo(1), photo(2), photo(3)]
    const { container } = render(<FitWall photos={photos} placeholders={placeholders} />)
    const items = tiles(container)
    expect(items.slice(0, 3).every((li) => li.classList.contains('cm-spot-live'))).toBe(true)
    const rest = items.slice(3)
    expect(rest).toHaveLength(3)
    for (const li of rest) {
      expect(li.getAttribute('aria-hidden')).toBe('true')
      expect(li.textContent).toContain('Your photo here')
    }
    const six = Array.from({ length: 6 }, (_, i) => `https://img.example.com/p${i}.jpg`)
    const { container: withImages } = render(<FitWall photos={photos} placeholders={six} />)
    const restWithImages = tiles(withImages).slice(3)
    expect(restWithImages[0].querySelector('img')?.getAttribute('src')).toBe(six[3])
    expect(restWithImages[2].querySelector('img')?.getAttribute('src')).toBe(six[5])
  })
})

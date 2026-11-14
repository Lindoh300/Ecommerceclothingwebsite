// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminFitWall } from './AdminFitWall'
import { getFitWall, hideFit, showFit, syncFitWall } from '../api/communityAdmin'
import { toast } from '../lib/toast'
import { formatEventDate } from '../utils/eventTime'
import type { AdminFitPhoto, AdminFitWall as FitWall } from '../api/types'

vi.mock('../api/communityAdmin', () => ({
  getFitWall: vi.fn(),
  syncFitWall: vi.fn(),
  hideFit: vi.fn(),
  showFit: vi.fn(),
}))

vi.mock('../lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const shown: AdminFitPhoto = {
  id: 'p1',
  image: 'https://example.com/p1.jpg',
  username: 'thandi',
  permalink: 'https://instagram.com/p/p1',
  postedAt: '2026-10-30T10:00:00Z',
  hidden: false,
}

const hiddenPhoto: AdminFitPhoto = {
  id: 'p2',
  image: 'https://example.com/p2.jpg',
  username: 'sipho',
  permalink: 'https://instagram.com/p/p2',
  postedAt: '2026-10-29T10:00:00Z',
  hidden: true,
}

const connected = (overrides: Partial<FitWall> = {}): FitWall => ({
  enabled: true,
  photos: [shown, hiddenPhoto],
  status: { lastOkAt: '2026-10-31T08:00:00Z', lastError: '' },
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getFitWall).mockResolvedValue(connected())
  vi.mocked(syncFitWall).mockResolvedValue(connected())
  vi.mocked(hideFit).mockResolvedValue({ ...shown, hidden: true })
  vi.mocked(showFit).mockResolvedValue({ ...hiddenPhoto, hidden: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AdminFitWall', () => {
  it('shows the not-connected note with no button and no list when Instagram is off', async () => {
    vi.mocked(getFitWall).mockResolvedValue({
      enabled: false,
      photos: [],
      status: { lastOkAt: null, lastError: '' },
    })
    render(<AdminFitWall onApiError={() => {}} />)

    expect(await screen.findByText(/Instagram isn't connected yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('On the wall')).not.toBeInTheDocument()
  })

  it('splits the visible photos from the hidden ones', async () => {
    render(<AdminFitWall onApiError={() => {}} />)

    expect(await screen.findByText('@thandi')).toBeInTheDocument()
    expect(screen.getByText('On the wall')).toBeInTheDocument()
    expect(screen.getByText('Hidden')).toBeInTheDocument()
    expect(screen.getByText('@sipho')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show again' })).toBeInTheDocument()
  })

  it('hides a photo when the owner confirms', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminFitWall onApiError={() => {}} />)
    await screen.findByText('@thandi')

    await userEvent.click(screen.getByRole('button', { name: 'Hide' }))

    expect(window.confirm).toHaveBeenCalledWith('Hide this photo from the site?')
    await waitFor(() => expect(hideFit).toHaveBeenCalledWith('p1'))
  })

  it('does not hide a photo when the owner declines', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<AdminFitWall onApiError={() => {}} />)
    await screen.findByText('@thandi')

    await userEvent.click(screen.getByRole('button', { name: 'Hide' }))

    expect(hideFit).not.toHaveBeenCalled()
  })

  it('puts a hidden photo back when Show again is clicked', async () => {
    render(<AdminFitWall onApiError={() => {}} />)
    await screen.findByText('@sipho')

    await userEvent.click(screen.getByRole('button', { name: 'Show again' }))

    await waitFor(() => expect(showFit).toHaveBeenCalledWith('p2'))
  })

  it('checks Instagram when Check Instagram now is clicked', async () => {
    render(<AdminFitWall onApiError={() => {}} />)
    await screen.findByText('@thandi')

    await userEvent.click(screen.getByRole('button', { name: 'Check Instagram now' }))

    await waitFor(() => expect(syncFitWall).toHaveBeenCalledTimes(1))
  })

  it('explains a fetch failure from the last check', async () => {
    vi.mocked(getFitWall).mockResolvedValue(
      connected({ status: { lastOkAt: null, lastError: 'fetch_failed' } }),
    )
    render(<AdminFitWall onApiError={() => {}} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Instagram didn't answer on the last check. The wall hasn't changed.",
    )
    expect(screen.getByText('Not checked yet')).toBeInTheDocument()
  })

  it('shows the last successful check date', async () => {
    render(<AdminFitWall onApiError={() => {}} />)

    expect(
      await screen.findByText(`Last checked: ${formatEventDate('2026-10-31T08:00:00Z')}`),
    ).toBeInTheDocument()
  })

  it('shows "Instagram" when a post has no username', async () => {
    vi.mocked(getFitWall).mockResolvedValue(
      connected({ photos: [{ ...shown, username: '' }] }),
    )
    render(<AdminFitWall onApiError={() => {}} />)

    expect(await screen.findByText('Instagram')).toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('reports a failed Hide through onApiError and a toast', async () => {
    const onApiError = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const failure = new Error('boom')
    vi.mocked(hideFit).mockRejectedValue(failure)
    render(<AdminFitWall onApiError={onApiError} />)
    await screen.findByText('@thandi')

    await userEvent.click(screen.getByRole('button', { name: 'Hide' }))

    await waitFor(() => expect(onApiError).toHaveBeenCalledWith(failure))
    expect(toast.error).toHaveBeenCalledWith("Couldn't hide the photo.")
  })
})

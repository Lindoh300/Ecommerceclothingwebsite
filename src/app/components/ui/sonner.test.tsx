// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { Toaster } from './sonner'

// The mock shows the theme the Toaster passes to sonner, as a data attribute.
vi.mock('sonner', () => ({
  Toaster: (props: { theme?: string }) => <div data-testid="sonner" data-theme={props.theme} />,
}))

function setMode(mode: 'dark' | undefined) {
  if (mode) document.documentElement.dataset.mode = mode
  else delete document.documentElement.dataset.mode
}

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.mode
})

describe('Toaster theme', () => {
  it('uses dark when the page is in dark mode at mount', () => {
    setMode('dark')
    const { getByTestId } = render(<Toaster />)
    expect(getByTestId('sonner').getAttribute('data-theme')).toBe('dark')
  })

  it('follows data-mode when it changes after mount, in both directions', async () => {
    setMode(undefined)
    const { getByTestId } = render(<Toaster />)
    expect(getByTestId('sonner').getAttribute('data-theme')).toBe('light')

    setMode('dark')
    await waitFor(() => expect(getByTestId('sonner').getAttribute('data-theme')).toBe('dark'))

    setMode(undefined)
    await waitFor(() => expect(getByTestId('sonner').getAttribute('data-theme')).toBe('light'))
  })
})

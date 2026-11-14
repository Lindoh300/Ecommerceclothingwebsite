// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The lazy import of the admin panel is the boundary. Each test re-imports the route so React.lazy starts
// fresh, with the panel module either loading (a stand-in Admin) or failing to load.
const loadPanel = (factory: () => unknown) => {
  vi.resetModules()
  vi.doMock('../components/Admin', factory as () => Record<string, unknown>)
}

const renderRoute = async () => {
  const { default: AdminRoute } = await import('./admin')
  return render(<AdminRoute />)
}

afterEach(() => {
  vi.doUnmock('../components/Admin')
  vi.resetModules()
})

describe('routes/admin', () => {
  it('shows a message and a Reload button when the admin panel fails to load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    loadPanel(() => {
      throw new Error('chunk failed')
    })

    await renderRoute()

    expect(await screen.findByText("The admin didn't load. Check your connection and try again.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.queryByText('Admin panel')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('shows the admin panel when it loads', async () => {
    loadPanel(() => ({ Admin: () => <p>Admin panel</p> }))

    await renderRoute()

    expect(await screen.findByText('Admin panel')).toBeInTheDocument()
    expect(screen.queryByText("The admin didn't load. Check your connection and try again.")).not.toBeInTheDocument()
  })
})

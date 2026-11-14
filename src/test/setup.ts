import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount rendered trees after each test. Only needed in a DOM environment (jsdom).
if (typeof document !== 'undefined') {
  afterEach(cleanup)
}

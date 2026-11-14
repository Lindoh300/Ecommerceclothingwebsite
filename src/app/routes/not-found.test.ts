import { describe, expect, it } from 'vitest'
import { loader } from './not-found'

describe('routes/not-found loader', () => {
  it('answers with HTTP 404', () => {
    const result = loader()
    expect(result.init?.status).toBe(404)
    expect(result.data).toBeNull()
  })
})

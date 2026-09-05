import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAdminUsagePage } from './sub2apiClient'

describe('fetchAdminUsagePage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('requests sorted admin usage with the selected user and time range', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({
      data: { items: [{ id: 1, created_at: '2026-09-05T11:59:00Z' }], total: 1 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAdminUsagePage({
      baseUrl: 'https://sub2api.example.com/',
      apiKey: 'secret'
    }, {
      page: 2,
      pageSize: 200,
      startDate: '2026-09-05',
      endDate: '2026-09-05',
      timezone: 'Asia/Shanghai',
      userId: 7
    })

    const [url, options] = fetchMock.mock.calls[0]
    const requestUrl = new URL(String(url))
    expect(requestUrl.pathname).toBe('/api/v1/admin/usage')
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual(expect.objectContaining({
      page: '2',
      page_size: '200',
      sort_by: 'created_at',
      sort_order: 'desc',
      start_date: '2026-09-05',
      end_date: '2026-09-05',
      timezone: 'Asia/Shanghai',
      user_id: '7'
    }))
    expect(options).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'X-API-Key': 'secret', Authorization: 'Bearer secret' })
    }))
    expect(result).toEqual({ items: [{ id: 1, created_at: '2026-09-05T11:59:00Z' }], total: 1 })
  })
})

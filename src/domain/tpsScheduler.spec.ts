import { describe, expect, it } from 'vitest'
import { TpsScheduler, TPS_FAILURE_BACKOFF, TPS_INTERVALS, type TpsRequest } from './tpsScheduler'

const dayKey = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10)

function fakeClock(start = Date.parse('2026-09-05T08:00:00.000Z')) {
  let current = start
  return {
    now: () => current,
    advance: (milliseconds: number) => { current += milliseconds },
    set: (timestamp: number) => { current = timestamp }
  }
}

function settle(scheduler: TpsScheduler, request: TpsRequest, outcome: 'success' | 'failure' | 'cancelled' = 'success') {
  scheduler.settle(request, outcome)
}

describe('TpsScheduler', () => {
  it('polls only personal TPS while visible and keeps a 60-second cadence', () => {
    const clock = fakeClock()
    const scheduler = new TpsScheduler({ now: clock.now, dayKey, platformVisible: true, personalStatusEnabled: true, globalStatusEnabled: true })
    const requests: TpsRequest[] = []
    for (let minute = 0; minute <= 10; minute += 1) {
      const due = scheduler.poll()
      requests.push(...due)
      due.forEach((request) => settle(scheduler, request))
      clock.advance(60_000)
    }

    expect(requests).toHaveLength(11)
    expect(requests.every((request) => request.scope === 'personal')).toBe(true)
    expect(requests.every((request) => request.mode === 'incremental')).toBe(true)
  })

  it('polls personal TPS every two minutes when hidden and never polls global TPS hidden', () => {
    const clock = fakeClock()
    const scheduler = new TpsScheduler({ now: clock.now, dayKey, personalStatusEnabled: true, globalStatusEnabled: true })
    const requests: TpsRequest[] = []
    for (let minute = 0; minute <= 10; minute += 1) {
      const due = scheduler.poll()
      requests.push(...due)
      due.forEach((request) => settle(scheduler, request))
      clock.advance(60_000)
    }

    expect(requests).toHaveLength(6)
    expect(requests.every((request) => request.scope === 'personal')).toBe(true)
  })

  it('returns personal and one daily global request on the first platform open', () => {
    const clock = fakeClock()
    const scheduler = new TpsScheduler({ now: clock.now, dayKey, platformVisible: false, personalStatusEnabled: true })
    const requests = scheduler.platformOpened()
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ scope: 'personal', mode: 'incremental', trigger: 'platform-open' })
    expect(requests[1]).toMatchObject({ scope: 'global', mode: 'full', trigger: 'platform-open', targetDay: '2026-09-04' })
    requests.forEach((request) => settle(scheduler, request))

    expect(scheduler.platformOpened()).toEqual([])
    expect(scheduler.requestManual('global')).toBeNull()
  })

  it('does not duplicate global daily work from manual refresh, reopen, or an in-flight lock', () => {
    const clock = fakeClock()
    const scheduler = new TpsScheduler({ now: clock.now, dayKey, platformVisible: true })
    const first = scheduler.platformOpened()[0]
    expect(scheduler.platformOpened()).toEqual([])
    expect(scheduler.requestManual('global')).toBe(first)
    settle(scheduler, first)
    clock.advance(TPS_INTERVALS.globalManualCooldown)
    expect(scheduler.requestManual('global')).toBeNull()
    expect(scheduler.platformOpened()).toEqual([])
  })

  it('hydrates a completed global calculation for the current local day and fetches after midnight', () => {
    const clock = fakeClock(Date.parse('2026-09-05T18:00:00.000Z'))
    const scheduler = new TpsScheduler({ now: clock.now, dayKey })
    scheduler.hydrate('global', { lastIncrementalAt: new Date('2026-09-05T08:00:00.000Z') })
    expect(scheduler.platformOpened()).toEqual([])

    clock.set(Date.parse('2026-09-06T00:01:00.000Z'))
    const nextDay = scheduler.platformOpened()
    expect(nextDay).toHaveLength(1)
    expect(nextDay[0]).toMatchObject({ scope: 'global', targetDay: '2026-09-05' })
  })

  it('does not trigger global work at midnight while already open, only on the next open', () => {
    const clock = fakeClock(Date.parse('2026-09-05T23:59:00.000Z'))
    const scheduler = new TpsScheduler({ now: clock.now, dayKey, platformVisible: true })
    const first = scheduler.platformOpened()[0]
    settle(scheduler, first)
    expect(scheduler.poll()).toEqual([])

    clock.set(Date.parse('2026-09-06T00:01:00.000Z'))
    expect(scheduler.poll()).toEqual([])
    const reopened = scheduler.platformOpened()
    expect(reopened).toHaveLength(1)
    expect(reopened[0].targetDay).toBe('2026-09-05')
  })

  it('does not mark a cancelled global request complete, allowing a later open to retry', () => {
    const clock = fakeClock()
    const scheduler = new TpsScheduler({ now: clock.now, dayKey })
    const first = scheduler.platformOpened()[0]
    settle(scheduler, first, 'cancelled')
    expect(scheduler.platformOpened()).toEqual([])
    clock.advance(TPS_INTERVALS.globalManualCooldown)
    const retry = scheduler.platformOpened()[0]
    expect(retry.scope).toBe('global')
  })

  it('retries global failures only from a later platform open after backoff', () => {
    const clock = fakeClock()
    const scheduler = new TpsScheduler({ now: clock.now, dayKey, platformVisible: true, personalStatusEnabled: true })
    const first = scheduler.platformOpened().find((request) => request.scope === 'global')!
    settle(scheduler, first, 'failure')
    clock.advance(TPS_FAILURE_BACKOFF[0] - 1)
    expect(scheduler.poll()).toEqual([])
    expect(scheduler.platformOpened()).toEqual([])
    clock.advance(1)
    expect(scheduler.poll()).toEqual([])
    const retry = scheduler.platformOpened().find((request) => request.scope === 'global')
    expect(retry).toMatchObject({ scope: 'global', trigger: 'platform-open', mode: 'full' })
  })

  it('retains personal failure backoff for scheduled retries', () => {
    const clock = fakeClock()
    const scheduler = new TpsScheduler({ now: clock.now, dayKey, personalStatusEnabled: true })
    let request = scheduler.poll()[0]
    settle(scheduler, request, 'failure')
    expect(scheduler.poll()).toEqual([])
    clock.advance(TPS_FAILURE_BACKOFF[0])
    request = scheduler.poll()[0]
    expect(request).toMatchObject({ scope: 'personal', trigger: 'retry' })
  })

  it('uses the most recent request for manual cooldown', () => {
    const clock = fakeClock()
    const scheduler = new TpsScheduler({ now: clock.now, dayKey, personalStatusEnabled: true })
    const scheduled = scheduler.poll()[0]
    settle(scheduler, scheduled)
    clock.advance(TPS_INTERVALS.personalManualCooldown - 1)
    expect(scheduler.requestManual('personal')).toBeNull()
    clock.advance(1)
    expect(scheduler.requestManual('personal')).not.toBeNull()
  })
})

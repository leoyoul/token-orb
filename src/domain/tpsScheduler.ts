export type TpsScope = 'personal' | 'global'
export type TpsRequestMode = 'incremental' | 'full'
export type TpsRequestTrigger = 'schedule' | 'manual' | 'platform-open' | 'retry'
export type TpsSettleOutcome = 'success' | 'failure' | 'cancelled'
export type TpsNow = () => number | Date

export const TPS_INTERVALS = {
  personalVisible: 60_000,
  personalHidden: 2 * 60_000,
  personalManualCooldown: 15_000,
  globalManualCooldown: 60_000
} as const

export const TPS_FAILURE_BACKOFF = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000] as const

export interface TpsSchedulerOptions {
  now?: TpsNow
  dayKey?: (timestamp: number) => string
  platformVisible?: boolean
  personalStatusEnabled?: boolean
  globalStatusEnabled?: boolean
}

export interface TpsRequest {
  readonly id: number
  readonly scope: TpsScope
  readonly mode: TpsRequestMode
  readonly trigger: TpsRequestTrigger
  readonly requestedAt: number
  readonly targetDay: string | null
}

export interface TpsHydration {
  lastIncrementalAt?: number | Date | null
  lastCompleteAt?: number | Date | null
}

export interface TpsSchedulerSnapshot {
  platformVisible: boolean
  personalStatusEnabled: boolean
  globalStatusEnabled: boolean
  inFlight: Record<TpsScope, TpsRequest | null>
  consecutiveFailures: Record<TpsScope, number>
  retryAt: Record<TpsScope, number | null>
  completedDay: Record<TpsScope, string | null>
}

interface ScopeState {
  inFlight: TpsRequest | null
  lastRequestedAt: Record<TpsRequestMode, number | null>
  lastSuccessfulAt: number | null
  lastAnyRequestAt: number | null
  consecutiveFailures: number
  retryAt: number | null
  retryMode: TpsRequestMode | null
  completedDay: string | null
}

function createScopeState(): ScopeState {
  return {
    inFlight: null,
    lastRequestedAt: { incremental: null, full: null },
    lastSuccessfulAt: null,
    lastAnyRequestAt: null,
    consecutiveFailures: 0,
    retryAt: null,
    retryMode: null,
    completedDay: null
  }
}

function isScope(value: string): value is TpsScope {
  return value === 'personal' || value === 'global'
}

/** Decides TPS refreshes without owning a timer or a network client. */
export class TpsScheduler {
  private readonly now: TpsNow
  private readonly dayKey: (timestamp: number) => string
  private readonly state: Record<TpsScope, ScopeState> = {
    personal: createScopeState(),
    global: createScopeState()
  }
  private nextRequestId = 1
  private platformVisible: boolean
  private personalStatusEnabled: boolean
  private globalStatusEnabled: boolean

  constructor(options: TpsSchedulerOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.dayKey = options.dayKey ?? localDayKey
    this.platformVisible = options.platformVisible ?? false
    this.personalStatusEnabled = options.personalStatusEnabled ?? false
    this.globalStatusEnabled = options.globalStatusEnabled ?? false
  }

  setPlatformVisible(visible: boolean): void {
    this.platformVisible = visible
  }

  setStatusEnabled(scope: TpsScope, enabled: boolean): void {
    if (scope === 'personal') this.personalStatusEnabled = enabled
    else this.globalStatusEnabled = enabled
  }

  /** Restores successful cache timestamps after an application restart. */
  hydrate(scope: TpsScope, timestamps: TpsHydration): void {
    const state = this.state[scope]
    const incrementalAt = timestamps.lastIncrementalAt === undefined
      ? null
      : timestampOf(timestamps.lastIncrementalAt)
    const completeAt = timestamps.lastCompleteAt === undefined
      ? null
      : timestampOf(timestamps.lastCompleteAt)
    if (timestamps.lastIncrementalAt !== undefined && incrementalAt !== null) {
      state.lastRequestedAt.incremental = incrementalAt
    }
    if (timestamps.lastCompleteAt !== undefined && completeAt !== null) {
      state.lastRequestedAt.full = completeAt
    }
    const successfulAt = [incrementalAt, completeAt].filter((value): value is number => value !== null)
    if (successfulAt.length > 0) {
      state.lastSuccessfulAt = Math.max(state.lastSuccessfulAt ?? Number.NEGATIVE_INFINITY, ...successfulAt)
      if (scope === 'global') {
        const currentDay = this.dayKey(this.referenceTime())
        const latest = Math.max(...successfulAt)
        if (this.dayKey(latest) === currentDay) state.completedDay = currentDay
      }
    }
  }

  /** Returns all requests due at the current clock time. */
  poll(): TpsRequest[] {
    const now = this.referenceTime()
    if (this.platformVisible) {
      if (!this.personalStatusEnabled) return []
      const request = this.nextScheduledRequest('personal', now, 'visible')
      return request === null ? [] : [request]
    }

    const requests: TpsRequest[] = []
    if (this.personalStatusEnabled) {
      const request = this.nextScheduledRequest('personal', now, 'hidden')
      if (request !== null) requests.push(request)
    }
    return requests
  }

  /** Opens the platform and performs a stale-data check for the global view. */
  platformOpened(): TpsRequest[] {
    this.platformVisible = true
    const now = this.referenceTime()
    const requests: TpsRequest[] = []
    if (this.personalStatusEnabled) {
      const personal = this.nextScheduledRequest('personal', now, 'visible', 'platform-open')
      if (personal !== null) requests.push(personal)
    }

    const global = this.nextGlobalOpenRequest(now)
    if (global !== null) requests.push(global)
    return requests
  }

  /** Requests an explicit refresh. An in-flight request is returned for merging. */
  requestManual(scope: TpsScope): TpsRequest | null {
    const now = this.referenceTime()
    const state = this.state[scope]
    if (state.inFlight !== null) return state.inFlight
    if (scope === 'global' && state.completedDay === this.dayKey(now)) return null
    if (scope === 'global' && state.retryAt !== null) return null
    if (this.isBackoffActive(state, now) || this.isManualCooldownActive(scope, state, now)) return null
    const mode: TpsRequestMode = scope === 'global' ? 'full' : 'incremental'
    return this.createRequest(scope, mode, 'manual', now)
  }

  /** Completes the exact request object and applies the next retry window on failure. */
  settle(request: TpsRequest, outcome: TpsSettleOutcome): void {
    const state = this.state[request.scope]
    if (state.inFlight?.id !== request.id) return

    state.inFlight = null
    const now = this.referenceTime()
    if (outcome === 'success') {
      state.lastSuccessfulAt = now
      state.consecutiveFailures = 0
      state.retryAt = null
      state.retryMode = null
      if (request.scope === 'global') state.completedDay = this.dayKey(request.requestedAt)
      return
    }

    if (outcome === 'cancelled') return

    state.consecutiveFailures += 1
    const backoff = TPS_FAILURE_BACKOFF[Math.min(state.consecutiveFailures - 1, TPS_FAILURE_BACKOFF.length - 1)]
    state.retryAt = now + backoff
    state.retryMode = request.mode
  }

  getInFlight(scope: TpsScope): TpsRequest | null {
    return this.state[scope].inFlight
  }

  snapshot(): TpsSchedulerSnapshot {
    return {
      platformVisible: this.platformVisible,
      personalStatusEnabled: this.personalStatusEnabled,
      globalStatusEnabled: this.globalStatusEnabled,
      inFlight: { personal: this.state.personal.inFlight, global: this.state.global.inFlight },
      consecutiveFailures: {
        personal: this.state.personal.consecutiveFailures,
        global: this.state.global.consecutiveFailures
      },
      retryAt: { personal: this.state.personal.retryAt, global: this.state.global.retryAt },
      completedDay: { personal: this.state.personal.completedDay, global: this.state.global.completedDay }
    }
  }

  private nextScheduledRequest(
    scope: TpsScope,
    now: number,
    visibility: 'visible' | 'hidden',
    trigger: TpsRequestTrigger = 'schedule'
  ): TpsRequest | null {
    const state = this.state[scope]
    if (state.inFlight !== null || this.isBackoffActive(state, now)) return null

    if (state.retryAt !== null && now >= state.retryAt) {
      const mode = state.retryMode ?? 'incremental'
      return this.createRequest(scope, mode, 'retry', now)
    }

    const dueMode = this.dueMode(scope, state, now, visibility)
    return dueMode === null ? null : this.createRequest(scope, dueMode, trigger, now)
  }

  private dueMode(scope: TpsScope, state: ScopeState, now: number, visibility: 'visible' | 'hidden'): TpsRequestMode | null {
    if (scope === 'personal') {
      const interval = visibility === 'visible' ? TPS_INTERVALS.personalVisible : TPS_INTERVALS.personalHidden
      return this.isDue(state.lastRequestedAt.incremental, now, interval) ? 'incremental' : null
    }
    return null
  }

  private nextGlobalOpenRequest(now: number): TpsRequest | null {
    const state = this.state.global
    if (state.inFlight !== null || this.isManualCooldownActive('global', state, now)) return null
    const currentDay = this.dayKey(now)
    if (state.completedDay === currentDay) return null
    if (state.retryAt !== null) {
      if (this.isBackoffActive(state, now)) return null
      return this.createRequest('global', state.retryMode ?? 'full', 'platform-open', now)
    }
    return this.createRequest('global', 'full', 'platform-open', now)
  }

  private createRequest(scope: TpsScope, mode: TpsRequestMode, trigger: TpsRequestTrigger, requestedAt: number): TpsRequest {
    const request: TpsRequest = Object.freeze({
      id: this.nextRequestId++,
      scope,
      mode,
      trigger,
      requestedAt,
      targetDay: scope === 'global' ? previousDayKey(requestedAt, this.dayKey) : null
    })
    const state = this.state[scope]
    state.inFlight = request
    state.lastRequestedAt[mode] = requestedAt
    if (trigger === 'retry') {
      state.retryAt = null
      state.retryMode = null
    }
    state.lastAnyRequestAt = requestedAt
    return request
  }

  private isDue(lastRequestedAt: number | null, now: number, interval: number): boolean {
    return lastRequestedAt === null || now - lastRequestedAt >= interval
  }

  private isBackoffActive(state: ScopeState, now: number): boolean {
    return state.retryAt !== null && now < state.retryAt
  }

  private isManualCooldownActive(scope: TpsScope, state: ScopeState, now: number): boolean {
    if (state.lastAnyRequestAt === null) return false
    const cooldown = scope === 'personal' ? TPS_INTERVALS.personalManualCooldown : TPS_INTERVALS.globalManualCooldown
    return now - state.lastAnyRequestAt < cooldown
  }

  private referenceTime(): number {
    const timestamp = timestampOf(this.now())
    if (timestamp === null) throw new RangeError('Invalid scheduler clock')
    return timestamp
  }
}

function timestampOf(value: number | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const timestamp = value instanceof Date ? value.getTime() : value
  return Number.isFinite(timestamp) ? timestamp : null
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function previousDayKey(timestamp: number, dayKey: (timestamp: number) => string): string {
  const date = new Date(timestamp)
  date.setDate(date.getDate() - 1)
  return dayKey(date.getTime())
}

export function isTpsScope(value: string): value is TpsScope {
  return isScope(value)
}

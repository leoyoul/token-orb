import { beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings, loadSettings, saveSettings, settingsStorageKey } from './settings'

describe('settings', () => {
  beforeEach(() => localStorage.clear())

  it('keeps status bar data disabled for legacy settings', () => {
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      sub2apiBaseUrl: 'http://127.0.0.1:8081',
      adminApiKey: 'key'
    }))

    expect(loadSettings()).toEqual(expect.objectContaining({
      statusBarMetrics: [],
      statusBarUserId: null
    }))
  })

  it('filters duplicate and unknown status bar metrics and invalid user ids', () => {
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...defaultSettings,
      statusBarMetrics: ['todayUsage', 'unknown', 'todayUsage', 'capacity'],
      statusBarUserId: -3
    }))

    expect(loadSettings()).toEqual(expect.objectContaining({
      statusBarMetrics: ['todayUsage', 'capacity'],
      statusBarUserId: null
    }))
  })

  it('persists a positive selected user id even when the user list is unavailable', () => {
    const saved = saveSettings({
      ...defaultSettings,
      statusBarMetrics: ['selectedUserUsage'],
      statusBarUserId: 2048
    })

    expect(saved.statusBarUserId).toBe(2048)
    expect(JSON.parse(localStorage.getItem(settingsStorageKey) ?? '{}')).toEqual(expect.objectContaining({
      statusBarMetrics: ['selectedUserUsage'],
      statusBarUserId: 2048
    }))
  })
})

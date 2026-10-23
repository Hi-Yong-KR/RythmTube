import { useSyncExternalStore } from 'react'
import { DEFAULT_BINDS, KEY_COUNTS, RESERVED_CODES, type KeyCount } from '../game/layout'
import { DEFAULT_BG, DEFAULT_NOTE } from './skins'

export interface Settings {
  /** 스크롤 속도 배수 (DJMAX식 1.0 ~ 5.0) */
  speed: number
  /** 오디오 싱크 보정(ms). +면 노트가 늦게 내려온다 */
  offsetMs: number
  /** 음악 음량 0~100 (0이면 음소거) */
  volume: number
  random: boolean
  background: string
  note: string
  keyCount: KeyCount
  /** 키 수별 레인 조작 키 (KeyboardEvent.code). 없으면 기본 키 */
  keyBinds: Partial<Record<KeyCount, string[]>>
}

const KEY = 'rt.settings'
const defaults: Settings = { speed: 2.5, offsetMs: 0, volume: 100, random: false, background: DEFAULT_BG, note: DEFAULT_NOTE, keyCount: 5, keyBinds: {} }

let current: Settings = load()
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const s: Settings = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
    if (!KEY_COUNTS.includes(s.keyCount)) s.keyCount = 5
    if (!Number.isFinite(s.volume)) s.volume = defaults.volume
    return s
  } catch {
    return defaults
  }
}

export function getSettings() {
  return current
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* 저장 실패해도 세션 동안은 유지 */
  }
  listeners.forEach((l) => l())
}

export function useSettings() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  )
}

/** 현재 키 수의 레인별 조작 키. 저장값이 깨졌으면(개수·중복·예약 키) 기본 키를 쓴다 */
export function getKeyBinds(s: Settings, keys: KeyCount = s.keyCount): string[] {
  const b = s.keyBinds[keys]
  const valid = Array.isArray(b) && b.length === keys && new Set(b).size === keys && b.every((c) => typeof c === 'string' && !RESERVED_CODES.has(c))
  return valid ? b : DEFAULT_BINDS[keys]
}

// 곡별 BPM/박자 위치 (탭 템포로 맞춘 값)
export interface SongSync {
  bpm: number
  /** 첫 박이 나오는 영상 시간(ms) */
  beatMs: number
}

export function getSongSync(videoId: string): SongSync | null {
  try {
    return JSON.parse(localStorage.getItem(`rt.sync.${videoId}`) ?? 'null')
  } catch {
    return null
  }
}

export function setSongSync(videoId: string, sync: SongSync) {
  try {
    localStorage.setItem(`rt.sync.${videoId}`, JSON.stringify(sync))
  } catch {
    /* noop */
  }
}

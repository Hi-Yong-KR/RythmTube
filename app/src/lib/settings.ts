import { useSyncExternalStore } from 'react'
import { DEFAULT_BG, DEFAULT_NOTE } from './skins'

export interface Settings {
  /** 스크롤 속도 배수 (DJMAX식 1.0 ~ 5.0) */
  speed: number
  /** 오디오 싱크 보정(ms). +면 노트가 늦게 내려온다 */
  offsetMs: number
  random: boolean
  background: string
  note: string
}

const KEY = 'rt.settings'
const defaults: Settings = { speed: 2.5, offsetMs: 0, random: false, background: DEFAULT_BG, note: DEFAULT_NOTE }

let current: Settings = load()
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
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

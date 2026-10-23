import type { Chart, Note } from './chart'

export interface Tier {
  window: number
  rate: number
  label: string
}

// DJMAX식 퍼센트 판정. 마지막 창을 벗어나면 BREAK
export const TIERS: Tier[] = [
  { window: 42, rate: 100, label: 'MAX 100%' },
  { window: 62, rate: 90, label: '90%' },
  { window: 82, rate: 80, label: '80%' },
  { window: 100, rate: 60, label: '60%' },
  { window: 118, rate: 40, label: '40%' },
]
export const BREAK_WINDOW = 140
const HOLD_RELEASE_GRACE = 110

export type JudgeKind = 'MAX' | 'GOOD' | 'BREAK'

export interface JudgeEvent {
  lane: number
  time: number
  rate: number
  label: string
  kind: JudgeKind
  /** -: 빠름, +: 느림 */
  delta: number
}

export interface Stats {
  counts: Record<string, number>
  combo: number
  maxCombo: number
  sumRate: number
  judged: number
  early: number
  late: number
  /** 판정된 입력의 타이밍 오차 합 (싱크 추천용) */
  deltaSum: number
  deltaCount: number
}

interface NoteState {
  note: Note
  head: boolean
  holding: boolean
  done: boolean
}

export class Engine {
  stats: Stats = {
    counts: Object.fromEntries([...TIERS.map((t) => t.label), 'BREAK'].map((k) => [k, 0])),
    combo: 0,
    maxCombo: 0,
    sumRate: 0,
    judged: 0,
    early: 0,
    late: 0,
    deltaSum: 0,
    deltaCount: 0,
  }
  events: JudgeEvent[] = []
  private states: NoteState[]
  private byLane: NoteState[][]
  private cursor: number[]

  constructor(public chart: Chart) {
    this.byLane = Array.from({ length: chart.keys }, () => [])
    this.cursor = Array(chart.keys).fill(0)
    this.states = chart.notes.map((note) => ({ note, head: false, holding: false, done: false }))
    for (const s of this.states) this.byLane[s.note.lane].push(s)
  }

  get notes() {
    return this.states
  }

  private record(lane: number, time: number, rate: number, label: string, delta: number) {
    const s = this.stats
    s.counts[label]++
    s.judged++
    s.sumRate += rate
    if (rate > 0) {
      s.combo++
      s.maxCombo = Math.max(s.maxCombo, s.combo)
    } else {
      s.combo = 0
    }
    if (rate > 0 && rate < 100) delta < 0 ? s.early++ : s.late++
    const kind: JudgeKind = rate === 100 ? 'MAX' : rate > 0 ? 'GOOD' : 'BREAK'
    this.events.push({ lane, time, rate, label, kind, delta })
  }

  private next(lane: number) {
    const list = this.byLane[lane]
    while (this.cursor[lane] < list.length && list[this.cursor[lane]].head) this.cursor[lane]++
    return list[this.cursor[lane]]
  }

  press(lane: number, t: number) {
    const s = this.next(lane)
    if (!s) return
    const delta = t - s.note.time
    if (delta < -BREAK_WINDOW) return // 너무 이른 입력은 무시
    const tier = TIERS.find((x) => Math.abs(delta) <= x.window)
    s.head = true
    if (tier) {
      this.stats.deltaSum += delta
      this.stats.deltaCount++
      this.record(lane, t, tier.rate, tier.label, delta)
      if (s.note.end > s.note.time) s.holding = true
      else s.done = true
    } else {
      this.record(lane, t, 0, 'BREAK', delta)
      if (s.note.end > s.note.time) this.record(lane, t, 0, 'BREAK', 0)
      s.done = true
    }
  }

  release(lane: number, t: number) {
    for (const s of this.byLane[lane]) {
      if (!s.holding) continue
      s.holding = false
      s.done = true
      if (t < s.note.end - HOLD_RELEASE_GRACE) this.record(lane, t, 0, 'BREAK', 0)
      else this.record(lane, t, 100, 'MAX 100%', 0)
    }
  }

  /** 지나간 노트 BREAK 처리, 끝까지 누른 롱노트 완료 처리 */
  update(t: number) {
    for (let lane = 0; lane < this.byLane.length; lane++) {
      for (const s of this.byLane[lane]) {
        if (s.done) continue
        if (s.holding && t >= s.note.end) {
          s.holding = false
          s.done = true
          this.record(lane, s.note.end, 100, 'MAX 100%', 0)
        } else if (!s.head && t - s.note.time > BREAK_WINDOW) {
          s.head = true
          s.done = true
          this.record(lane, t, 0, 'BREAK', 0)
          if (s.note.end > s.note.time) this.record(lane, t, 0, 'BREAK', 0)
        }
        if (!s.head && s.note.time > t + BREAK_WINDOW) break
      }
    }
  }

  drainEvents() {
    const e = this.events
    this.events = []
    return e
  }

  get accuracy() {
    return this.stats.judged ? this.stats.sumRate / this.stats.judged : 100
  }

  get score() {
    const total = this.chart.judgeCount || 1
    return Math.round(1_000_000 * ((0.85 * this.stats.sumRate) / (100 * total) + (0.15 * this.stats.maxCombo) / total))
  }
}

export function gradeOf(accuracy: number) {
  if (accuracy >= 99) return 'S+'
  if (accuracy >= 97) return 'S'
  if (accuracy >= 93) return 'A'
  if (accuracy >= 85) return 'B'
  if (accuracy >= 75) return 'C'
  return 'D'
}

export interface PlayResult {
  videoId: string
  title: string
  channel: string
  thumbnail: string
  difficulty: string
  keys: number
  level: number
  bpm: number
  random: boolean
  score: number
  accuracy: number
  maxCombo: number
  counts: Record<string, number>
  early: number
  late: number
  judgeCount: number
  /** 평균 타이밍 오차(ms). +면 늦게 친 것 */
  avgDelta: number
}

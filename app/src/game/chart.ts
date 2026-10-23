// 노트 자동 배치기.
// 유튜브 오디오는 브라우저에서 분석할 수 없으므로 BPM·박 위치·곡 길이로 곡 구조(인트로/벌스/후렴…)를 추정하고,
// 손 구조(키 수별 왼손 / 엄지 / 오른손 레인, layout.ts)를 기준으로 사람이 칠 수 있는 배치만 남긴다.
// 같은 곡·같은 난이도·같은 BPM·같은 키 수면 항상 같은 채보가 나온다(시드 고정).

import { HANDS, type Hand, type KeyCount } from './layout'
import { hashString, mulberry32, pickWeighted, type Rng } from './rng'

export type Difficulty = 'NM' | 'HD' | 'MX' | 'SC'

export const DIFFICULTIES: { id: Difficulty; label: string; color: string }[] = [
  { id: 'NM', label: 'NORMAL', color: '#ffd23f' },
  { id: 'HD', label: 'HARD', color: '#ff8a3d' },
  { id: 'MX', label: 'MAXIMUM', color: '#ff4d5e' },
  { id: 'SC', label: 'SC', color: '#b26bff' },
]

interface Layout {
  keys: KeyCount
  hand: Hand[]
  /** 손별 레인 목록 */
  groups: Record<Hand, number[]>
  /** 같은 손 다른 손가락 레인 (엄지는 없음) */
  siblings: number[][]
}

function layoutOf(keys: KeyCount): Layout {
  const hand = HANDS[keys]
  const groups: Record<Hand, number[]> = { L: [], T: [], R: [] }
  hand.forEach((h, i) => groups[h].push(i))
  const siblings = hand.map((h, i) => (h === 'T' ? [] : groups[h].filter((x) => x !== i)))
  return { keys, hand, groups, siblings }
}

/** 키가 많을수록 레인이 넓게 퍼지므로 노트 수를 조금 늘린다 */
const KEY_DENSITY: Record<KeyCount, number> = { 4: 0.9, 5: 1, 6: 1.1, 7: 1.15, 8: 1.25 }

/** 그룹에서 하나 고르기. 하나뿐이면 난수를 쓰지 않는다(5키 채보를 예전과 똑같이 유지) */
function pick(rng: Rng, group: number[]) {
  return group.length === 1 ? group[0] : group[Math.floor(rng() * group.length)]
}

export interface Note {
  id: number
  lane: number
  /** 판정 시각 (영상 기준 ms) */
  time: number
  /** 롱노트 끝 시각. 일반 노트면 time과 같다 */
  end: number
}

export interface Chart {
  notes: Note[]
  difficulty: Difficulty
  keys: KeyCount
  bpm: number
  level: number
  /** 판정 개수: 일반 노트 1, 롱노트 2(시작+끝) */
  judgeCount: number
  lastTime: number
}

interface Profile {
  /** 난이도가 정하는 노트 수: 플레이 구간 1초당 노트 개수 */
  targetNps: number
  density: number
  maxSubdiv: 2 | 4
  /** 연속 노트 사이 최소 간격 — 이보다 촘촘한 분할은 쓰지 않는다 */
  minSlotMs: number
  chordRate: number
  maxChord: number
  holdRate: number
  /** 같은 손 다른 손가락으로 연타할 때 최소 간격 */
  handGapMs: number
  /** 같은 손가락(같은 레인) 연타 최소 간격 */
  jackGapMs: number
  maxNps: number
  /** 롱노트를 누르는 동안 같은 손 다른 손가락 사용 금지 */
  lockHandOnHold: boolean
  sameHandChord: boolean
}

const PROFILES: Record<Difficulty, Profile> = {
  NM: { targetNps: 2.2, density: 0.4, maxSubdiv: 2, minSlotMs: 230, chordRate: 0.05, maxChord: 2, holdRate: 0.07, handGapMs: 230, jackGapMs: 420, maxNps: 4.5, lockHandOnHold: true, sameHandChord: false },
  HD: { targetNps: 3.4, density: 0.55, maxSubdiv: 4, minSlotMs: 150, chordRate: 0.1, maxChord: 2, holdRate: 0.09, handGapMs: 150, jackGapMs: 280, maxNps: 7, lockHandOnHold: true, sameHandChord: false },
  MX: { targetNps: 4.8, density: 0.68, maxSubdiv: 4, minSlotMs: 115, chordRate: 0.16, maxChord: 2, holdRate: 0.1, handGapMs: 112, jackGapMs: 200, maxNps: 10, lockHandOnHold: false, sameHandChord: true },
  SC: { targetNps: 6.4, density: 0.8, maxSubdiv: 4, minSlotMs: 95, chordRate: 0.22, maxChord: 3, holdRate: 0.12, handGapMs: 92, jackGapMs: 160, maxNps: 13, lockHandOnHold: false, sameHandChord: true },
}

// 곡 진행에 따른 에너지 곡선 (팝 음악의 일반적인 구조)
const STRUCTURE: [number, number][] = [
  [0, 0.35], // 인트로
  [0.08, 0.6], // 벌스
  [0.24, 0.8], // 프리코러스
  [0.32, 1], // 후렴
  [0.45, 0.5], // 벌스2
  [0.55, 0.78],
  [0.62, 1], // 후렴2
  [0.76, 0.5], // 브릿지
  [0.84, 1], // 마지막 후렴
  [0.95, 0.3], // 아웃트로
]

// 한 박(16분음표 4칸) 리듬 조각
const BEAT_PATTERNS: { slots: number[]; weight: number }[] = [
  { slots: [], weight: 0 },
  { slots: [0], weight: 1 },
  { slots: [0, 2], weight: 2 },
  { slots: [2], weight: 1 },
  { slots: [0, 3], weight: 2 },
  { slots: [0, 2, 3], weight: 3 },
  { slots: [0, 1, 2], weight: 3 },
  { slots: [0, 1, 2, 3], weight: 4 },
]

type Flow = 'stair' | 'alternate' | 'trill' | 'zigzag' | 'scatter'
const FLOWS: Flow[] = ['stair', 'alternate', 'trill', 'zigzag', 'scatter']

class HandState {
  laneFree: number[]
  handPress: Record<Hand, number> = { L: -Infinity, T: -Infinity, R: -Infinity }
  handBusy: Record<Hand, number> = { L: -Infinity, T: -Infinity, R: -Infinity }
  recent: number[] = []
  constructor(
    private p: Profile,
    private lay: Layout,
  ) {
    this.laneFree = lay.hand.map(() => -Infinity)
  }

  fits(lane: number, t: number, mates: number[]): boolean {
    const p = this.p
    const hand = this.lay.hand[lane]
    const jack = hand === 'T' ? p.jackGapMs * 0.8 : p.jackGapMs
    if (t - this.laneFree[lane] < jack) return false
    if (mates.includes(lane)) return false
    if (hand !== 'T') {
      const sibs = this.lay.siblings[lane]
      if (sibs.some((s) => mates.includes(s))) {
        if (!p.sameHandChord) return false
      } else if (t - this.handPress[hand] < p.handGapMs && this.handPress[hand] !== t) {
        return false
      }
      if (p.lockHandOnHold && this.handBusy[hand] > t) return false
      // 롱노트를 잡고 있는 손가락 옆 손가락은 최소한 handGap 두 배는 쉬게 한다
      if (!p.lockHandOnHold && sibs.some((s) => this.laneFree[s] > t) && t - this.handPress[hand] < p.handGapMs * 2) return false
    }
    return true
  }

  npsOk(t: number) {
    while (this.recent.length && this.recent[0] <= t - 1000) this.recent.shift()
    return this.recent.length < this.p.maxNps
  }

  commit(lane: number, t: number, end: number) {
    this.laneFree[lane] = end
    const hand = this.lay.hand[lane]
    this.handPress[hand] = Math.max(this.handPress[hand], t)
    if (end > t) this.handBusy[hand] = Math.max(this.handBusy[hand], end)
    this.recent.push(t)
  }
}

function energyAt(frac: number) {
  let e = STRUCTURE[0][1]
  for (const [f, v] of STRUCTURE) if (frac >= f) e = v
  return e
}

function pickBeatPattern(rng: Rng, target: number, sub: 2 | 4): number[] {
  const usable = BEAT_PATTERNS.filter((b) => sub === 4 || b.slots.every((s) => s % 2 === 0))
  const weights = usable.map((b) => Math.exp(-((b.weight - target) ** 2) / 0.9))
  return usable[pickWeighted(rng, weights)].slots
}

/** 2마디짜리 리듬 모티프: 마디별·박별로 16분 칸 인덱스 목록 */
function makeMotif(rng: Rng, energy: number, density: number, sub: 2 | 4): number[][][] {
  const target = energy * density * 4
  return [0, 1].map(() =>
    [0, 1, 2, 3].map((beat) => {
      // 정박(1, 3박)은 비우지 않는다
      const slots = pickBeatPattern(rng, target + (beat % 2 === 0 ? 0.4 : -0.2), sub)
      return beat % 2 === 0 && !slots.includes(0) ? [0, ...slots] : slots
    }),
  )
}

class FlowCursor {
  private i = 0
  private trillPair: [number, number]
  private zig: number[] = []
  private stair: number[]
  private lastHand: 'L' | 'R' = 'R'
  constructor(
    private rng: Rng,
    public flow: Flow,
    private lay: Layout,
  ) {
    const n = lay.hand.length
    // 계단: 0 → 끝 → 1, 지그재그: 양 끝에서 가운데로
    this.stair = [...Array(n).keys(), ...[...Array(n - 2).keys()].map((i) => n - 2 - i)]
    for (let a = 0, b = n - 1; a <= b; a++, b--) this.zig.push(...(a === b ? [a] : [a, b]))
    const pairs = trillPairs(lay)
    this.trillPair = pairs[Math.floor(rng() * pairs.length)]
    if (rng() < 0.5) this.stair.reverse()
  }
  next(): number {
    const i = this.i++
    switch (this.flow) {
      case 'stair':
        return this.stair[i % this.stair.length]
      case 'trill':
        return this.trillPair[i % 2]
      case 'zigzag':
        return this.zig[i % this.zig.length]
      case 'alternate': {
        this.lastHand = this.lastHand === 'L' ? 'R' : 'L'
        const { groups } = this.lay
        if (groups.T.length && this.rng() < 0.12) return groups.T[0]
        return groups[this.lastHand][Math.floor(this.rng() * groups[this.lastHand].length)]
      }
      default:
        return Math.floor(this.rng() * this.lay.hand.length)
    }
  }
}

/** 트릴은 양손을 번갈아 치는 쌍, 엄지가 있으면 엄지와 바로 옆 레인 쌍도 */
function trillPairs(lay: Layout): [number, number][] {
  // 5키는 예전 채보와 같은 순서를 유지한다
  if (lay.keys === 5) return [[1, 3], [0, 4], [0, 3], [1, 4], [1, 2], [2, 3]]
  const { L, R, T } = lay.groups
  const pairs: [number, number][] = []
  for (const l of L) for (const r of R) pairs.push([l, r])
  for (const t of T) pairs.push([t - 1, t], [t, t + 1])
  return pairs
}

function laneOrder(preferred: number, n: number) {
  return [...Array(n).keys()].sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))
}

function chordCandidates(primary: number, maxChord: number, rng: Rng, lay: Layout): number[][] {
  const { groups } = lay
  const opts: number[][] = []
  for (const h of ['L', 'R', 'T'] as Hand[]) {
    if (h !== lay.hand[primary] && groups[h].length) opts.push([pick(rng, groups[h])])
  }
  if (maxChord >= 3) {
    const l = pick(rng, groups.L)
    const r = pick(rng, groups.R)
    const third = groups.T.length ? groups.T[0] : pick(rng, lay.hand.map((_, i) => i).filter((x) => x !== l && x !== r))
    opts.push([l, r, third].filter((x) => x !== primary).slice(0, 2))
  }
  return opts
}

export interface ChartInput {
  videoId: string
  difficulty: Difficulty
  keys: KeyCount
  bpm: number
  /** 첫 박 위치(ms) */
  beatMs: number
  durationMs: number
}

function profileOf(difficulty: Difficulty, keys: KeyCount): Profile {
  const p = PROFILES[difficulty]
  const k = KEY_DENSITY[keys]
  return { ...p, targetNps: p.targetNps * k, maxNps: p.maxNps * k }
}

/** 난이도·키 수가 정하는 목표 노트 수 (곡 길이에 비례) */
export function targetNoteCount(difficulty: Difficulty, durationMs: number, keys: KeyCount) {
  const playable = Math.max(0, durationMs - 3500 - 2400) / 1000
  return Math.round(profileOf(difficulty, keys).targetNps * playable)
}

/**
 * 1) 난이도 밀도로 후보 노트를 넉넉히 만들고(부족하면 밀도를 올려 다시 생성)
 * 2) 중요도가 낮은 노트(동시치기 보조 → 16분 엇박 → 8분 엇박 순)부터 지워 목표 개수에 맞춘다.
 * 노트를 지우기만 하므로 손 간격 규칙은 그대로 지켜진다.
 */
export function generateChart(input: ChartInput): Chart {
  const p = PROFILES[input.difficulty]
  const target = targetNoteCount(input.difficulty, input.durationMs, input.keys)
  let pool = generatePool(input, p.density)
  for (let boost = 1; pool.notes.length < target && boost <= 3; boost++) {
    pool = generatePool(input, p.density + boost * 0.2)
  }
  const extra = pool.notes.length - target
  if (extra > 0) {
    const drop = new Set(
      [...pool.notes]
        .sort((a, b) => pool.priority[a.id] - pool.priority[b.id])
        .slice(0, extra)
        .map((n) => n.id),
    )
    pool.notes = pool.notes.filter((n) => !drop.has(n.id))
  }
  return finalize(pool.notes, input.difficulty, input.bpm, input.keys)
}

function generatePool({ videoId, difficulty, keys, bpm, beatMs, durationMs }: ChartInput, density: number) {
  const p = profileOf(difficulty, keys)
  const lay = layoutOf(keys)
  // 5키 시드에는 키 수를 붙이지 않아 예전 채보(랭킹 기록)와 같다
  const rng = mulberry32(hashString(`${videoId}|${difficulty}|${Math.round(bpm)}${keys === 5 ? '' : `|${keys}K`}`))
  const priority: number[] = []
  const beat = 60000 / bpm
  let sub: 4 | 2 | 1 = p.maxSubdiv
  while (sub > 1 && beat / sub < p.minSlotMs) sub = (sub / 2) as 2 | 1
  const subdiv = Math.max(sub, 2) as 2 | 4
  // 분할이 너무 촘촘하면 1박 단위까지 줄인다 (빠른 곡의 NORMAL 등)
  const slotStep = sub === 1 ? 4 : 4 / sub

  const bar = beat * 4
  const leadIn = 2400
  let start = beatMs
  while (start < leadIn) start += bar
  const end = durationMs - 3500
  const totalBars = Math.max(0, Math.floor((end - start) / bar))

  const state = new HandState(p, lay)
  const notes: Note[] = []
  let id = 0

  for (let phrase = 0; phrase < totalBars; phrase += 4) {
    const frac = phrase / Math.max(1, totalBars)
    const energy = Math.min(1, Math.max(0.15, energyAt(frac) + (rng() - 0.5) * 0.12))
    const motif = makeMotif(rng, energy, density, subdiv)
    const fill = makeMotif(rng, Math.min(1, energy + 0.25), density, subdiv)[0]
    const flow = new FlowCursor(rng, FLOWS[pickWeighted(rng, energy > 0.7 ? [3, 3, 2, 2, 1] : [2, 3, 1, 1, 2])], lay)
    // A A' A B 구조: 3번째 마디는 1번째 반복, 4번째 마디는 필인
    const bars = [motif[0], motif[1], motif[0], fill]

    bars.forEach((barBeats, bi) => {
      const barIdx = phrase + bi
      if (barIdx >= totalBars) return
      const barStart = start + barIdx * bar
      barBeats.forEach((slots, beatIdx) => {
        for (const slot of slots) {
          if (slot % slotStep !== 0) continue
          const t = Math.round(barStart + beatIdx * beat + (slot * beat) / 4)
          if (!state.npsOk(t)) continue

          const preferred = flow.next()
          const lane = laneOrder(preferred, keys).find((l) => state.fits(l, t, []))
          if (lane === undefined) continue

          // 롱노트: 정박에서, 덜 격한 구간 위주로
          let noteEnd = t
          if (slot === 0 && rng() < p.holdRate * (1.4 - energy)) {
            const len = beat * (rng() < 0.5 ? 1 : 2)
            if (t + len < end) noteEnd = Math.round(t + len)
          }

          const placed = [lane]
          // 중요도: 마디 첫 박 > 정박 > 8분 엇박 > 16분 엇박, 롱노트·후렴 가산, 동점은 시드 난수로
          const rank = slot === 0 ? (beatIdx === 0 ? 4 : 3) : slot === 2 ? 2 : 1
          priority[id] = rank + (noteEnd > t ? 1.5 : 0) + energy + rng() * 0.9
          notes.push({ id: id++, lane, time: t, end: noteEnd })
          state.commit(lane, t, noteEnd)

          // 동시치기: 마디 첫 박 강세 + 에너지 비례
          const accent = beatIdx === 0 && slot === 0
          const chordChance = p.chordRate * energy * (accent ? 2.5 : 1)
          if (noteEnd === t && rng() < chordChance) {
            for (const group of chordCandidates(lane, p.maxChord, rng, lay)) {
              if (group.every((l) => state.fits(l, t, placed.filter((x) => x !== l)))) {
                for (const l of group) {
                  priority[id] = rng() * 0.9
                  notes.push({ id: id++, lane: l, time: t, end: t })
                  state.commit(l, t, t)
                  placed.push(l)
                }
                break
              }
            }
          }
        }
      })
    })
  }

  return { notes, priority }
}

function finalize(notes: Note[], difficulty: Difficulty, bpm: number, keys: KeyCount): Chart {
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane)
  notes.forEach((n, i) => (n.id = i))
  const judgeCount = notes.reduce((s, n) => s + (n.end > n.time ? 2 : 1), 0)
  const first = notes[0]?.time ?? 0
  const lastTime = notes.reduce((m, n) => Math.max(m, n.end), 0)
  const span = Math.max(1, (lastTime - first) / 1000)
  const nps = notes.length / span
  const chords = notes.filter((n, i) => i > 0 && notes[i - 1].time === n.time).length / Math.max(1, notes.length)
  const level = Math.max(1, Math.min(15, Math.round(nps * 1.45 + chords * 6 + (difficulty === 'SC' ? 1 : 0))))
  return { notes, difficulty, keys, bpm, level, judgeCount, lastTime }
}

/**
 * 랜덤 옵션: 일정 구간마다 손 좌우·손가락 배치를 섞는다.
 * 섞은 뒤에도 위와 같은 손 규칙으로 다시 검증해서, 랜덤 때문에 못 치는 배치가 생기지 않게 한다.
 */
export function randomizeChart(chart: Chart, seed: number): Chart {
  const p = PROFILES[chart.difficulty]
  const lay = layoutOf(chart.keys)
  const rng = mulberry32(seed)
  const state = new HandState({ ...p, maxNps: Infinity }, lay)
  const out: Note[] = []
  const windowMs = 6000
  let windowEnd = -Infinity
  let map = lay.hand.map((_, i) => i)

  const groups = new Map<number, Note[]>()
  for (const n of chart.notes) groups.set(n.time, [...(groups.get(n.time) ?? []), n])

  for (const [t, group] of groups) {
    if (t >= windowEnd) {
      windowEnd = t + windowMs
      let l = shuffle(rng, lay.groups.L)
      let r = shuffle(rng, lay.groups.R)
      if (rng() < 0.5) [l, r] = [r, l]
      map = lay.hand.map((_, i) => i)
      lay.groups.L.forEach((lane, i) => (map[lane] = l[i]))
      lay.groups.R.forEach((lane, i) => (map[lane] = r[i]))
    }
    const placed: number[] = []
    for (const n of group) {
      const tries = [map[n.lane], ...lay.siblings[map[n.lane]], n.lane, ...laneOrder(map[n.lane], chart.keys)]
      const lane = tries.find((l) => state.fits(l, t, placed))
      if (lane === undefined) continue
      placed.push(lane)
      out.push({ ...n, lane })
      state.commit(lane, t, n.end)
    }
  }
  return finalize(out, chart.difficulty, chart.bpm, chart.keys)
}

function shuffle(rng: Rng, list: number[]) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

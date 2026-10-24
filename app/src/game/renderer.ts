// DJMAX RESPECT V 느낌의 기어(노트 판) 캔버스 렌더러
// 빠르게 그리기 위해 매 프레임 같은 모양은 미리 그려 둔 이미지(오프스크린 캔버스)를 찍기만 한다:
// 판 배경·키·판정선은 크기가 바뀔 때만, 노트·빛 효과·판정 글자는 처음 쓸 때 한 번 그린다.
// shadowBlur(빛 번짐)는 아주 비싸서 매 프레임에는 쓰지 않는다.
import type { Engine, JudgeEvent, NoteState } from './engine'
import { HANDS, type KeyCount } from './layout'
import type { NoteSkin } from '../lib/skins'

const VOLT = '#ffd23f'
const AQUA = '#3be8ff'
const EMBER = '#ff4d5e'
const RAIL = 14
const HIT_MS = 280
const JUDGE_MS = 450

interface HitFx {
  lane: number
  at: number
  kind: JudgeEvent['kind']
}

/** 기기 픽셀 크기의 오프스크린 캔버스. draw는 CSS 픽셀 좌표로 그린다 */
function layer(cssW: number, cssH: number, dpr: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(cssW * dpr))
  c.height = Math.max(1, Math.ceil(cssH * dpr))
  const ctx = c.getContext('2d')!
  ctx.scale(dpr, dpr)
  draw(ctx)
  return c
}

export class GearRenderer {
  private ctx: CanvasRenderingContext2D
  private w = 0
  private h = 0
  private dpr = 1
  private laneX: number[] = []
  private laneW: number[] = []
  private icon = new Image()
  private hits: HitFx[] = []
  private lastJudge: (JudgeEvent & { at: number }) | null = null
  private comboPopAt = 0
  /** 아직 판정이 끝나지 않은 첫 노트 위치 (지나간 노트는 다시 보지 않는다) */
  private firstLive = 0
  private liveNotes: NoteState[] | null = null
  /** 엄지(가운데 SPACE) 레인: 조금 넓고 노란색 */
  private thumb: boolean[]
  private _labels: string[]
  pressed: boolean[]
  pressAt: number[]

  // 미리 그려 둔 이미지들
  private bodyLayer: HTMLCanvasElement | null = null
  private judgeLayer: HTMLCanvasElement | null = null
  private keysOff: HTMLCanvasElement | null = null
  private keysOn: HTMLCanvasElement | null = null
  private sprites = new Map<string, HTMLCanvasElement>()
  private comboFill: CanvasGradient[] = []

  constructor(
    private canvas: HTMLCanvasElement,
    private skin: NoteSkin,
    public speed: number,
    private beatMs: number,
    private beatLen: number,
    keys: KeyCount,
    /** 레인별 키 이름 (플레이 중 조작 키를 바꾸면 갱신) */
    labels: string[],
  ) {
    this.thumb = HANDS[keys].map((h) => h === 'T')
    this.pressed = Array(keys).fill(false)
    this.pressAt = Array(keys).fill(0)
    this._labels = labels
    this.ctx = canvas.getContext('2d')!
    // 아이콘·글꼴이 늦게 오면 그때 다시 그린다
    this.icon.onload = () => this.sprites.clear()
    this.icon.src = skin.icon
    document.fonts?.ready.then(() => this.buildLayers())
    this.resize()
  }

  get labels() {
    return this._labels
  }

  set labels(v: string[]) {
    this._labels = v
    this.buildKeys()
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = rect.width
    this.h = rect.height
    this.canvas.width = Math.round(rect.width * this.dpr)
    this.canvas.height = Math.round(rect.height * this.dpr)
    const inner = this.w - RAIL * 2
    const ratio = this.thumb.map((t) => (t ? 1.18 : 1))
    const total = ratio.reduce((a, b) => a + b, 0)
    let x = RAIL
    this.laneX = []
    this.laneW = []
    for (const r of ratio) {
      const lw = (inner * r) / total
      this.laneX.push(x)
      this.laneW.push(lw)
      x += lw
    }
    this.buildLayers()
  }

  /** 기어 안의 가로 위치(CSS px)에 있는 레인. 양옆 레일을 눌러도 가장 가까운 레인으로 본다 */
  laneAt(x: number) {
    for (let i = this.laneX.length - 1; i > 0; i--) if (x >= this.laneX[i]) return i
    return 0
  }

  /** 지금 박 안에서의 위치 (0 = 박 시작, 1 직전 = 다음 박 직전). 배경 박자 효과에 쓴다 */
  beatPhase(now: number) {
    const len = this.beatLen
    return ((((now - this.beatMs) % len) + len) % len) / len
  }

  private get judgeY() {
    return this.h * 0.84
  }

  private get pxPerMs() {
    return this.speed * 0.36 * (this.h / 1000)
  }

  private get noteH() {
    return Math.max(14, this.h * 0.019)
  }

  private yOf(noteTime: number, now: number) {
    return this.judgeY - (noteTime - now) * this.pxPerMs
  }

  pushEvents(events: JudgeEvent[], perfNow: number) {
    for (const e of events) {
      this.lastJudge = { ...e, at: perfNow }
      if (e.kind !== 'BREAK') {
        this.hits.push({ lane: e.lane, at: perfNow, kind: e.kind })
        this.comboPopAt = perfNow
      }
    }
  }

  draw(engine: Engine, now: number, perfNow: number, progress: number) {
    const { ctx, w, h, dpr } = this
    if (!w || !h) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    this.drawBody(progress, engine.stats.combo)
    this.drawBeatLines(now)
    this.drawBeams(perfNow)
    this.drawNotes(engine.notes, now)
    ctx.drawImage(this.judgeLayer!, 0, 0, w, h)
    this.drawHits(perfNow)
    this.drawKeys()
    this.drawCombo(engine.stats.combo, perfNow)
  }

  // ---------- 미리 그리기 ----------

  private buildLayers() {
    if (!this.w || !this.h) return
    const { w, h, dpr } = this
    this.sprites.clear()
    this.bodyLayer = layer(w, h, dpr, (c) => this.paintBody(c))
    this.judgeLayer = layer(w, h, dpr, (c) => {
      c.shadowColor = VOLT
      c.shadowBlur = 18
      c.fillStyle = VOLT
      c.fillRect(RAIL, this.judgeY - 2, w - RAIL * 2, 4)
      c.shadowBlur = 0
      c.fillStyle = 'rgba(255,255,255,0.9)'
      c.fillRect(RAIL, this.judgeY - 0.5, w - RAIL * 2, 1)
    })
    this.comboFill = [false, true].map((hundred) => {
      const g = this.ctx.createLinearGradient(0, -h * 0.08, 0, 0)
      g.addColorStop(0, '#ffffff')
      g.addColorStop(1, hundred ? VOLT : '#a9d8ff')
      return g
    })
    this.buildKeys()
  }

  private paintBody(ctx: CanvasRenderingContext2D) {
    const { w, h } = this
    // 판 배경
    const bg = ctx.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, 'rgba(6,9,26,0.55)')
    bg.addColorStop(0.7, 'rgba(6,9,26,0.88)')
    bg.addColorStop(1, 'rgba(3,4,12,0.96)')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    // 엄지 레인은 노란 기운
    ctx.fillStyle = 'rgba(255,210,63,0.05)'
    this.thumb.forEach((t, i) => t && ctx.fillRect(this.laneX[i], 0, this.laneW[i], h))

    // 레인 구분선
    ctx.strokeStyle = 'rgba(160,175,230,0.13)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < this.laneX.length; i++) {
      const x = Math.round(this.laneX[i]) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, this.judgeY)
    }
    ctx.stroke()

    // 양옆 레일 (밝기 선은 콤보에 따라 매 프레임 그린다)
    for (const side of [0, 1]) {
      const x = side === 0 ? 0 : w - RAIL
      const rg = ctx.createLinearGradient(x, 0, x + RAIL, 0)
      rg.addColorStop(side === 0 ? 0 : 1, '#141a3a')
      rg.addColorStop(side === 0 ? 1 : 0, '#2a3366')
      ctx.fillStyle = rg
      ctx.fillRect(x, 0, RAIL, h)
    }
  }

  /** 키 판: 모두 뗀 모양 / 모두 누른 모양 두 장. 누른 레인만 두 번째에서 잘라 덮는다 */
  private buildKeys() {
    if (!this.w || !this.h) return
    this.keysOff = layer(this.w, this.h, this.dpr, (c) => this.paintKeys(c, false))
    this.keysOn = layer(this.w, this.h, this.dpr, (c) => this.paintKeys(c, true))
  }

  private paintKeys(ctx: CanvasRenderingContext2D, on: boolean) {
    const { h } = this
    const y0 = this.judgeY + 10
    for (let i = 0; i < this.laneX.length; i++) {
      const x = this.laneX[i] + 4
      const lw = this.laneW[i] - 8
      const g = ctx.createLinearGradient(0, y0, 0, h - 10)
      g.addColorStop(0, on ? (this.thumb[i] ? '#ffe680' : '#bfe9ff') : '#232a52')
      g.addColorStop(1, on ? (this.thumb[i] ? '#c99a00' : '#3b7bd6') : '#0d1130')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.roundRect(x, y0, lw, h - y0 - 12, 6)
      ctx.fill()
      ctx.fillStyle = on ? '#0b1030' : 'rgba(220,228,255,0.75)'
      const label = this._labels[i] ?? ''
      // 긴 키 이름(SPACE, LCTRL…)은 레인 폭에 맞춰 줄인다
      const size = Math.min(26, h * 0.028, (lw * 1.6) / Math.max(1, label.length))
      ctx.font = `600 ${Math.round(size)}px Teko, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, this.laneX[i] + this.laneW[i] / 2, (y0 + h - 12) / 2 + 2)
    }
  }

  /** 한 번 그려 두고 다시 쓰는 작은 이미지 */
  private sprite(key: string, cssW: number, cssH: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    let s = this.sprites.get(key)
    if (!s) {
      s = layer(cssW, cssH, this.dpr, draw)
      this.sprites.set(key, s)
    }
    return s
  }

  /** 노트 하나 (빛 번짐 포함). 가운데가 (pad + lw/2, pad + size/2) */
  private noteSprite(lw: number) {
    const { skin } = this
    const nh = this.noteH
    const s = nh * 1.55
    const pad = 16
    const cw = lw + pad * 2
    const ch = Math.max(nh, s) + pad * 2
    const ready = this.icon.complete && this.icon.naturalWidth > 0
    const img = this.sprite(`note:${Math.round(lw * 10)}:${ready}`, cw, ch, (ctx) => {
      const cy = ch / 2
      const bx = pad + 3
      const bw = lw - 6
      const by = cy - nh / 2
      ctx.shadowColor = skin.glow
      ctx.shadowBlur = 12
      const g = ctx.createLinearGradient(0, by, 0, by + nh)
      g.addColorStop(0, skin.top)
      g.addColorStop(1, skin.bottom)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.roundRect(bx, by, bw, nh, 3)
      ctx.fill()
      ctx.shadowBlur = 0
      // 위쪽 하이라이트 + 가운데 띠
      ctx.fillStyle = skin.edge
      ctx.fillRect(bx + 2, by + 1.5, bw - 4, 2)
      ctx.globalAlpha = 0.55
      ctx.fillRect(bx + 2, by + nh / 2 - 0.5, bw - 4, 1)
      ctx.globalAlpha = 1
      // 볼 아이콘 (픽셀 아트라 부드럽게 늘리지 않는다)
      if (ready) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(this.icon, pad + lw / 2 - s / 2, cy - s / 2, s, s)
      }
    })
    return { img, cw, ch, pad }
  }

  // ---------- 매 프레임 ----------

  private drawBody(progress: number, combo: number) {
    const { ctx, w, h } = this
    ctx.drawImage(this.bodyLayer!, 0, 0, w, h)
    // 양옆 레일 네온: 콤보가 쌓일수록 밝아진다
    const glow = Math.min(1, combo / 100)
    ctx.fillStyle = `rgba(59,232,255,${0.25 + glow * 0.6})`
    ctx.fillRect(RAIL - 2, 0, 2, h)
    ctx.fillRect(w - RAIL, 0, 2, h)
    // 오른쪽 레일 = 곡 진행도
    ctx.fillStyle = VOLT
    ctx.fillRect(w - 10, h * (1 - progress), 6, h * progress)
  }

  private drawBeatLines(now: number) {
    const { ctx } = this
    const bar = this.beatLen * 4
    const top = now + this.judgeY / this.pxPerMs
    let t = this.beatMs + Math.ceil((now - 200 - this.beatMs) / bar) * bar
    ctx.strokeStyle = 'rgba(200,210,255,0.16)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (; t < top; t += bar) {
      const y = Math.round(this.yOf(t, now)) + 0.5
      if (y > this.judgeY) continue
      ctx.moveTo(RAIL, y)
      ctx.lineTo(this.w - RAIL, y)
    }
    ctx.stroke()
  }

  private drawBeams(perfNow: number) {
    const { ctx } = this
    const bh = this.h * 0.45
    for (let i = 0; i < this.laneX.length; i++) {
      const fade = this.pressed[i] ? 1 : Math.max(0, 1 - (perfNow - this.pressAt[i]) / 140)
      if (fade <= 0) continue
      const lw = this.laneW[i]
      const img = this.sprite(`beam:${this.thumb[i]}:${Math.round(lw * 10)}`, lw, bh, (c) => {
        const g = c.createLinearGradient(0, bh, 0, 0)
        const rgb = this.thumb[i] ? '255,210,63' : '120,200,255'
        g.addColorStop(0, `rgba(${rgb},0.42)`)
        g.addColorStop(1, `rgba(${rgb},0)`)
        c.fillStyle = g
        c.fillRect(0, 0, lw, bh)
      })
      ctx.globalAlpha = fade
      ctx.drawImage(img, this.laneX[i], this.judgeY - bh, lw, bh)
    }
    ctx.globalAlpha = 1
  }

  private noteBar(x: number, y: number, lw: number, alpha = 1) {
    const { img, cw, ch, pad } = this.noteSprite(lw)
    this.ctx.globalAlpha = alpha
    this.ctx.drawImage(img, x - pad, y - ch / 2, cw, ch)
    this.ctx.globalAlpha = 1
  }

  private drawNotes(notes: NoteState[], now: number) {
    const { ctx } = this
    // 앞쪽에서 판정이 끝난 노트는 다음 프레임부터 건너뛴다 (처음부터 다시 하면 새 엔진이라 처음부터)
    if (notes !== this.liveNotes) {
      this.liveNotes = notes
      this.firstLive = 0
    }
    while (this.firstLive < notes.length && notes[this.firstLive].done) this.firstLive++
    const top = now + (this.judgeY + 40) / this.pxPerMs
    for (let i = this.firstLive; i < notes.length; i++) {
      const s = notes[i]
      const n = s.note
      if (n.time > top) break
      if (s.done) continue
      const x = this.laneX[n.lane]
      const lw = this.laneW[n.lane]
      if (n.end > n.time) {
        const yHead = s.holding ? this.judgeY : this.yOf(n.time, now)
        const yTail = this.yOf(n.end, now)
        if (yHead < -20) continue
        const g = ctx.createLinearGradient(0, yTail, 0, yHead)
        g.addColorStop(0, hexA(this.skin.glow, s.holding ? 0.55 : 0.3))
        g.addColorStop(1, hexA(this.skin.top, s.holding ? 0.85 : 0.5))
        ctx.fillStyle = g
        ctx.fillRect(x + lw * 0.18, yTail, lw * 0.64, Math.max(0, yHead - yTail))
        this.noteBar(x, yTail, lw, 0.85)
        this.noteBar(x, yHead, lw)
      } else {
        const y = this.yOf(n.time, now)
        if (y < -20 || y > this.h + 20) continue
        this.noteBar(x, y, lw)
      }
    }
  }

  private drawHits(perfNow: number) {
    const { ctx } = this
    // 끝난 효과는 제자리에서 지운다 (매 프레임 새 배열을 만들지 않게)
    let n = 0
    for (const hfx of this.hits) if (perfNow - hfx.at < HIT_MS) this.hits[n++] = hfx
    this.hits.length = n
    for (const hfx of this.hits) {
      const p = (perfNow - hfx.at) / HIT_MS
      const lw = this.laneW[hfx.lane]
      const cx = this.laneX[hfx.lane] + lw / 2
      const color = hfx.kind === 'MAX' ? AQUA : VOLT
      ctx.globalAlpha = 1 - p
      ctx.strokeStyle = color
      ctx.lineWidth = 3 * (1 - p) + 1
      ctx.beginPath()
      ctx.ellipse(cx, this.judgeY, lw * (0.35 + p * 0.5), 14 + p * 26, 0, 0, Math.PI * 2)
      ctx.stroke()
      const flash = this.sprite(`flash:${color}:${Math.round(lw * 10)}`, lw * 2, 120, (c) => {
        const fl = c.createRadialGradient(lw, 60, 0, lw, 60, lw * 0.7)
        fl.addColorStop(0, hexA(color, 0.8))
        fl.addColorStop(1, hexA(color, 0))
        c.fillStyle = fl
        c.fillRect(0, 0, lw * 2, 120)
      })
      ctx.globalAlpha = (1 - p) * (1 - p)
      ctx.drawImage(flash, cx - lw, this.judgeY - 60, lw * 2, 120)
    }
    ctx.globalAlpha = 1
  }

  private drawKeys() {
    const { ctx, dpr, h } = this
    const y0 = Math.floor(this.judgeY)
    ctx.drawImage(this.keysOff!, 0, y0 * dpr, this.keysOff!.width, this.keysOff!.height - y0 * dpr, 0, y0, this.w, h - y0)
    for (let i = 0; i < this.laneX.length; i++) {
      if (!this.pressed[i]) continue
      const x = Math.floor(this.laneX[i])
      const lw = Math.ceil(this.laneW[i])
      ctx.drawImage(this.keysOn!, x * dpr, y0 * dpr, lw * dpr, (h - y0) * dpr, x, y0, lw, h - y0)
    }
  }

  /** 판정 글자 (빛 번짐 포함) */
  private judgeSprite(label: string, color: string, size: number) {
    const font = `700 ${size}px Teko, sans-serif`
    const pad = 20
    this.ctx.font = font
    const tw = this.ctx.measureText(label).width
    const cw = tw + pad * 2
    const ch = size + pad * 2
    const img = this.sprite(`judge:${label}:${color}:${size}`, cw, ch, (c) => {
      c.font = font
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.shadowColor = color
      c.shadowBlur = 16
      c.fillStyle = color
      c.fillText(label, cw / 2, ch / 2)
    })
    return { img, cw, ch }
  }

  private drawCombo(combo: number, perfNow: number) {
    const { ctx, w, h } = this
    const cx = w / 2
    const cy = h * 0.3
    if (combo >= 2) {
      const pop = Math.max(0, 1 - (perfNow - this.comboPopAt) / 120)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = 'rgba(200,215,255,0.7)'
      ctx.font = `500 ${Math.round(h * 0.026)}px Teko, sans-serif`
      ctx.fillText('COMBO', cx, cy - h * 0.075)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(1 + pop * 0.12, 1 + pop * 0.12)
      ctx.font = `700 ${Math.round(h * 0.11)}px Teko, sans-serif`
      ctx.lineWidth = 5
      ctx.strokeStyle = 'rgba(5,8,25,0.8)'
      const text = String(combo)
      ctx.strokeText(text, 0, 0)
      ctx.fillStyle = this.comboFill[combo >= 100 ? 1 : 0]
      ctx.fillText(text, 0, 0)
      ctx.restore()
    }
    const j = this.lastJudge
    if (j && perfNow - j.at < JUDGE_MS) {
      const age = (perfNow - j.at) / JUDGE_MS
      ctx.globalAlpha = 1 - age * age
      const color = j.kind === 'MAX' ? AQUA : j.kind === 'BREAK' ? EMBER : VOLT
      const size = Math.round(h * 0.048)
      const { img, cw, ch } = this.judgeSprite(j.label, color, size)
      // 원래 글자 기준선(alphabetic) 위치에 맞춘다: 글자 높이의 약 35% 위가 가운데
      ctx.drawImage(img, cx - cw / 2, cy + h * 0.065 - age * 6 - size * 0.35 - ch / 2, cw, ch)
      if (j.kind === 'GOOD') {
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.font = `500 ${Math.round(h * 0.022)}px Teko, sans-serif`
        ctx.fillStyle = 'rgba(230,236,255,0.8)'
        ctx.fillText(j.delta < 0 ? 'FAST' : 'SLOW', cx, cy + h * 0.095)
      }
      ctx.globalAlpha = 1
    }
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

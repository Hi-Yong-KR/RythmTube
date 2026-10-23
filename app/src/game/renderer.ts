// DJMAX RESPECT V 느낌의 기어(노트 판) 캔버스 렌더러
import type { Engine, JudgeEvent } from './engine'
import { HANDS, type KeyCount } from './layout'
import type { NoteSkin } from '../lib/skins'

const VOLT = '#ffd23f'
const AQUA = '#3be8ff'
const EMBER = '#ff4d5e'

interface HitFx {
  lane: number
  at: number
  kind: JudgeEvent['kind']
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
  /** 엄지(가운데 SPACE) 레인: 조금 넓고 노란색 */
  private thumb: boolean[]
  pressed: boolean[]
  pressAt: number[]

  constructor(
    private canvas: HTMLCanvasElement,
    private skin: NoteSkin,
    public speed: number,
    private beatMs: number,
    private beatLen: number,
    keys: KeyCount,
    /** 레인별 키 이름 (플레이 중 조작 키를 바꾸면 갱신) */
    public labels: string[],
  ) {
    this.thumb = HANDS[keys].map((h) => h === 'T')
    this.pressed = Array(keys).fill(false)
    this.pressAt = Array(keys).fill(0)
    this.ctx = canvas.getContext('2d')!
    this.icon.src = skin.icon
    this.resize()
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = rect.width
    this.h = rect.height
    this.canvas.width = Math.round(rect.width * this.dpr)
    this.canvas.height = Math.round(rect.height * this.dpr)
    const rail = 14
    const inner = this.w - rail * 2
    const ratio = this.thumb.map((t) => (t ? 1.18 : 1))
    const total = ratio.reduce((a, b) => a + b, 0)
    let x = rail
    this.laneX = []
    this.laneW = []
    for (const r of ratio) {
      const lw = (inner * r) / total
      this.laneX.push(x)
      this.laneW.push(lw)
      x += lw
    }
  }

  private get judgeY() {
    return this.h * 0.84
  }

  private get pxPerMs() {
    return this.speed * 0.36 * (this.h / 1000)
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    this.drawBody(progress, engine.stats.combo)
    this.drawBeatLines(now)
    this.drawBeams(perfNow)
    this.drawNotes(engine, now)
    this.drawJudgeLine()
    this.drawHits(perfNow)
    this.drawKeys()
    this.drawCombo(engine.stats.combo, perfNow)
  }

  private drawBody(progress: number, combo: number) {
    const { ctx, w, h } = this
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
    for (let i = 1; i < this.laneX.length; i++) {
      const x = Math.round(this.laneX[i]) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, this.judgeY)
      ctx.stroke()
    }

    // 양옆 레일: 콤보가 쌓일수록 밝아지는 네온
    const glow = Math.min(1, combo / 100)
    for (const side of [0, 1]) {
      const x = side === 0 ? 0 : w - 14
      const rg = ctx.createLinearGradient(x, 0, x + 14, 0)
      rg.addColorStop(side === 0 ? 0 : 1, '#141a3a')
      rg.addColorStop(side === 0 ? 1 : 0, '#2a3366')
      ctx.fillStyle = rg
      ctx.fillRect(x, 0, 14, h)
      ctx.fillStyle = `rgba(59,232,255,${0.25 + glow * 0.6})`
      ctx.fillRect(side === 0 ? 12 : w - 14, 0, 2, h)
    }
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
    for (; t < top; t += bar) {
      const y = Math.round(this.yOf(t, now)) + 0.5
      if (y > this.judgeY) continue
      ctx.beginPath()
      ctx.moveTo(14, y)
      ctx.lineTo(this.w - 14, y)
      ctx.stroke()
    }
  }

  private drawBeams(perfNow: number) {
    const { ctx } = this
    for (let i = 0; i < this.laneX.length; i++) {
      const fade = this.pressed[i] ? 1 : Math.max(0, 1 - (perfNow - this.pressAt[i]) / 140)
      if (fade <= 0) continue
      const x = this.laneX[i]
      const lw = this.laneW[i]
      const g = ctx.createLinearGradient(0, this.judgeY, 0, this.judgeY - this.h * 0.45)
      const c = this.thumb[i] ? '255,210,63' : '120,200,255'
      g.addColorStop(0, `rgba(${c},${0.42 * fade})`)
      g.addColorStop(1, `rgba(${c},0)`)
      ctx.fillStyle = g
      ctx.fillRect(x, this.judgeY - this.h * 0.45, lw, this.h * 0.45)
    }
  }

  private noteBar(x: number, y: number, lw: number, alpha = 1) {
    const { ctx, skin } = this
    const nh = Math.max(14, this.h * 0.019)
    const pad = 3
    const bx = x + pad
    const bw = lw - pad * 2
    const by = y - nh / 2
    ctx.globalAlpha = alpha
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
    ctx.globalAlpha = alpha * 0.55
    ctx.fillRect(bx + 2, by + nh / 2 - 0.5, bw - 4, 1)
    ctx.globalAlpha = alpha
    // 볼 아이콘
    if (this.icon.complete && this.icon.naturalWidth) {
      const s = nh * 1.55
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(this.icon, x + lw / 2 - s / 2, y - s / 2, s, s)
      ctx.imageSmoothingEnabled = true
    }
    ctx.globalAlpha = 1
  }

  private drawNotes(engine: Engine, now: number) {
    const { ctx } = this
    const top = now + (this.judgeY + 40) / this.pxPerMs
    for (const s of engine.notes) {
      const n = s.note
      if (n.time > top) break
      if (s.done && !s.holding) continue
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

  private drawJudgeLine() {
    const { ctx, w } = this
    const y = this.judgeY
    ctx.shadowColor = VOLT
    ctx.shadowBlur = 18
    ctx.fillStyle = VOLT
    ctx.fillRect(14, y - 2, w - 28, 4)
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillRect(14, y - 0.5, w - 28, 1)
  }

  private drawHits(perfNow: number) {
    const { ctx } = this
    this.hits = this.hits.filter((hfx) => perfNow - hfx.at < 280)
    for (const hfx of this.hits) {
      const p = (perfNow - hfx.at) / 280
      const cx = this.laneX[hfx.lane] + this.laneW[hfx.lane] / 2
      const color = hfx.kind === 'MAX' ? AQUA : VOLT
      ctx.globalAlpha = 1 - p
      ctx.strokeStyle = color
      ctx.lineWidth = 3 * (1 - p) + 1
      ctx.beginPath()
      ctx.ellipse(cx, this.judgeY, this.laneW[hfx.lane] * (0.35 + p * 0.5), 14 + p * 26, 0, 0, Math.PI * 2)
      ctx.stroke()
      const fl = ctx.createRadialGradient(cx, this.judgeY, 0, cx, this.judgeY, this.laneW[hfx.lane] * 0.7)
      fl.addColorStop(0, hexA(color, 0.8 * (1 - p)))
      fl.addColorStop(1, hexA(color, 0))
      ctx.fillStyle = fl
      ctx.fillRect(cx - this.laneW[hfx.lane], this.judgeY - 60, this.laneW[hfx.lane] * 2, 120)
      ctx.globalAlpha = 1
    }
  }

  private drawKeys() {
    const { ctx, h } = this
    const y0 = this.judgeY + 10
    for (let i = 0; i < this.laneX.length; i++) {
      const x = this.laneX[i] + 4
      const lw = this.laneW[i] - 8
      const on = this.pressed[i]
      const g = ctx.createLinearGradient(0, y0, 0, h - 10)
      g.addColorStop(0, on ? (this.thumb[i] ? '#ffe680' : '#bfe9ff') : '#232a52')
      g.addColorStop(1, on ? (this.thumb[i] ? '#c99a00' : '#3b7bd6') : '#0d1130')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.roundRect(x, y0, lw, h - y0 - 12, 6)
      ctx.fill()
      ctx.fillStyle = on ? '#0b1030' : 'rgba(220,228,255,0.75)'
      const label = this.labels[i] ?? ''
      // 긴 키 이름(SPACE, LCTRL…)은 레인 폭에 맞춰 줄인다
      const size = Math.min(26, h * 0.028, (lw * 1.6) / Math.max(1, label.length))
      ctx.font = `600 ${Math.round(size)}px Teko, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, this.laneX[i] + this.laneW[i] / 2, (y0 + h - 12) / 2 + 2)
    }
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
      ctx.strokeText(String(combo), 0, 0)
      const cg = ctx.createLinearGradient(0, -h * 0.08, 0, 0)
      cg.addColorStop(0, '#ffffff')
      cg.addColorStop(1, combo >= 100 ? VOLT : '#a9d8ff')
      ctx.fillStyle = cg
      ctx.fillText(String(combo), 0, 0)
      ctx.restore()
    }
    const j = this.lastJudge
    if (j && perfNow - j.at < 450) {
      const age = (perfNow - j.at) / 450
      ctx.globalAlpha = 1 - age * age
      ctx.textAlign = 'center'
      ctx.font = `700 ${Math.round(h * 0.048)}px Teko, sans-serif`
      const color = j.kind === 'MAX' ? AQUA : j.kind === 'BREAK' ? EMBER : VOLT
      ctx.shadowColor = color
      ctx.shadowBlur = 16
      ctx.fillStyle = color
      ctx.fillText(j.label, cx, cy + h * 0.065 - age * 6)
      ctx.shadowBlur = 0
      if (j.kind === 'GOOD') {
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

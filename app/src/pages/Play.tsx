import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import type { PlayRequest } from '../components/SongDetail'
import { DIFFICULTIES, generateChart, KEY_TO_LANE, LANE_KEYS, randomizeChart, type Chart } from '../game/chart'
import { SongClock } from '../game/clock'
import { Engine, type PlayResult } from '../game/engine'
import { GearRenderer } from '../game/renderer'
import { getSettings, getSongSync, updateSettings } from '../lib/settings'
import { BACKGROUNDS, DEFAULT_BG, DEFAULT_NOTE, NOTES } from '../lib/skins'
import { useWallet } from '../lib/wallet'
import { embedErrorMessage, loadYouTubeApi, YT_STATE } from '../lib/youtube'

type Phase = 'loading' | 'ready' | 'playing' | 'paused' | 'error'

// 방향키: ↑↓ 속도 ±0.1, ←→ 싱크 ∓5ms
const TUNE_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0.1, 0],
  ArrowDown: [-0.1, 0],
  ArrowLeft: [0, -5],
  ArrowRight: [0, 5],
}

function TunePanel({ tune, adjust }: { tune: { speed: number; offsetMs: number }; adjust: (dSpeed: number, dOffset: number) => void }) {
  return (
    <div className="tune">
      <div className="opt">
        <span>노트 속도 (↑ ↓)</span>
        <div className="stepper">
          <button onClick={() => adjust(-0.1, 0)} aria-label="속도 낮추기">
            −
          </button>
          <b className="num">x{tune.speed.toFixed(1)}</b>
          <button onClick={() => adjust(0.1, 0)} aria-label="속도 높이기">
            +
          </button>
        </div>
      </div>
      <div className="opt">
        <span>싱크 (← →)</span>
        <div className="stepper">
          <button onClick={() => adjust(0, -5)} aria-label="노트를 더 일찍">
            −
          </button>
          <b className="num">
            {tune.offsetMs > 0 ? '+' : ''}
            {tune.offsetMs}ms
          </b>
          <button onClick={() => adjust(0, 5)} aria-label="노트를 더 늦게">
            +
          </button>
        </div>
      </div>
      <p className="tune-hint">노트가 음악보다 빨리 오면 +, 늦게 오면 − 쪽으로 맞춰 주세요.</p>
    </div>
  )
}

function readRequest(state: unknown): PlayRequest | null {
  if (state && (state as PlayRequest).song) return state as PlayRequest
  try {
    return JSON.parse(sessionStorage.getItem('rt.play') ?? 'null')
  } catch {
    return null
  }
}

export default function Play() {
  const location = useLocation()
  const req = readRequest(location.state)
  if (!req) return <Navigate to="/" replace />
  return <PlayInner req={req} />
}

function PlayInner({ req }: { req: PlayRequest }) {
  const navigate = useNavigate()
  const { wallet } = useWallet()
  const settings = getSettings()
  const owned = (id: string) => !wallet || wallet.owned.includes(id)
  const bgId = BACKGROUNDS[settings.background] && owned(settings.background) ? settings.background : DEFAULT_BG
  const noteId = NOTES[settings.note] && owned(settings.note) ? settings.note : DEFAULT_NOTE
  const bg = BACKGROUNDS[bgId]
  const diff = DIFFICULTIES.find((d) => d.id === req.difficulty)!

  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [chartInfo, setChartInfo] = useState<Chart | null>(null)
  const phaseRef = useRef<Phase>('loading')
  // 플레이 중에도 바꿀 수 있는 값 (렌더 루프·입력 핸들러가 ref로 읽는다)
  const offsetRef = useRef(settings.offsetMs)
  const [tune, setTune] = useState({ speed: settings.speed, offsetMs: settings.offsetMs })
  const [tuneFlash, setTuneFlash] = useState<string | null>(null)
  const flashTimer = useRef(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const scoreRef = useRef<HTMLSpanElement>(null)
  const accRef = useRef<HTMLSpanElement>(null)
  const maxComboRef = useRef<HTMLSpanElement>(null)
  const game = useRef<{
    player: any
    clock: SongClock
    engine: Engine
    renderer: GearRenderer
    finished: boolean
  } | null>(null)

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  // 플레이어 + 채보 준비
  useEffect(() => {
    let disposed = false
    let player: any
    loadYouTubeApi().then((YT) => {
      if (disposed || !hostRef.current) return
      const el = document.createElement('div')
      hostRef.current.appendChild(el)
      player = new YT.Player(el, {
        videoId: req.song.videoId,
        playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: (e: any) => {
            if (disposed) return
            const durationMs = (e.target.getDuration() || req.song.duration) * 1000
            const sync = getSongSync(req.song.videoId) ?? { bpm: req.song.bpmHint, beatMs: 0 }
            let chart = generateChart({ videoId: req.song.videoId, difficulty: req.difficulty, bpm: sync.bpm, beatMs: sync.beatMs, durationMs })
            if (settings.random) chart = randomizeChart(chart, (Math.random() * 2 ** 32) >>> 0)
            const canvas = canvasRef.current!
            game.current = {
              player: e.target,
              clock: new SongClock(e.target),
              engine: new Engine(chart),
              renderer: new GearRenderer(canvas, NOTES[noteId], settings.speed, sync.beatMs, 60000 / sync.bpm),
              finished: false,
            }
            setChartInfo(chart)
            setPhaseBoth('ready')
          },
          onStateChange: (e: any) => {
            const g = game.current
            if (!g) return
            if (e.data === YT_STATE.PLAYING) g.clock.start()
            else g.clock.stop()
            if (e.data === YT_STATE.ENDED) finish()
          },
          onError: (e: any) => {
            setError(embedErrorMessage(e.data))
            setPhaseBoth('error')
          },
        },
      })
    })
    return () => {
      disposed = true
      player?.destroy?.()
      game.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function finish() {
    const g = game.current
    if (!g || g.finished) return
    g.finished = true
    g.player.pauseVideo?.()
    const e = g.engine
    // 남은 노트는 모두 BREAK 처리
    e.update(Number.MAX_SAFE_INTEGER)
    const result: PlayResult = {
      videoId: req.song.videoId,
      title: req.song.title,
      channel: req.song.channel,
      thumbnail: req.song.thumbnail,
      difficulty: req.difficulty,
      level: e.chart.level,
      bpm: Math.round(e.chart.bpm),
      random: settings.random,
      score: e.score,
      accuracy: Math.round(e.accuracy * 100) / 100,
      maxCombo: e.stats.maxCombo,
      counts: e.stats.counts,
      early: e.stats.early,
      late: e.stats.late,
      judgeCount: e.chart.judgeCount,
      avgDelta: e.stats.deltaCount >= 20 ? Math.round(e.stats.deltaSum / e.stats.deltaCount) : 0,
    }
    sessionStorage.setItem('rt.result', JSON.stringify(result))
    navigate('/result', { state: result, replace: true })
  }

  // 게임 루프
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const g = game.current
      if (!g) return
      const perf = performance.now()
      const now = (phaseRef.current === 'playing' ? g.clock.tick(perf) : g.clock.at(perf)) - offsetRef.current
      if (phaseRef.current === 'playing') {
        g.engine.update(now)
        if (now > g.engine.chart.lastTime + 2500) finish()
      }
      g.renderer.pushEvents(g.engine.drainEvents(), perf)
      const dur = (g.player.getDuration?.() || 1) * 1000
      g.renderer.draw(g.engine, now, perf, Math.min(1, Math.max(0, now / dur)))
      if (scoreRef.current) scoreRef.current.textContent = g.engine.score.toLocaleString().padStart(9, ' ')
      if (accRef.current) accRef.current.textContent = g.engine.accuracy.toFixed(2)
      if (maxComboRef.current) maxComboRef.current.textContent = String(g.engine.stats.maxCombo)
    }
    raf = requestAnimationFrame(loop)
    const onResize = () => game.current?.renderer.resize()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 속도(dSpeed)·싱크(dOffset) 조절. 바로 적용되고 다음 플레이에도 유지된다 */
  function adjust(dSpeed: number, dOffset: number) {
    const speed = Math.min(6, Math.max(1, +(getSettings().speed + dSpeed).toFixed(1)))
    const offsetMs = Math.min(300, Math.max(-300, getSettings().offsetMs + dOffset))
    updateSettings({ speed, offsetMs })
    offsetRef.current = offsetMs
    if (game.current) game.current.renderer.speed = speed
    setTune({ speed, offsetMs })
    setTuneFlash(dSpeed ? `SPEED x${speed.toFixed(1)}` : `SYNC ${offsetMs > 0 ? '+' : ''}${offsetMs}ms`)
    clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setTuneFlash(null), 900)
  }

  function begin() {
    const g = game.current
    if (!g) return
    g.player.playVideo()
    setPhaseBoth('playing')
  }

  function pause() {
    const g = game.current
    if (!g || phaseRef.current !== 'playing') return
    g.player.pauseVideo()
    setPhaseBoth('paused')
  }

  function restart() {
    const g = game.current
    if (!g) return
    g.player.seekTo(0, true)
    g.player.pauseVideo()
    g.engine = new Engine(g.engine.chart)
    g.finished = false
    setPhaseBoth('ready')
  }

  // 입력
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = game.current
      if (e.code === 'Escape') {
        e.preventDefault()
        if (phaseRef.current === 'playing') pause()
        else if (phaseRef.current === 'paused') begin()
        return
      }
      const tuneKey = TUNE_KEYS[e.code]
      if (tuneKey) {
        e.preventDefault()
        adjust(tuneKey[0], tuneKey[1])
        return
      }
      const lane = KEY_TO_LANE[e.code]
      if (lane === undefined) return
      e.preventDefault()
      if (e.repeat || !g) return
      if (phaseRef.current === 'ready' && e.code === 'Space') {
        begin()
        return
      }
      if (phaseRef.current !== 'playing') return
      g.renderer.pressed[lane] = true
      g.renderer.pressAt[lane] = performance.now()
      g.engine.press(lane, g.clock.at(e.timeStamp) - offsetRef.current)
    }
    const up = (e: KeyboardEvent) => {
      const lane = KEY_TO_LANE[e.code]
      const g = game.current
      if (lane === undefined || !g) return
      g.renderer.pressed[lane] = false
      g.renderer.pressAt[lane] = performance.now()
      if (phaseRef.current === 'playing') g.engine.release(lane, g.clock.at(e.timeStamp) - offsetRef.current)
    }
    const blur = () => pause()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="play">
      <div className="play-bg" style={{ backgroundImage: `url(${bg.image})` }} aria-hidden />
      <div className="play-dim" style={{ opacity: bg.dim }} aria-hidden />

      <section className="hud-left">
        <div className="hud-song">
          <img src={req.song.thumbnail} alt="" />
          <div>
            <p className="hud-title">{req.song.title}</p>
            <p className="hud-channel">{req.song.channel}</p>
          </div>
        </div>
        <div className="hud-diff" style={{ ['--diff' as string]: diff.color }}>
          <span className="num">{diff.id}</span>
          <b className="num">{chartInfo?.level ?? '-'}</b>
          {settings.random && <em className="num">RANDOM</em>}
        </div>
        <dl className="hud-stats">
          <div>
            <dt>SCORE</dt>
            <dd className="num score">
              <span ref={scoreRef}>0</span>
            </dd>
          </div>
          <div>
            <dt>RATE</dt>
            <dd className="num">
              <span ref={accRef}>100.00</span>%
            </dd>
          </div>
          <div>
            <dt>MAX COMBO</dt>
            <dd className="num">
              <span ref={maxComboRef}>0</span>
            </dd>
          </div>
          <div>
            <dt>NOTES · BPM</dt>
            <dd className="num">
              {chartInfo ? `${chartInfo.notes.length} · ${Math.round(chartInfo.bpm)}` : '-'}
            </dd>
          </div>
          <div>
            <dt>SPEED · SYNC</dt>
            <dd className="num">
              x{tune.speed.toFixed(1)} · {tune.offsetMs > 0 ? '+' : ''}
              {tune.offsetMs}ms
            </dd>
          </div>
        </dl>
      </section>

      <div className="gear-wrap">
        <canvas ref={canvasRef} className="gear" />
        {tuneFlash && <p className="tune-flash num">{tuneFlash}</p>}
      </div>

      <section className="hud-right">
        <div className="bga" ref={hostRef} />
        <img className="hud-mascot" src={bg.mascot} alt="" />
        <p className="hud-help">
          <kbd>↑</kbd>
          <kbd>↓</kbd> 속도 · <kbd>←</kbd>
          <kbd>→</kbd> 싱크 · <kbd>ESC</kbd> 일시정지
        </p>
      </section>

      {phase !== 'playing' && (
        <div className="overlay">
          {phase === 'loading' && <p className="overlay-msg">곡과 채보를 준비하고 있어요…</p>}
          {phase === 'ready' && (
            <div className="overlay-card">
              <p className="overlay-kicker num">{diff.label}</p>
              <h2>{req.song.title}</h2>
              <p className="overlay-keys">
                {LANE_KEYS.map((k) => (
                  <kbd key={k} className={k === 'SPACE' ? 'wide' : ''}>
                    {k}
                  </kbd>
                ))}
              </p>
              <TunePanel tune={tune} adjust={adjust} />
              <button className="start" onClick={begin}>
                <span>시작하기</span>
                <small>SPACE를 눌러도 시작돼요</small>
              </button>
            </div>
          )}
          {phase === 'paused' && (
            <div className="overlay-card">
              <h2>일시정지</h2>
              <TunePanel tune={tune} adjust={adjust} />
              <div className="overlay-actions">
                <button className="start" onClick={begin}>
                  <span>계속하기</span>
                  <small>ESC</small>
                </button>
                <button className="ghost" onClick={restart}>
                  처음부터
                </button>
                <button className="ghost" onClick={() => navigate('/')}>
                  곡 선택으로
                </button>
              </div>
            </div>
          )}
          {phase === 'error' && (
            <div className="overlay-card">
              <h2>재생할 수 없어요</h2>
              <p>{error}</p>
              <button className="start" onClick={() => navigate('/')}>
                <span>곡 선택으로</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

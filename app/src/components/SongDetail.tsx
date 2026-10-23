import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DIFFICULTIES, generateChart, type Difficulty } from '../game/chart'
import { SongClock } from '../game/clock'
import type { KeyCount } from '../game/layout'
import KeySettings from './KeySettings'
import RankList from './RankList'
import VolumeOpt from './VolumeOpt'
import { fetchRanking, type MyRank, type RankingRow } from '../lib/supabase'
import { getSettings, getSongSync, setSongSync, updateSettings, useSettings } from '../lib/settings'
import { useWallet } from '../lib/wallet'
import { applyVolume, embedErrorMessage, formatDuration, loadYouTubeApi, YT_STATE, type Song } from '../lib/youtube'

export interface PlayRequest {
  song: Song
  difficulty: Difficulty
  keys: KeyCount
}

export default function SongDetail({
  song,
  onClose,
  onSimilar,
}: {
  song: Song
  onClose: () => void
  /** 이 곡의 유튜브 믹스로 비슷한 곡 목록을 띄운다 */
  onSimilar: () => void
}) {
  const navigate = useNavigate()
  const settings = useSettings()
  const keys = settings.keyCount
  const [difficulty, setDifficulty] = useState<Difficulty>(() => (sessionStorage.getItem('rt.diff') as Difficulty) || 'NM')
  const [duration, setDuration] = useState(song.duration)
  const [sync, setSync] = useState(() => getSongSync(song.videoId) ?? { bpm: song.bpmHint, beatMs: 0 })
  const [tapped, setTapped] = useState(!!getSongSync(song.videoId))
  const [taps, setTaps] = useState<number[]>([])
  const { wallet } = useWallet()
  const [ranking, setRanking] = useState<{ top: RankingRow[]; me: MyRank | null } | null>(null)
  const [rankError, setRankError] = useState(false)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const clockRef = useRef<SongClock | null>(null)

  // 미리듣기 플레이어 (탭 템포 측정에도 사용)
  useEffect(() => {
    let disposed = false
    loadYouTubeApi().then((YT) => {
      if (disposed || !hostRef.current) return
      const el = document.createElement('div')
      hostRef.current.appendChild(el)
      playerRef.current = new YT.Player(el, {
        videoId: song.videoId,
        playerVars: { controls: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3 },
        events: {
          onReady: (e: any) => {
            applyVolume(e.target, getSettings().volume)
            clockRef.current = new SongClock(e.target)
            const d = e.target.getDuration()
            if (d) setDuration(Math.round(d))
          },
          onStateChange: (e: any) => {
            const playing = e.data === YT_STATE.PLAYING
            setPreviewing(playing)
            if (playing) {
              clockRef.current?.start()
              const d = e.target.getDuration()
              if (d) setDuration(Math.round(d))
            } else clockRef.current?.stop()
          },
          onError: (e: any) => setPlayerError(embedErrorMessage(e.data)),
        },
      })
    })
    // 챗봇 음성 입력 중에는 미리듣기를 멈춘다 (스피커 소리가 마이크로 다시 들어가 받아쓰기를 망친다)
    const onVoice = () => playerRef.current?.pauseVideo?.()
    window.addEventListener('rt-voice-start', onVoice)
    return () => {
      disposed = true
      window.removeEventListener('rt-voice-start', onVoice)
      playerRef.current?.destroy?.()
      playerRef.current = null
    }
  }, [song.videoId])

  // 음량을 바꾸면 미리듣기에도 바로 적용
  useEffect(() => {
    applyVolume(playerRef.current, settings.volume)
  }, [settings.volume])

  useEffect(() => {
    sessionStorage.setItem('rt.diff', difficulty)
    let alive = true
    setRanking(null)
    setRankError(false)
    fetchRanking({ videoId: song.videoId, difficulty, keys }, 10)
      .then((r) => alive && setRanking(r))
      .catch(() => alive && setRankError(true))
    return () => {
      alive = false
    }
    // 지갑을 받고 나면(게스트 등록·로그인) 내 순위가 생기므로 다시 불러온다
  }, [song.videoId, difficulty, keys, wallet?.nickname])

  const levels = useMemo(() => {
    if (!duration) return null
    return Object.fromEntries(
      DIFFICULTIES.map((d) => [
        d.id,
        generateChart({ videoId: song.videoId, difficulty: d.id, keys, bpm: sync.bpm, beatMs: sync.beatMs, durationMs: duration * 1000 }),
      ]),
    ) as Record<Difficulty, ReturnType<typeof generateChart>>
  }, [song.videoId, duration, sync.bpm, sync.beatMs, keys])

  function tap() {
    const clock = clockRef.current
    if (!clock || !previewing) return
    const t = clock.tick(performance.now())
    setTaps((prev) => {
      const list = prev.length && t - prev[prev.length - 1] > 2000 ? [t] : [...prev, t].slice(-24)
      if (list.length >= 6) {
        // 최소제곱으로 박 간격과 위상을 구한다
        const n = list.length
        const mi = (n - 1) / 2
        const mt = list.reduce((a, b) => a + b, 0) / n
        let cov = 0
        let vi = 0
        list.forEach((x, i) => {
          cov += (i - mi) * (x - mt)
          vi += (i - mi) ** 2
        })
        const period = cov / vi
        const bpm = Math.round(60000 / period)
        if (bpm >= 50 && bpm <= 260) {
          const a = mt - period * mi
          const beat = 60000 / bpm
          const next = { bpm, beatMs: Math.round(((a % beat) + beat) % beat) }
          setSync(next)
          setSongSync(song.videoId, next)
          setTapped(true)
        }
      }
      return list
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'KeyT' && !e.repeat) tap()
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function nudgeBpm(next: number) {
    const s = { bpm: Math.max(50, Math.min(260, next)), beatMs: sync.beatMs }
    setSync(s)
    setSongSync(song.videoId, s)
  }

  function start() {
    playerRef.current?.pauseVideo?.()
    const req: PlayRequest = { song: { ...song, duration }, difficulty, keys }
    sessionStorage.setItem('rt.play', JSON.stringify(req))
    navigate('/play', { state: req })
  }

  const diffMeta = DIFFICULTIES.find((d) => d.id === difficulty)!

  return (
    <aside className="detail" aria-label="곡 정보">
      <button className="detail-close" onClick={onClose} aria-label="닫기">
        ✕
      </button>
      <div className="detail-video" ref={hostRef} />
      {playerError && <p className="notice error">{playerError}</p>}
      <h2 className="detail-title">{song.title}</h2>
      <p className="detail-sub">
        {song.channel} · <span className="num">{formatDuration(duration)}</span>
      </p>
      <button className="ghost similar" onClick={onSimilar}>
        이 곡과 비슷한 곡 찾기
      </button>

      <KeySettings />

      <div className="diff-tabs" role="radiogroup" aria-label="난이도">
        {DIFFICULTIES.map((d) => (
          <button
            key={d.id}
            role="radio"
            aria-checked={difficulty === d.id}
            className={`diff ${difficulty === d.id ? 'on' : ''}`}
            style={{ ['--diff' as string]: d.color }}
            onClick={() => setDifficulty(d.id)}
          >
            <span className="diff-id num">{d.id}</span>
            <span className="diff-lv num">{levels ? levels[d.id].level : '-'}</span>
            <span className="diff-notes num">{levels ? `${levels[d.id].notes.length} notes` : ''}</span>
          </button>
        ))}
      </div>
      <p className="diff-caption">
        <b style={{ color: diffMeta.color }}>{diffMeta.label}</b>
        {levels && (
          <>
            {' '}
            · 노트 <span className="num">{levels[difficulty].notes.length.toLocaleString()}</span>개
          </>
        )}
      </p>

      <div className="opts">
        <div className="opt">
          <span>속도</span>
          <div className="stepper">
            <button onClick={() => updateSettings({ speed: Math.max(1, +(settings.speed - 0.1).toFixed(1)) })} aria-label="속도 낮추기">
              −
            </button>
            <b className="num">{settings.speed.toFixed(1)}</b>
            <button onClick={() => updateSettings({ speed: Math.min(6, +(settings.speed + 0.1).toFixed(1)) })} aria-label="속도 높이기">
              +
            </button>
          </div>
        </div>
        <div className="opt">
          <span>랜덤 노트</span>
          <button
            className={`toggle ${settings.random ? 'on' : ''}`}
            aria-pressed={settings.random}
            onClick={() => updateSettings({ random: !settings.random })}
          >
            {settings.random ? '켜짐' : '꺼짐'}
          </button>
        </div>
        <div className="opt">
          <span>BPM</span>
          <div className="stepper">
            <button onClick={() => nudgeBpm(sync.bpm - 1)} aria-label="BPM 낮추기">
              −
            </button>
            <b className="num">{sync.bpm}</b>
            <button onClick={() => nudgeBpm(sync.bpm + 1)} aria-label="BPM 높이기">
              +
            </button>
          </div>
        </div>
        <div className="opt">
          <span>싱크 보정</span>
          <div className="stepper">
            <button onClick={() => updateSettings({ offsetMs: settings.offsetMs - 10 })} aria-label="싱크 앞당기기">
              −
            </button>
            <b className="num">{settings.offsetMs > 0 ? '+' : ''}{settings.offsetMs}ms</b>
            <button onClick={() => updateSettings({ offsetMs: settings.offsetMs + 10 })} aria-label="싱크 늦추기">
              +
            </button>
          </div>
        </div>
        <VolumeOpt />
      </div>

      <div className={`tap ${previewing ? 'live' : ''}`}>
        <button className="tap-btn" onClick={tap} disabled={!previewing}>
          탭 <kbd>T</kbd>
        </button>
        <p>
          {previewing
            ? taps.length < 6
              ? `박자에 맞춰 6번 이상 눌러 주세요 (${taps.length}/6)`
              : `박자를 맞췄어요 · BPM ${sync.bpm}`
            : tapped
              ? `이 곡의 박자를 맞춰 두었어요 · BPM ${sync.bpm}`
              : '위 영상을 재생하고 박자에 맞춰 탭하면 노트가 음악에 딱 맞게 바뀌어요.'}
        </p>
      </div>

      <section className="mini-rank">
        <h3>
          랭킹 <span className="num">{keys}K {difficulty}</span>
        </h3>
        {rankError ? (
          <p className="muted">랭킹을 불러오지 못했어요.</p>
        ) : ranking === null ? (
          <p className="muted">불러오는 중…</p>
        ) : ranking.top.length === 0 ? (
          <p className="muted">아직 기록이 없어요. 첫 번째 기록을 남겨 보세요.</p>
        ) : (
          <RankList rows={ranking.top} me={ranking.me} myNickname={wallet?.nickname ?? null} />
        )}
        {ranking?.me && (
          <p className="my-best">
            내 최고 기록 <span className="num">{ranking.me.score.toLocaleString()}</span> · {ranking.me.rank}위 / {ranking.me.total}명 · 플레이{' '}
            {ranking.me.play_count}번
          </p>
        )}
      </section>

      <button className="start" onClick={start} disabled={!!playerError || !levels}>
        <span>플레이</span>
        <small>
          {keys}K {diffMeta.label} {settings.random && '· RANDOM'}
        </small>
      </button>
    </aside>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { DIFFICULTIES } from '../game/chart'
import { gradeOf, TIERS, type PlayResult } from '../game/engine'
import { fetchRanking, submitRanking, type RankingRow } from '../lib/supabase'
import { updateSettings, useSettings } from '../lib/settings'
import { BACKGROUNDS, DEFAULT_BG } from '../lib/skins'

type Step = 'ask' | 'form' | 'saving' | 'saved' | 'skipped'

/** 평균적으로 일찍/늦게 쳤다면 싱크 보정값을 추천하고 바로 적용할 수 있게 한다 */
function SyncHint({ avgDelta }: { avgDelta: number }) {
  const settings = useSettings()
  const [applied, setApplied] = useState(false)
  if (Math.abs(avgDelta) < 10) return null
  const next = Math.max(-300, Math.min(300, settings.offsetMs + avgDelta))
  return (
    <div className="sync-hint">
      <p>
        평균적으로 <b className="num">{Math.abs(avgDelta)}ms</b> {avgDelta > 0 ? '늦게' : '일찍'} 쳤어요.
        {applied ? ' 싱크 보정을 바꿨어요.' : ` 싱크를 ${next > 0 ? '+' : ''}${next}ms로 바꾸면 판정이 맞춰져요.`}
      </p>
      {!applied && (
        <button
          className="ghost"
          onClick={() => {
            updateSettings({ offsetMs: next })
            setApplied(true)
          }}
        >
          싱크 보정 적용
        </button>
      )}
    </div>
  )
}

function readResult(state: unknown): PlayResult | null {
  if (state && (state as PlayResult).videoId) return state as PlayResult
  try {
    return JSON.parse(sessionStorage.getItem('rt.result') ?? 'null')
  } catch {
    return null
  }
}

export default function Result() {
  const location = useLocation()
  const r = readResult(location.state)
  if (!r) return <Navigate to="/" replace />
  return <ResultInner r={r} />
}

function ResultInner({ r }: { r: PlayResult }) {
  const navigate = useNavigate()
  const settings = useSettings()
  const bg = BACKGROUNDS[settings.background] ?? BACKGROUNDS[DEFAULT_BG]
  const diff = DIFFICULTIES.find((d) => d.id === r.difficulty)!
  const grade = gradeOf(r.accuracy)
  const fullCombo = r.maxCombo === r.judgeCount
  const perfect = r.counts['MAX 100%'] === r.judgeCount

  const [step, setStep] = useState<Step>('ask')
  const [nickname, setNickname] = useState(() => localStorage.getItem('rt.nick') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [ranking, setRanking] = useState<RankingRow[] | null>(null)

  const loadRanking = () =>
    fetchRanking(r.videoId, r.difficulty, 20)
      .then(setRanking)
      .catch(() => setRanking([]))

  useEffect(() => {
    loadRanking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const nick = nickname.trim()
    if (!nick) return setError('닉네임을 입력해 주세요.')
    if (nick.length > 12) return setError('닉네임은 12자까지 쓸 수 있어요.')
    setStep('saving')
    setError(null)
    try {
      await submitRanking({
        video_id: r.videoId,
        title: r.title.slice(0, 200),
        difficulty: r.difficulty,
        nickname: nick,
        score: r.score,
        accuracy: r.accuracy,
        max_combo: r.maxCombo,
        is_random: r.random,
        bpm: r.bpm,
      })
      localStorage.setItem('rt.nick', nick)
      setStep('saved')
      loadRanking()
    } catch {
      setError('랭킹 등록에 실패했어요. 네트워크를 확인하고 다시 시도해 주세요.')
      setStep('form')
    }
  }

  const myNick = step === 'saved' ? nickname.trim() : null

  return (
    <div className="result">
      <div className="play-bg" style={{ backgroundImage: `url(${bg.image})` }} aria-hidden />
      <div className="play-dim" style={{ opacity: 0.7 }} aria-hidden />

      <section className="result-card">
        <div className="result-head">
          <img src={r.thumbnail} alt="" />
          <div>
            <p className="hud-title">{r.title}</p>
            <p className="hud-channel">
              <span className="num" style={{ color: diff.color }}>
                {diff.label} {r.level}
              </span>
              {r.random && <span className="num"> · RANDOM</span>}
              <span className="num"> · BPM {r.bpm}</span>
            </p>
          </div>
        </div>

        <div className="result-main">
          <div className={`grade grade-${grade.replace('+', 'p')}`}>
            <span className="num">{grade}</span>
            {(perfect || fullCombo) && <em className="num">{perfect ? 'PERFECT PLAY' : 'MAX COMBO'}</em>}
          </div>
          <dl className="result-nums">
            <div>
              <dt>SCORE</dt>
              <dd className="num big">{r.score.toLocaleString()}</dd>
            </div>
            <div>
              <dt>RATE</dt>
              <dd className="num">{r.accuracy.toFixed(2)}%</dd>
            </div>
            <div>
              <dt>MAX COMBO</dt>
              <dd className="num">
                {r.maxCombo} / {r.judgeCount}
              </dd>
            </div>
          </dl>
        </div>

        <ul className="judges">
          {[...TIERS.map((t) => t.label), 'BREAK'].map((label) => (
            <li key={label} className={label === 'BREAK' ? 'brk' : label.startsWith('MAX') ? 'max' : ''}>
              <span className="num">{label}</span>
              <b className="num">{r.counts[label] ?? 0}</b>
            </li>
          ))}
          <li className="fl">
            <span className="num">FAST / SLOW</span>
            <b className="num">
              {r.early} / {r.late}
            </b>
          </li>
        </ul>

        <SyncHint avgDelta={r.avgDelta ?? 0} />

        <div className="register">
          {step === 'ask' && (
            <>
              <p>이 기록을 랭킹에 등록할까요?</p>
              <div className="overlay-actions">
                <button className="start" onClick={() => setStep('form')}>
                  <span>랭킹 등록</span>
                </button>
                <button className="ghost" onClick={() => setStep('skipped')}>
                  등록하지 않기
                </button>
              </div>
            </>
          )}
          {(step === 'form' || step === 'saving') && (
            <form onSubmit={onSubmit} className="nick-form">
              <label htmlFor="nick">랭킹에 표시할 닉네임</label>
              <div className="nick-row">
                <input
                  id="nick"
                  autoFocus
                  maxLength={12}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="최대 12자"
                />
                <button className="start" type="submit" disabled={step === 'saving'}>
                  <span>{step === 'saving' ? '등록 중…' : '등록하기'}</span>
                </button>
              </div>
              {error && <p className="notice error">{error}</p>}
            </form>
          )}
          {step === 'saved' && <p className="ok">랭킹에 등록했어요.</p>}
          {step === 'skipped' && <p className="muted">랭킹에 등록하지 않았어요.</p>}
        </div>

        <div className="overlay-actions">
          <button className="ghost" onClick={() => navigate('/play', { state: JSON.parse(sessionStorage.getItem('rt.play') ?? 'null') })}>
            다시 하기
          </button>
          <Link className="ghost" to="/">
            곡 선택으로
          </Link>
        </div>
      </section>

      <section className="result-rank">
        <h3>
          랭킹 <span className="num">{diff.label}</span>
        </h3>
        {ranking === null ? (
          <p className="muted">불러오는 중…</p>
        ) : ranking.length === 0 ? (
          <p className="muted">아직 기록이 없어요.</p>
        ) : (
          <ol>
            {ranking.map((row, i) => (
              <li key={row.id} className={myNick && row.nickname === myNick ? 'me' : ''}>
                <span className="rk num">{i + 1}</span>
                <span className="nick">{row.nickname}</span>
                <span className="acc num">{Number(row.accuracy).toFixed(2)}%</span>
                <span className="sc num">{row.score.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import RankList from '../components/RankList'
import { DIFFICULTIES } from '../game/chart'
import { gradeOf, TIERS, type PlayResult } from '../game/engine'
import { fetchRanking, submitScore, type MyRank, type RankingRow } from '../lib/supabase'
import { updateSettings, useSettings } from '../lib/settings'
import { BACKGROUNDS, DEFAULT_BG } from '../lib/skins'
import { useWallet } from '../lib/wallet'

/** auto: 정해 둔 닉네임으로 바로 등록하는 중, saving: 닉네임 입력 후 등록하는 중 */
type Step = 'wait' | 'ask' | 'form' | 'auto' | 'saving' | 'saved' | 'skipped' | 'unavailable'

/** 등록한 등록권. 결과 화면을 새로고침해도 다시 보내지 않는다 */
const SUBMITTED_KEY = 'rt.submitted'

const SUBMIT_ERRORS: Record<string, string> = {
  NICKNAME_TAKEN: '이미 다른 플레이어가 쓰는 닉네임이에요. 다른 닉네임을 골라 주세요.',
  BAD_NICKNAME: '닉네임은 1~12자로 정해 주세요.',
  SESSION_EXPIRED: '플레이한 지 너무 오래돼서 등록할 수 없어요.',
  TOO_EARLY: '기록을 확인하지 못해 등록할 수 없어요.',
  BAD_RESULT: '기록을 확인하지 못해 등록할 수 없어요.',
}

interface Saved {
  best: boolean
  prevScore: number | null
  me: MyRank | null
}

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

  const { wallet, error: walletError, setWallet } = useWallet()
  const [step, setStep] = useState<Step>('wait')
  // 예전 버전은 닉네임을 브라우저에만 저장했다
  const [nickname, setNickname] = useState(() => localStorage.getItem('rt.nick') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [ranking, setRanking] = useState<{ top: RankingRow[]; me: MyRank | null } | null>(null)
  const started = useRef(false)

  const loadRanking = () =>
    fetchRanking({ videoId: r.videoId, difficulty: r.difficulty, keys: r.keys ?? 5 }, 20)
      .then(setRanking)
      .catch(() => setRanking({ top: [], me: null }))

  useEffect(() => {
    loadRanking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit(nick?: string) {
    if (!r.sessionId) return
    setStep(nick ? 'saving' : 'auto')
    setError(null)
    try {
      const res = await submitScore({
        sessionId: r.sessionId,
        score: r.score,
        accuracy: r.accuracy,
        maxCombo: r.maxCombo,
        counts: r.counts,
        random: r.random,
        bpm: r.bpm,
        title: r.title.slice(0, 200),
        nickname: nick,
      })
      sessionStorage.setItem(SUBMITTED_KEY, r.sessionId)
      if (wallet) setWallet({ ...wallet, nickname: res.nickname })
      setSaved(res)
      setStep('saved')
      loadRanking()
    } catch (e) {
      const code = (e as { code?: string }).code ?? ''
      if (code === 'NICKNAME_REQUIRED') return setStep('ask')
      // 이미 쓴 등록권: 다른 탭이나 새로고침 전에 등록을 마친 기록
      if (code === 'SESSION_INVALID') {
        sessionStorage.setItem(SUBMITTED_KEY, r.sessionId)
        setSaved(null)
        return setStep('saved')
      }
      setError(SUBMIT_ERRORS[code] ?? '랭킹 등록에 실패했어요. 네트워크를 확인하고 다시 시도해 주세요.')
      setStep(code === 'TOO_EARLY' || code === 'BAD_RESULT' || code === 'SESSION_EXPIRED' ? 'unavailable' : 'form')
    }
  }

  // 지갑(닉네임)을 확인한 뒤 한 번: 닉네임이 있으면 바로 등록하고, 없으면 등록할지 묻는다
  useEffect(() => {
    if (started.current || (!wallet && !walletError)) return
    started.current = true
    if (!r.sessionId) return setStep('unavailable')
    if (sessionStorage.getItem(SUBMITTED_KEY) === r.sessionId) return setStep('saved')
    if (wallet?.nickname) submit()
    else setStep('ask')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, walletError])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const nick = nickname.trim()
    if (!nick) return setError('닉네임을 입력해 주세요.')
    if (nick.length > 12) return setError('닉네임은 12자까지 쓸 수 있어요.')
    submit(nick)
  }

  const myNick = wallet?.nickname ?? null

  return (
    <div className="result">
      <div className="play-bg" style={{ backgroundImage: `url(${bg.image})` }} aria-hidden />
      <div className="play-dim" style={{ opacity: 0.7 }} aria-hidden />
      <div className="bg-fx" aria-hidden />

      <section className="result-card">
        <div className="result-head">
          <img src={r.thumbnail} alt="" />
          <div>
            <p className="hud-title">{r.title}</p>
            <p className="hud-channel">
              <span className="num" style={{ color: diff.color }}>
                {r.keys ?? 5}K {diff.label} {r.level}
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
          {step === 'wait' && <p className="muted">기록을 확인하는 중…</p>}
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
          {step === 'auto' && <p className="muted">랭킹에 등록하는 중…</p>}
          {(step === 'form' || step === 'saving') && (
            <form onSubmit={onSubmit} className="nick-form">
              <label htmlFor="nick">랭킹에 표시할 닉네임 (한 번 정하면 다음부터 자동으로 등록돼요)</label>
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
          {step === 'saved' && <SavedMessage saved={saved} />}
          {step === 'skipped' && <p className="muted">랭킹에 등록하지 않았어요.</p>}
          {step === 'unavailable' && (
            <p className="muted">{error ?? '기록 서버에 연결하지 못해 이번 기록은 랭킹에 등록할 수 없어요.'}</p>
          )}
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
          랭킹 <span className="num">{r.keys ?? 5}K {diff.label}</span>
        </h3>
        {ranking === null ? (
          <p className="muted">불러오는 중…</p>
        ) : ranking.top.length === 0 ? (
          <p className="muted">아직 기록이 없어요.</p>
        ) : (
          <RankList rows={ranking.top} me={ranking.me} myNickname={myNick} showAccuracy />
        )}
      </section>
    </div>
  )
}

function SavedMessage({ saved }: { saved: Saved | null }) {
  if (!saved) return <p className="ok">랭킹에 등록한 기록이에요.</p>
  const rank = saved.me && (
    <>
      {' '}
      현재 <b className="num">{saved.me.rank}</b>위 / {saved.me.total}명
    </>
  )
  if (!saved.best) {
    return (
      <p className="muted">
        내 최고 기록(<span className="num">{saved.prevScore?.toLocaleString()}</span>)보다 낮아 순위는 그대로예요.{rank}
      </p>
    )
  }
  return (
    <p className="ok">
      {saved.prevScore === null ? '랭킹에 등록했어요!' : `최고 기록 갱신! (이전 ${saved.prevScore.toLocaleString()})`}
      {rank}
    </p>
  )
}

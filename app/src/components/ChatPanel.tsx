import { useEffect, useRef, useState, type FormEvent } from 'react'
import { askMusicBot, loadBot, MODEL_INFO, webGpuSupported } from '../lib/localBot'
import { loadVoice, startRecording, type Recording } from '../lib/voice'
import { formatDuration, type Song } from '../lib/youtube'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  /** 챗봇이 검색해서 찾은 곡 (말풍선 아래 카드로 표시) */
  songs?: Song[]
}

type ModelState = 'idle' | 'loading' | 'ready' | 'error'
type VoiceState = 'idle' | 'loading' | 'ready' | 'recording' | 'transcribing'

const SUGGESTIONS = ['신나는 K-POP 추천해 줘', '초보가 하기 좋은 느린 곡', '애니 오프닝 중에 빠른 곡', '목록에서 첫 번째 곡 플레이할래']

export default function ChatPanel({
  shown,
  onSearch,
  onSelect,
}: {
  shown: Song[]
  /** 검색어로 곡 목록을 갱신하고 결과를 돌려준다 */
  onSearch: (query: string) => Promise<Song[]>
  onSelect: (song: Song) => void
}) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'assistant', content: '안녕하세요, 피카 DJ예요! 듣고 싶은 분위기나 가수를 말해 주면 곡을 찾아 드릴게요.' },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [model, setModel] = useState<ModelState>('idle')
  const [modelProgress, setModelProgress] = useState(0)
  const [voice, setVoice] = useState<VoiceState>('idle')
  const [voiceProgress, setVoiceProgress] = useState(0)
  const [notice, setNotice] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const recRef = useRef<Recording | null>(null)
  const supported = webGpuSupported()

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs, open, busy])

  useEffect(() => () => recRef.current?.cancel(), [])

  async function startModel() {
    setModel('loading')
    setNotice('')
    try {
      await loadBot((p) => setModelProgress(p))
      setModel('ready')
    } catch (e) {
      setModel('error')
      setNotice(
        String(e).includes('NO_WEBGPU')
          ? '이 기기에서는 WebGPU를 쓸 수 없어요. 최신 Chrome이나 Edge에서 열어 주세요.'
          : 'AI 모델을 불러오지 못했어요. 그래픽 메모리가 부족하거나 네트워크가 끊겼을 수 있어요.',
      )
    }
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy || model !== 'ready') return
    setInput('')
    const next: Msg[] = [...msgs, { role: 'user', content }]
    setMsgs(next)
    setBusy(true)
    try {
      const r = await askMusicBot(
        // 첫 인사말은 모델에 보내지 않는다 (대화는 사용자 메시지로 시작해야 함)
        next.slice(1).map(({ role, content }) => ({ role, content })),
        shown.map(({ videoId, title, channel }) => ({ videoId, title, channel })),
      )
      let found: Song[] | undefined
      if (r.select) {
        const song = shown.find((s) => s.videoId === r.select)
        if (song) onSelect(song)
      } else if (r.search) {
        found = (await onSearch(r.search)).slice(0, 4)
      }
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply, songs: found }])
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: '곡을 찾다가 문제가 생겼어요. 다시 한 번 말해 주세요.' }])
    } finally {
      setBusy(false)
    }
  }

  async function onMic() {
    setNotice('')
    if (voice === 'idle' || voice === 'ready') {
      if (voice === 'idle') {
        // 첫 클릭: 음성 인식 모델을 받은 뒤 바로 녹음을 시작한다
        setVoice('loading')
        try {
          await loadVoice((p) => setVoiceProgress(p))
        } catch {
          setVoice('idle')
          setNotice('음성 인식 모델을 불러오지 못했어요. 잠시 후 다시 눌러 주세요.')
          return
        }
      }
      try {
        recRef.current = await startRecording()
        setVoice('recording')
      } catch {
        setVoice('ready')
        setNotice('마이크를 쓸 수 없어요. 주소창 왼쪽 아이콘에서 마이크 권한을 허용해 주세요.')
      }
      return
    }
    if (voice === 'recording' && recRef.current) {
      setVoice('transcribing')
      try {
        const text = await recRef.current.stop()
        if (text) send(text)
        else setNotice('잘 안 들렸어요. 다시 말해 주세요.')
      } catch {
        setNotice('말한 내용을 알아듣지 못했어요. 다시 해 주세요.')
      } finally {
        recRef.current = null
        setVoice('ready')
      }
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(input)
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label="피카 DJ에게 곡 추천받기">
        <img src="/assets/anim/25.gif" alt="" />
        <span>피카 DJ에게 추천받기</span>
      </button>
    )
  }

  const micLabel = {
    idle: '음성으로 말하기 (처음 한 번 음성 인식 모델 약 1GB 다운로드)',
    loading: '음성 인식 모델 받는 중',
    ready: '음성으로 말하기',
    recording: '말하기 끝내기',
    transcribing: '받아쓰는 중',
  }[voice]

  return (
    <section className="chat" aria-label="음악 추천 챗봇">
      <header className="chat-head">
        <img src="/assets/anim/25.gif" alt="" />
        <b>피카 DJ</b>
        <button className="detail-close" onClick={() => setOpen(false)} aria-label="챗봇 닫기">
          ✕
        </button>
      </header>
      <div className="chat-list" ref={listRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <p>{m.content}</p>
            {m.songs && m.songs.length > 0 && (
              <ul className="chat-songs">
                {m.songs.map((s) => (
                  <li key={s.videoId}>
                    <button onClick={() => onSelect(s)}>
                      <img src={s.thumbnail} alt="" />
                      <span className="t">{s.title}</span>
                      <span className="d num">{formatDuration(s.duration)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {model !== 'ready' && (
          <div className="chat-model">
            {!supported ? (
              <p>이 브라우저는 WebGPU를 지원하지 않아 챗봇을 쓸 수 없어요. 최신 Chrome이나 Edge에서 열어 주세요.</p>
            ) : model === 'loading' ? (
              <>
                <p>AI 모델을 받는 중… {Math.round(modelProgress * 100)}%</p>
                <div className="chat-progress">
                  <i style={{ width: `${modelProgress * 100}%` }} />
                </div>
              </>
            ) : (
              <>
                <p>
                  피카 DJ는 API 키 없이 이 브라우저 안에서 직접 돌아가요. 처음 한 번 AI 모델({MODEL_INFO.name}, {MODEL_INFO.size})을
                  받고 나면 다음부터는 바로 켜져요.
                </p>
                <button onClick={startModel}>{model === 'error' ? '다시 시도' : 'AI 모델 받고 시작하기'}</button>
              </>
            )}
          </div>
        )}
        {voice === 'loading' && (
          <div className="chat-model">
            <p>음성 인식 모델(Whisper)을 받는 중… {Math.round(voiceProgress * 100)}%</p>
            <div className="chat-progress">
              <i style={{ width: `${voiceProgress * 100}%` }} />
            </div>
          </div>
        )}
        {busy && <div className="bubble assistant typing">곡을 고르는 중…</div>}
        {voice === 'recording' && <div className="bubble user typing">듣고 있어요… 다 말했으면 ■ 버튼을 눌러 주세요</div>}
        {voice === 'transcribing' &&<div className="bubble user typing">받아쓰는 중…</div>}
        {notice && <p className="chat-notice">{notice}</p>}
      </div>
      {model === 'ready' && msgs.length <= 1 && (
        <div className="chat-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form className="chat-input" onSubmit={onSubmit}>
        <button
          type="button"
          className={`chat-mic ${voice}`}
          onClick={onMic}
          disabled={model !== 'ready' || busy || voice === 'loading' || voice === 'transcribing'}
          aria-label={micLabel}
          title={micLabel}
        >
          {voice === 'recording' ? '■' : '🎤'}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={voice === 'recording' ? '듣고 있어요… 다 말하면 ■' : '예: 비 오는 날 듣기 좋은 노래'}
          aria-label="챗봇에게 메시지"
          maxLength={300}
          disabled={model !== 'ready'}
        />
        <button type="submit" disabled={busy || model !== 'ready' || !input.trim()}>
          보내기
        </button>
      </form>
    </section>
  )
}

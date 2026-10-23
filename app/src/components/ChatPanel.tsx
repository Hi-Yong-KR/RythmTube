import { useEffect, useRef, useState, type FormEvent } from 'react'
import { askMusicBot } from '../lib/supabase'
import { formatDuration, type Song } from '../lib/youtube'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  /** 챗봇이 검색해서 찾은 곡 (말풍선 아래 카드로 표시) */
  songs?: Song[]
}

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
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs, open])

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy) return
    setInput('')
    const next: Msg[] = [...msgs, { role: 'user', content }]
    setMsgs(next)
    setBusy(true)
    try {
      const r = await askMusicBot(
        // 첫 인사말은 서버에 보내지 않는다 (대화는 사용자 메시지로 시작해야 함)
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
        {busy && <div className="bubble assistant typing">곡을 고르는 중…</div>}
      </div>
      {msgs.length <= 1 && (
        <div className="chat-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="예: 비 오는 날 듣기 좋은 노래"
          aria-label="챗봇에게 메시지"
          maxLength={300}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          보내기
        </button>
      </form>
    </section>
  )
}

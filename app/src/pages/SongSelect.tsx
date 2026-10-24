import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import ChatPanel from '../components/ChatPanel'
import Shell from '../components/Shell'
import SongDetail from '../components/SongDetail'
import {
  CATEGORIES,
  categorySongs,
  cleanSearchText,
  formatDuration,
  hasYoutubeKey,
  mixSongs,
  parseVideoId,
  searchBlocked,
  searchSongs,
  songById,
  type Category,
  type Song,
} from '../lib/youtube'

const GROUPS = ['추천', '장르', '분위기'] as const

export default function SongSelect() {
  const [cat, setCat] = useState<Category | null>(CATEGORIES[0])
  const [heading, setHeading] = useState(CATEGORIES[0].label)
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Song | null>(null)
  // 빠르게 여러 번 누르면 늦게 온 이전 응답이 새 목록을 덮어쓰지 않도록 마지막 요청만 반영한다
  const reqRef = useRef(0)

  async function run(task: () => Promise<Song[]>, title: string): Promise<Song[]> {
    const req = ++reqRef.current
    setLoading(true)
    setError(null)
    setHeading(title)
    try {
      const list = await task()
      if (req === reqRef.current) setSongs(list)
      return list
    } catch (e) {
      if (req === reqRef.current) {
        setSongs([])
        setError((e as Error).message)
      }
      return []
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (cat) run(() => categorySongs(cat), cat.label)
  }, [cat])

  async function onSearch(e: FormEvent) {
    e.preventDefault()
    const q = cleanSearchText(query)
    if (!q) return
    setQuery(q)
    const id = parseVideoId(q)
    if (id) {
      setCat(null)
      run(async () => {
        const s = await songById(id)
        setSelected(s)
        return [s]
      }, '링크로 불러온 곡')
      return
    }
    setCat(null)
    run(() => searchSongs(q), `‘${q}’ 검색 결과`)
  }

  // 유튜브 화면에서 복사한 글이면 메뉴 글자를 빼고 제목만 붙여 넣는다
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    const clean = cleanSearchText(text)
    if (!clean || clean === text) return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart ?? query.length
    const end = el.selectionEnd ?? query.length
    setQuery(query.slice(0, start) + clean + query.slice(end))
  }

  const rail = (
    <div className="cats">
      {GROUPS.map((g) => (
        <section key={g} className="cat-group">
          <h3>{g}</h3>
          {CATEGORIES.filter((c) => c.group === g).map((c) => (
            <button
              key={c.id}
              className={`cat ${cat?.id === c.id ? 'on' : ''}`}
              onClick={() => (cat?.id === c.id ? run(() => categorySongs(c), c.label) : setCat(c))}
            >
              <img src={`/assets/poke/${c.mascot}.png`} alt="" />
              {c.label}
            </button>
          ))}
        </section>
      ))}
    </div>
  )

  const top = (
    <form className="search" onSubmit={onSearch} role="search">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onPaste={onPaste}
        placeholder="노래 제목·가수를 검색하거나 유튜브(뮤직) 링크를 붙여넣으세요"
        aria-label="노래 검색"
      />
      <button type="submit">검색</button>
    </form>
  )

  return (
    <Shell rail={rail} top={top}>
      <div className={`select-body ${selected ? 'with-detail' : ''}`}>
        <section className="song-list">
          <div className="list-head">
            <h1>{heading}</h1>
            {cat && (
              <button className="ghost" onClick={() => run(() => categorySongs(cat), cat.label)}>
                다른 곡 섞기
              </button>
            )}
          </div>
          {!hasYoutubeKey && (
            <p className="notice">
              YouTube API 키가 아직 설정되지 않아 기본 곡만 보여요. <code>app/.env.local</code>의{' '}
              <code>VITE_YOUTUBE_API_KEY</code>에 키를 넣으면 검색과 추천이 열려요.
            </p>
          )}
          {hasYoutubeKey && !error && searchBlocked() && (
            <p className="notice">
              오늘 유튜브 검색 한도를 다 써서 추천은 전에 본 곡과 비슷한 곡으로 보여줘요. 검색은 한국 시간 오후 4~5시에 다시 돼요.
              유튜브 링크 붙여넣기는 지금도 돼요.
            </p>
          )}
          {error && <p className="notice error">{error}</p>}
          {loading ? (
            <div className="song-grid">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="song-card skeleton" />
              ))}
            </div>
          ) : songs.length === 0 && !error ? (
            <div className="empty">
              <img src="/assets/anim/133.gif" alt="" />
              <p>조건에 맞는 곡이 없어요. 다른 검색어나 카테고리를 골라 보세요.</p>
            </div>
          ) : (
            <div className="song-grid">
              {songs.map((s) => (
                <button
                  key={s.videoId}
                  className={`song-card ${selected?.videoId === s.videoId ? 'on' : ''}`}
                  onClick={() => setSelected(s)}
                >
                  <span className="jacket">
                    <img src={s.thumbnail} alt="" loading="lazy" />
                    <span className="dur num">{formatDuration(s.duration)}</span>
                  </span>
                  <span className="song-title">{s.title}</span>
                  <span className="song-channel">{s.channel}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        {selected && (
          <SongDetail
            key={selected.videoId}
            song={selected}
            onClose={() => setSelected(null)}
            onSimilar={() => {
              setCat(null)
              run(() => mixSongs(selected), `‘${selected.title}’ 비슷한 곡`)
            }}
          />
        )}
      </div>
      <ChatPanel
        shown={songs}
        onSearch={(q) => {
          setCat(null)
          return run(() => searchSongs(q), `피카 DJ 추천 · ${q}`)
        }}
        onSelect={setSelected}
      />
    </Shell>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import ChatPanel from '../components/ChatPanel'
import Shell from '../components/Shell'
import SongDetail from '../components/SongDetail'
import {
  CATEGORIES,
  categorySongs,
  formatDuration,
  hasYoutubeKey,
  mixSongs,
  parseVideoId,
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

  async function run(task: () => Promise<Song[]>, title: string): Promise<Song[]> {
    setLoading(true)
    setError(null)
    setHeading(title)
    try {
      const list = await task()
      setSongs(list)
      return list
    } catch (e) {
      setSongs([])
      setError((e as Error).message)
      return []
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (cat) run(() => categorySongs(cat), cat.label)
  }, [cat])

  async function onSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
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

// YouTube Data API v3 검색 + IFrame Player API 로더

const API_KEY = (import.meta.env.VITE_YOUTUBE_API_KEY as string) || ''
export const hasYoutubeKey = API_KEY.length > 0

export interface Song {
  videoId: string
  title: string
  channel: string
  thumbnail: string
  /** 초 단위. 모르면 0 (플레이어가 로드되면 채운다) */
  duration: number
  /** 카테고리에서 추정한 기본 BPM */
  bpmHint: number
}

export interface Category {
  id: string
  label: string
  group: '추천' | '장르' | '분위기'
  queries: string[]
  bpm: number
  mascot: number
}

export const CATEGORIES: Category[] = [
  { id: 'random', label: '랜덤 추천', group: '추천', queries: ['official music video', '인기 가요 MV', 'music video 2026', 'top hits official video', 'official audio'], bpm: 120, mascot: 25 },
  { id: 'kpop', label: 'K-POP', group: '장르', queries: ['kpop official mv', 'K-POP 아이돌 MV', 'kpop girl group mv', 'kpop boy group mv'], bpm: 124, mascot: 39 },
  { id: 'jpop', label: 'J-POP', group: '장르', queries: ['jpop official mv', 'J-POP MV 人気', 'vocaloid original song'], bpm: 140, mascot: 658 },
  { id: 'pop', label: '팝', group: '장르', queries: ['pop official music video', 'billboard pop hit official video'], bpm: 118, mascot: 133 },
  { id: 'hiphop', label: '힙합', group: '장르', queries: ['hip hop official video', '국힙 MV', 'rap official music video'], bpm: 92, mascot: 849 },
  { id: 'edm', label: 'EDM', group: '장르', queries: ['edm official video', 'progressive house official', 'future bass'], bpm: 128, mascot: 384 },
  { id: 'rock', label: '록 · 밴드', group: '장르', queries: ['rock band official video', '밴드 라이브 공식', 'j-rock official mv'], bpm: 150, mascot: 6 },
  { id: 'ballad', label: '발라드', group: '장르', queries: ['발라드 MV', 'ballad official mv', 'acoustic love song official'], bpm: 76, mascot: 143 },
  { id: 'anime', label: '애니 OST', group: '장르', queries: ['anime opening full', 'anime ost official', 'アニメ 主題歌 MV'], bpm: 170, mascot: 448 },
  { id: 'game', label: '게임 OST', group: '장르', queries: ['game soundtrack official', 'rhythm game original song', 'pokemon music arrangement'], bpm: 150, mascot: 94 },
  { id: 'hype', label: '신나는', group: '분위기', queries: ['신나는 노래 MV', 'party song official video', 'upbeat dance official'], bpm: 128, mascot: 25 },
  { id: 'chill', label: '잔잔한', group: '분위기', queries: ['chill official mv', 'lofi song official', '잔잔한 노래 MV'], bpm: 85, mascot: 249 },
  { id: 'drive', label: '드라이브', group: '분위기', queries: ['city pop official', 'drive song official mv', 'synthwave official'], bpm: 112, mascot: 282 },
  { id: 'workout', label: '운동할 때', group: '분위기', queries: ['workout song official', 'power anthem official video', 'hardstyle official'], bpm: 140, mascot: 448 },
]

// API 키가 없을 때도 둘러볼 수 있게 넣어둔 기본 곡
const FALLBACK: Song[] = [
  { videoId: 'gdZLi9oWNZg', title: 'BTS - Dynamite', channel: 'HYBE LABELS', thumbnail: '', duration: 0, bpmHint: 114 },
  { videoId: '9bZkp7q19f0', title: 'PSY - GANGNAM STYLE', channel: 'officialpsy', thumbnail: '', duration: 0, bpmHint: 132 },
  { videoId: 'kJQP7kiw5Fk', title: 'Luis Fonsi - Despacito ft. Daddy Yankee', channel: 'LuisFonsiVEVO', thumbnail: '', duration: 0, bpmHint: 89 },
  { videoId: 'JGwWNGJdvx8', title: 'Ed Sheeran - Shape of You', channel: 'Ed Sheeran', thumbnail: '', duration: 0, bpmHint: 96 },
  { videoId: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', channel: 'Rick Astley', thumbnail: '', duration: 0, bpmHint: 113 },
  { videoId: 'fJ9rUzIMcZQ', title: 'Queen - Bohemian Rhapsody', channel: 'Queen Official', thumbnail: '', duration: 0, bpmHint: 72 },
].map((s) => ({ ...s, thumbnail: thumb(s.videoId) }))

export function thumb(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

/** 유튜브 플레이어에 음량 적용. 0이면 음소거 */
export function applyVolume(player: any, volume: number) {
  if (!player?.setVolume) return
  if (volume <= 0) return player.mute()
  player.unMute()
  player.setVolume(Math.min(100, Math.round(volume)))
}

/** youtube.com / music.youtube.com / youtu.be 링크에서 영상 id 추출 */
export function parseVideoId(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return null // 11자 단어는 검색어로 취급
  try {
    const u = new URL(s)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v')
      if (v) return v
      const m = u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/)
      if (m) return m[1]
    }
  } catch {
    /* URL 아님 */
  }
  return null
}

// 유튜브 화면을 드래그해 복사하면 같이 딸려 오는 글자 (한국어·영어 화면). 맨 위 머리말 → 영상 아래 버튼
const YT_HEADER = ['KR', '탐색 건너뛰기', 'Skip navigation', '검색', 'Search', '만들기', 'Create', '아바타 이미지', 'Avatar image', '로그인', 'Sign in']
const YT_CHROME = [
  ...YT_HEADER,
  '구독',
  'Subscribe',
  '공유',
  'Share',
  '저장',
  'Save',
  '오프라인 저장',
  'Download',
]
const CHROME_LINE = new RegExp(`^(?:${YT_CHROME.join('|')}|\\d+\\+?|[\\d.,]+[천만억KMB]?(?:명|회)?|조회수.*|구독자.*|.*views|.*subscribers)$`, 'i')
const HEADER_PREFIX = new RegExp(`^(?:(?:${YT_HEADER.join('|')}|\\d+\\+)\\s+)+`)

/**
 * 붙여넣은 검색어 정리: 유튜브 화면에서 복사할 때 딸려 온 메뉴 글자를 빼고 노래 제목 줄만 남긴다.
 * 링크는 그대로 둔다.
 */
export function cleanSearchText(text: string): string {
  const lines = text
    .split(/[\r\n\t]+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const link = lines.find((l) => parseVideoId(l))
  if (link) return link
  // 유튜브 머리말이 없으면 평범한 글: 제목이 'Save Your Tears'처럼 메뉴 글자로 시작해도 건드리지 않는다
  if (!/탐색 건너뛰기|Skip navigation/i.test(text)) return lines.join(' ')
  const title = lines.find((l) => !CHROME_LINE.test(l))
  // 줄바꿈 없이 한 줄로 들어온 경우 앞쪽 메뉴 글자를 떼어 낸다
  return (title ?? '').replace(HEADER_PREFIX, '').trim() || lines.join(' ')
}

function parseIsoDuration(iso: string) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

function decodeEntities(s: string) {
  const el = document.createElement('textarea')
  el.innerHTML = s
  return el.value
}

/**
 * 유튜브 API 하루 한도를 다 썼을 때. 키 하나를 모든 사용자가 같이 쓴다:
 * 하루 10,000단위 중 검색은 한 번에 100단위(= 하루 약 100번), 영상 정보 조회는 1단위.
 */
export class QuotaError extends Error {
  constructor() {
    super(
      '오늘 유튜브 검색 한도를 다 썼어요 (모든 사용자가 하루 약 100번을 같이 써요). 한국 시간 오후 4~5시에 다시 채워져요. ' +
        '그동안은 유튜브 링크를 붙여넣거나 장르 추천·비슷한 곡 찾기를 이용해 주세요.',
    )
  }
}

// 한도는 미국 태평양 시간 자정에 다시 채워진다 (한국 시간 오후 4시, 겨울에는 5시)
const quotaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
const QUOTA_KEY = 'rt.yt.searchQuota'

/** 오늘 검색 한도를 이미 다 썼는지. 다 썼으면 다시 채워질 때까지 검색 요청을 보내지 않는다 */
export function searchBlocked() {
  try {
    return localStorage.getItem(QUOTA_KEY) === quotaDay()
  } catch {
    return false
  }
}

async function api(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, key: API_KEY })
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${qs}`)
  const body = await res.json()
  if (!res.ok) {
    const reason: string = body?.error?.errors?.[0]?.reason ?? ''
    const message: string = body?.error?.message ?? ''
    if (/quota|limitExceeded/i.test(reason) || /quota exceeded/i.test(message)) {
      if (path === 'search') {
        try {
          localStorage.setItem(QUOTA_KEY, quotaDay())
        } catch {
          /* noop */
        }
      }
      throw new QuotaError()
    }
    throw new Error(message || 'YouTube API 요청에 실패했어요.')
  }
  return body
}

async function details(ids: string[], bpmHint: number): Promise<Song[]> {
  if (!ids.length) return []
  const body = await api('videos', { part: 'snippet,contentDetails,status', id: ids.join(',') })
  return (body.items as any[])
    .filter((v) => v.status?.embeddable !== false)
    .map((v) => ({
      videoId: v.id,
      title: decodeEntities(v.snippet.title),
      channel: v.snippet.channelTitle,
      thumbnail: v.snippet.thumbnails?.high?.url ?? thumb(v.id),
      duration: parseIsoDuration(v.contentDetails.duration),
      bpmHint,
    }))
}

const cache = new Map<string, Song[]>()
// 검색 결과는 하루, 믹스는 일주일 동안 이 브라우저에 남겨 두고 다시 쓴다 (검색 한도를 아끼려고)
const SEARCH_TTL = 24 * 3600_000
const MIX_TTL = 7 * 24 * 3600_000

export async function searchSongs(query: string, bpmHint = 120): Promise<Song[]> {
  const key = `${query}|${bpmHint}`
  const hit = cache.get(key) ?? readStored(key, SEARCH_TTL)
  if (hit) return hit
  if (!hasYoutubeKey) {
    const q = query.toLowerCase()
    return FALLBACK.filter((s) => s.title.toLowerCase().includes(q) || q.length < 2)
  }
  if (searchBlocked()) throw new QuotaError()
  // 검색은 결과 수와 상관없이 100단위라 한 번에 최대(50개)로 받는다
  const body = await api('search', {
    part: 'snippet',
    q: query,
    type: 'video',
    videoCategoryId: '10',
    videoEmbeddable: 'true',
    maxResults: '50',
    regionCode: 'KR',
    relevanceLanguage: 'ko',
  })
  const ids = (body.items as any[]).map((i) => i.id.videoId).filter(Boolean)
  // 리듬게임으로 하기 적당한 길이(1분 30초 ~ 8분)만 남긴다
  const songs = (await details(ids, bpmHint)).filter((s) => s.duration >= 90 && s.duration <= 480)
  // 빈 결과는 저장하지 않는다 (한 번 비면 새로고침 전까지 계속 빈 목록이 나왔다)
  if (songs.length) {
    cache.set(key, songs)
    writeStored(key, songs)
  }
  return songs
}

export async function songById(videoId: string, bpmHint = 120): Promise<Song> {
  if (hasYoutubeKey) {
    try {
      const [s] = await details([videoId], bpmHint)
      if (s) return s
    } catch (e) {
      if (!(e instanceof QuotaError)) throw e
    }
  }
  const fb = FALLBACK.find((s) => s.videoId === videoId)
  return fb ?? (await oembed(videoId, bpmHint)) ?? { videoId, title: '유튜브 영상', channel: '', thumbnail: thumb(videoId), duration: 0, bpmHint }
}

export async function categorySongs(cat: Category): Promise<Song[]> {
  if (!hasYoutubeKey) return shuffle([...FALLBACK])
  if (!searchBlocked()) {
    // 검색어에 따라 긴 모음 영상·플레이리스트만 나와 길이 필터에서 전부 빠질 수 있다 → 다른 검색어로 다시 찾는다
    try {
      for (const q of shuffle([...cat.queries])) {
        const songs = await searchSongs(q, cat.bpm)
        if (songs.length) {
          rememberSeeds(cat.id, songs)
          return shuffle([...songs])
        }
      }
    } catch (e) {
      if (!(e instanceof QuotaError)) throw e
    }
  }
  return categoryFromMix(cat)
}

/**
 * 검색 없이 카테고리 곡 고르기: 전에 이 카테고리에서 본 곡(없으면 기본 곡)의 유튜브 믹스.
 * 믹스는 검색 한도를 쓰지 않는다.
 */
async function categoryFromMix(cat: Category): Promise<Song[]> {
  const own = readSeeds(cat.id)
  const fallbackIds = FALLBACK.map((s) => s.videoId)
  const pool = own.length ? own : cat.id === 'random' ? [...readSeeds('*'), ...fallbackIds] : fallbackIds
  for (const videoId of shuffle([...new Set(pool)]).slice(0, 2)) {
    try {
      const seed: Song = { videoId, title: '', channel: '', thumbnail: '', duration: 0, bpmHint: cat.bpm }
      return shuffle([...(await mixSongs(seed, 40))])
    } catch {
      /* 다음 곡으로 */
    }
  }
  return shuffle([...FALLBACK])
}

// 카테고리별로 검색에서 본 곡 id (검색 한도를 다 썼을 때 믹스의 출발점). '*'는 전체
const SEEDS_MAX = 80

function readSeeds(catId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`rt.yt.seeds.${catId}`) ?? '[]')
  } catch {
    return []
  }
}

function rememberSeeds(catId: string, songs: Song[]) {
  for (const id of [catId, '*']) {
    try {
      const ids = [...new Set([...songs.map((s) => s.videoId), ...readSeeds(id)])].slice(0, SEEDS_MAX)
      localStorage.setItem(`rt.yt.seeds.${id}`, JSON.stringify(ids))
    } catch {
      /* noop */
    }
  }
}

/**
 * 유튜브가 곡마다 만드는 자동 믹스(RD + 영상 id)로 비슷한 곡을 찾는다.
 * 숨긴 IFrame 플레이어에 믹스를 불러와 목록을 읽으므로 API 키가 없어도 된다.
 */
export async function mixSongs(seed: Song, limit = 24): Promise<Song[]> {
  const key = `mix|${seed.videoId}`
  const hit = cache.get(key) ?? readStored(key, MIX_TTL)
  if (hit) return hit.slice(0, limit)
  const ids = (await mixIds(seed.videoId)).filter((id) => id !== seed.videoId).slice(0, 50)
  let songs: Song[] | null = null
  if (hasYoutubeKey) {
    try {
      songs = (await details(ids, seed.bpmHint)).filter((s) => s.duration >= 90 && s.duration <= 480)
    } catch (e) {
      if (!(e instanceof QuotaError)) throw e
    }
  }
  if (!songs) {
    // 키가 없거나 한도를 다 썼으면 oEmbed로 제목만 채운다. 외부 재생이 막힌 영상은 oEmbed가 실패하므로 함께 걸러진다
    const found = await Promise.all(ids.map((id) => oembed(id, seed.bpmHint)))
    songs = found.filter((s): s is Song => s !== null)
  }
  if (!songs.length) throw new Error('비슷한 곡을 찾지 못했어요. 다른 곡으로 시도해 주세요.')
  cache.set(key, songs)
  writeStored(key, songs)
  return songs.slice(0, limit)
}

async function mixIds(videoId: string): Promise<string[]> {
  const YT = await loadYouTubeApi()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:180px'
  host.appendChild(document.createElement('div'))
  document.body.appendChild(host)
  let player: any = null
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('유튜브 믹스를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')), 12000)
      const check = () => {
        const list: string[] | undefined = player?.getPlaylist?.()
        if (list?.length) {
          clearTimeout(timer)
          resolve(list)
        }
      }
      player = new YT.Player(host.firstChild, {
        playerVars: { listType: 'playlist', list: `RD${videoId}`, autoplay: 0, mute: 1 },
        events: {
          onReady: check,
          onStateChange: check,
          onError: () => {
            clearTimeout(timer)
            reject(new Error('이 곡은 유튜브 믹스가 없어요. 다른 곡으로 시도해 주세요.'))
          },
        },
      })
    })
  } finally {
    player?.destroy?.()
    host.remove()
  }
}

async function oembed(videoId: string, bpmHint: number): Promise<Song | null> {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`)
    if (!res.ok) return null
    const b = await res.json()
    return { videoId, title: b.title, channel: b.author_name, thumbnail: thumb(videoId), duration: 0, bpmHint }
  } catch {
    return null
  }
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function readStored(key: string, ttl: number): Song[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(`rt.q.${key}`) ?? 'null') as { at: number; songs: Song[] } | null
    if (!v || Date.now() - v.at > ttl) return null
    cache.set(key, v.songs)
    return v.songs
  } catch {
    return null
  }
}
function writeStored(key: string, songs: Song[]) {
  try {
    localStorage.setItem(`rt.q.${key}`, JSON.stringify({ at: Date.now(), songs }))
  } catch {
    // 저장 공간이 꽉 차면 저장해 둔 검색 결과를 비운다 (다음 검색부터 다시 쌓인다)
    for (const k of Object.keys(localStorage)) if (k.startsWith('rt.q.')) localStorage.removeItem(k)
  }
}

export function formatDuration(sec: number) {
  if (!sec) return '--:--'
  const m = Math.floor(sec / 60)
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
}

// ---- IFrame Player API ----

declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

let ytReady: Promise<any> | null = null

export function loadYouTubeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!ytReady) {
    ytReady = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        prev?.()
        resolve(window.YT)
      }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    })
  }
  return ytReady
}

export const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const

export function embedErrorMessage(code: number) {
  if (code === 101 || code === 150) return '이 영상은 업로더가 외부 재생을 막아 두었어요. 다른 곡을 골라 주세요.'
  if (code === 100) return '영상을 찾을 수 없어요. 삭제되었거나 비공개일 수 있어요.'
  return '영상을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
}

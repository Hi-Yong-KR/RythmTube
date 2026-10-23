import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

/**
 * 구글 로그인 사용 여부. 테스트하는 동안은 꺼 두고 모두 게스트로 플레이한다.
 * 다시 켜려면 app/.env.local에 VITE_GOOGLE_LOGIN=on (서버 쪽은 Supabase Secrets의 CHARGE_REQUIRES_LOGIN=on)
 */
export const LOGIN_ENABLED = import.meta.env.VITE_GOOGLE_LOGIN === 'on'

// 구글 로그인 세션은 브라우저에 저장하고, 로그인 후 돌아온 주소의 코드로 세션을 만든다
export const supabase = createClient(url, anonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } })

// ---- 지갑 / 상점 / 결제 / 랭킹 (game-api 엣지 함수) ----

export interface Wallet {
  coins: number
  owned: string[]
  /** 랭킹에 표시할 닉네임. 아직 정하지 않았으면 null */
  nickname: string | null
}

type WalletReply = Wallet & { playerId: string }

export interface ShopItem {
  id: string
  kind: 'background' | 'note'
  name: string
  price: number
  sort: number
}

export interface CoinPackage {
  id: string
  coins: number
  price_krw: number
  sort: number
}

const CRED_KEY = 'rt.player'

function creds(): { playerId: string; secret: string } | null {
  try {
    return JSON.parse(localStorage.getItem(CRED_KEY) ?? 'null')
  } catch {
    return null
  }
}

async function callApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  // 로그인했으면 계정으로, 아니면 이 브라우저의 게스트 secret으로 인증한다 (로그인을 꺼 두면 늘 게스트)
  const { data } = await supabase.auth.getSession()
  const token = LOGIN_ENABLED ? data.session?.access_token : undefined
  const res = await fetch(`${url}/functions/v1/game-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey, ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ action, ...(!token || action === 'link_account' ? creds() : {}), ...payload }),
  })
  const body = await res.json()
  if (!res.ok) throw Object.assign(new Error(body.message ?? body.error ?? 'API_ERROR'), { code: body.error })
  return body as T
}

/**
 * 지금 플레이어의 지갑.
 * - 로그인: 계정 지갑. 이 브라우저에 게스트가 있으면 처음 한 번 계정으로 옮기고(merged) 게스트 정보를 지운다.
 * - 비로그인: 게스트 지갑. 없거나 계정에 옮겨진 게스트면 새로 만든다.
 */
export async function ensurePlayer(): Promise<WalletReply & { merged?: boolean }> {
  const { data } = await supabase.auth.getSession()
  if (LOGIN_ENABLED && data.session) {
    if (!creds()) return callApi<WalletReply>('wallet')
    const r = await callApi<WalletReply & { merged: boolean }>('link_account')
    localStorage.removeItem(CRED_KEY)
    return r
  }
  if (creds()) {
    try {
      return await callApi<WalletReply>('wallet')
    } catch (e) {
      if ((e as { code?: string }).code !== 'UNAUTHORIZED') throw e
    }
  }
  const r = await callApi<WalletReply & { secret: string }>('register')
  localStorage.setItem(CRED_KEY, JSON.stringify({ playerId: r.playerId, secret: r.secret }))
  return r
}

/** 구글로 로그인: 구글 화면에 갔다가 지금 페이지로 돌아온다 */
export async function signInWithGoogle() {
  // Supabase에서 구글 로그인을 아직 켜지 않았으면 오류 페이지로 보내지 말고 바로 알린다
  const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } })
    .then((r) => r.json())
    .catch(() => null)
  if (settings && !settings.external?.google) {
    return { error: new Error('구글 로그인이 아직 설정되지 않았어요. (Supabase 대시보드에서 Google 로그인을 켜야 해요)') }
  }
  return supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href } })
}

export const buyItem = (itemId: string) => callApi<Wallet>('buy_item', { itemId })
/** 코인 충전은 토스페이먼츠로만: 주문 생성 → 결제위젯 → 성공 페이지에서 서버 승인 */
export const createOrder = (packageId: string) =>
  callApi<{ orderId: string; amount: number; orderName: string }>('create_order', { packageId })
export const confirmPayment = (paymentKey: string, orderId: string, amount: number) =>
  callApi<Wallet & { coinsAdded?: number; alreadyDone?: boolean }>('confirm_payment', { paymentKey, orderId, amount })

export async function fetchShop() {
  const [items, packages] = await Promise.all([
    supabase.from('shop_items').select('*').order('sort'),
    supabase.from('coin_packages').select('*').order('sort'),
  ])
  if (items.error) throw items.error
  if (packages.error) throw packages.error
  return { items: items.data as ShopItem[], packages: packages.data as CoinPackage[] }
}

export interface RankingRow {
  rank: number
  nickname: string
  score: number
  accuracy: number
  max_combo: number
  judge_count: number
  is_random: boolean
  created_at: string
  is_me: boolean
}

/** 내 최고 기록과 순위. total은 순위표 인원 */
export interface MyRank {
  rank: number
  total: number
  score: number
  accuracy: number
  max_combo: number
  is_random: boolean
  play_count: number
  created_at: string
}

export interface Board {
  videoId: string
  difficulty: string
  keys: number
}

/** 곡·난이도·키 수별 순위표(플레이어마다 최고 기록 하나)와 내 순위 */
export const fetchRanking = (board: Board, limit = 20) =>
  callApi<{ top: RankingRow[]; me: MyRank | null }>('ranking', { ...board, limit })

export const setNickname = (nickname: string) => callApi<Wallet>('set_nickname', { nickname })

/** 플레이 시작 때 기록 등록권을 받는다. 서버가 판정 수·곡 길이를 받아 두고 등록 때 대조한다 */
export const startPlay = (board: Board, judgeCount: number, expectedMs: number) =>
  callApi<{ sessionId: string }>('start_play', { ...board, judgeCount, expectedMs })

export interface ScoreSubmit {
  sessionId: string
  score: number
  accuracy: number
  maxCombo: number
  counts: Record<string, number>
  random: boolean
  bpm: number
  title: string
  /** 처음 등록하거나 바꿀 때만 */
  nickname?: string
}

/** 기록 등록. 최고 기록보다 높을 때만 순위표가 바뀐다 */
export const submitScore = (r: ScoreSubmit) =>
  callApi<{ best: boolean; prevScore: number | null; nickname: string; me: MyRank | null }>('submit_score', { ...r })

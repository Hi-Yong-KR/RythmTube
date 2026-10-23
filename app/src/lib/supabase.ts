import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// 구글 로그인 세션은 브라우저에 저장하고, 로그인 후 돌아온 주소의 코드로 세션을 만든다
export const supabase = createClient(url, anonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } })

export interface RankingRow {
  id: number
  video_id: string
  title: string
  difficulty: string
  key_count: number
  nickname: string
  score: number
  accuracy: number
  max_combo: number
  is_random: boolean
  bpm: number | null
  created_at: string
}

/** 곡·난이도·키 수별 상위 기록. 같은 닉네임은 최고 점수 하나만 남긴다. */
export async function fetchRanking(videoId: string, difficulty: string, keys: number, limit = 20): Promise<RankingRow[]> {
  const { data, error } = await supabase
    .from('rankings')
    .select('*')
    .eq('video_id', videoId)
    .eq('difficulty', difficulty)
    .eq('key_count', keys)
    .order('score', { ascending: false })
    .limit(limit * 3)
  if (error) throw error
  const seen = new Set<string>()
  return (data as RankingRow[]).filter((r) => (seen.has(r.nickname) ? false : (seen.add(r.nickname), true))).slice(0, limit)
}

export async function submitRanking(row: Omit<RankingRow, 'id' | 'created_at'>) {
  const { error } = await supabase.from('rankings').insert(row)
  if (error) throw error
}

// ---- 지갑 / 상점 / 결제 (game-api 엣지 함수) ----

export interface Wallet {
  coins: number
  owned: string[]
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
  // 로그인했으면 계정으로, 아니면 이 브라우저의 게스트 secret으로 인증한다
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
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
  if (data.session) {
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

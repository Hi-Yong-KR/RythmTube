import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, anonKey, { auth: { persistSession: false } })

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
  const res = await fetch(`${url}/functions/v1/game-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ action, ...creds(), ...payload }),
  })
  const body = await res.json()
  if (!res.ok) throw Object.assign(new Error(body.message ?? body.error ?? 'API_ERROR'), { code: body.error })
  return body as T
}

export async function ensurePlayer(): Promise<Wallet & { playerId: string }> {
  const c = creds()
  if (c) {
    try {
      return { playerId: c.playerId, ...(await callApi<Wallet>('wallet')) }
    } catch (e) {
      if ((e as { code?: string }).code !== 'UNAUTHORIZED') throw e
    }
  }
  const r = await callApi<Wallet & { playerId: string; secret: string }>('register')
  localStorage.setItem(CRED_KEY, JSON.stringify({ playerId: r.playerId, secret: r.secret }))
  return r
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

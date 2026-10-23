import type { User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ensurePlayer, signInWithGoogle, supabase, type Wallet } from './supabase'

export interface Account {
  name: string
  email: string
  avatar: string | null
}

interface WalletCtx {
  wallet: Wallet | null
  playerId: string | null
  /** 구글 로그인 계정. 게스트면 null */
  account: Account | null
  /** 로그인 상태를 아직 확인하는 중 */
  authLoading: boolean
  error: string | null
  /** 로그인하면서 이 브라우저의 게스트 코인·아이템을 계정으로 옮겼을 때 한 번 띄울 안내 */
  notice: string | null
  clearNotice: () => void
  setWallet: (w: Wallet) => void
  refresh: () => Promise<void>
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<WalletCtx>(null!)

function toAccount(user: User | undefined): Account | null {
  if (!user) return null
  const m = user.user_metadata ?? {}
  return { name: m.full_name ?? m.name ?? user.email ?? '플레이어', email: user.email ?? '', avatar: m.avatar_url ?? m.picture ?? null }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const loading = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async () => {
    // 로그인 직후 이벤트가 겹쳐도 지갑은 한 번만 불러온다 (게스트 옮기기가 두 번 돌지 않게)
    if (loading.current) return loading.current
    loading.current = (async () => {
      try {
        const r = await ensurePlayer()
        setPlayerId(r.playerId)
        setWallet({ coins: r.coins, owned: r.owned, nickname: r.nickname })
        if (r.merged) setNotice('이 브라우저에서 모은 코인과 아이템을 계정으로 옮겼어요.')
        setError(null)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        loading.current = null
      }
    })()
    return loading.current
  }, [])

  useEffect(() => {
    // 처음 열 때(INITIAL_SESSION)·로그인·로그아웃마다 지갑을 다시 불러온다.
    // 콜백 안에서 supabase 호출을 기다리면 멈출 수 있어(supabase-js 안내) 다음 틱으로 미룬다
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return
      setAccount(toAccount(session?.user))
      setAuthLoading(false)
      setTimeout(refresh, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [refresh])

  const signIn = useCallback(async () => {
    const { error } = await signInWithGoogle()
    if (error) setNotice(error.message)
  }, [])

  const signOut = useCallback(async () => {
    setWallet(null)
    await supabase.auth.signOut()
  }, [])

  return (
    <Ctx.Provider
      value={{ wallet, playerId, account, authLoading, error, notice, clearNotice: () => setNotice(null), setWallet, refresh, signIn, signOut }}
    >
      {children}
    </Ctx.Provider>
  )
}

export const useWallet = () => useContext(Ctx)

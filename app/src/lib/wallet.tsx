import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ensurePlayer, type Wallet } from './supabase'

interface WalletCtx {
  wallet: Wallet | null
  playerId: string | null
  error: string | null
  setWallet: (w: Wallet) => void
  refresh: () => Promise<void>
}

const Ctx = createContext<WalletCtx>(null!)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await ensurePlayer()
      setPlayerId(r.playerId)
      setWallet({ coins: r.coins, owned: r.owned })
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return <Ctx.Provider value={{ wallet, playerId, error, setWallet, refresh }}>{children}</Ctx.Provider>
}

export const useWallet = () => useContext(Ctx)

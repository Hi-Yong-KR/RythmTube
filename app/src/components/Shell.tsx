import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { LOGIN_ENABLED } from '../lib/supabase'
import { useWallet } from '../lib/wallet'
import { keyLabel } from '../game/layout'
import { getKeyBinds, useSettings } from '../lib/settings'
import { BACKGROUNDS, DEFAULT_BG } from '../lib/skins'

export function CoinChip() {
  const { wallet, error } = useWallet()
  return (
    <Link to="/shop" className="coin-chip" title="코인 충전 · 상점">
      <img src="/assets/items/quick-ball.png" alt="" className="pixel" />
      <span className="num">{error ? '!' : wallet ? wallet.coins.toLocaleString() : '…'}</span>
      <span className="coin-chip-label">코인</span>
    </Link>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/** 구글 로그인 버튼 / 로그인한 계정 (누르면 로그아웃 메뉴) */
export function AccountChip() {
  const { account, authLoading, signIn, signOut } = useWallet()
  const [open, setOpen] = useState(false)
  if (authLoading) return null
  if (!account) {
    return (
      <button className="login-btn" onClick={signIn}>
        <GoogleMark />
        <span>구글 로그인</span>
      </button>
    )
  }
  return (
    <div className="account">
      <button className="account-chip" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${account.name} 계정 메뉴`}>
        {account.avatar ? <img src={account.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="account-initial">{account.name[0]}</span>}
        <span className="account-name">{account.name}</span>
      </button>
      {open && (
        <div className="account-menu">
          <p>{account.email}</p>
          <button
            onClick={() => {
              setOpen(false)
              signOut()
            }}
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}

/** 게스트 코인을 계정으로 옮겼다는 안내 (한 번) */
function WalletNotice() {
  const { notice, clearNotice } = useWallet()
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(clearNotice, 4000)
    return () => clearTimeout(t)
  }, [notice, clearNotice])
  return notice ? (
    <p className="toast" role="status">
      {notice}
    </p>
  ) : null
}

export default function Shell({ rail, top, children }: { rail?: ReactNode; top?: ReactNode; children: ReactNode }) {
  const settings = useSettings()
  const bg = BACKGROUNDS[settings.background] ?? BACKGROUNDS[DEFAULT_BG]
  return (
    <div className="shell">
      <div className="shell-bg" style={{ backgroundImage: `url(${bg.image})` }} aria-hidden />
      <div className="bg-fx fixed" aria-hidden />
      <aside className="rail">
        <Link to="/" className="logo" aria-label="Rythm Tube 홈">
          <img src="/assets/anim/39.gif" alt="" className="logo-mascot" />
          <span className="logo-word">
            Rythm<b>Tube</b>
          </span>
        </Link>
        <nav className="rail-nav">
          <NavLink to="/" end>
            곡 선택
          </NavLink>
          <NavLink to="/shop">상점 · 컬렉션</NavLink>
        </nav>
        {rail}
        <p className="rail-foot">
          {settings.keyCount}K · {getKeyBinds(settings).map(keyLabel).join(' · ')}
          <br />
          키보드로 플레이해요
        </p>
      </aside>
      <div className="stage">
        <header className="topbar">
          <div className="topbar-main">{top}</div>
          <CoinChip />
          {LOGIN_ENABLED && <AccountChip />}
        </header>
        {children}
        <WalletNotice />
      </div>
    </div>
  )
}

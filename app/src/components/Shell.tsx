import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useWallet } from '../lib/wallet'
import { useSettings } from '../lib/settings'
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

export default function Shell({ rail, top, children }: { rail?: ReactNode; top?: ReactNode; children: ReactNode }) {
  const settings = useSettings()
  const bg = BACKGROUNDS[settings.background] ?? BACKGROUNDS[DEFAULT_BG]
  return (
    <div className="shell">
      <div className="shell-bg" style={{ backgroundImage: `url(${bg.image})` }} aria-hidden />
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
          F · V · SPACE · N · J
          <br />
          키보드로 플레이해요
        </p>
      </aside>
      <div className="stage">
        <header className="topbar">
          <div className="topbar-main">{top}</div>
          <CoinChip />
        </header>
        {children}
      </div>
    </div>
  )
}

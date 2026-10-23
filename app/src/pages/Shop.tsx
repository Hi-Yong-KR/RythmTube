import { useEffect, useRef, useState } from 'react'
import { loadTossPayments, type TossPaymentsWidgets } from '@tosspayments/tosspayments-sdk'
import Shell from '../components/Shell'
import { buyItem, createOrder, fetchShop, type CoinPackage, type ShopItem } from '../lib/supabase'
import { updateSettings, useSettings } from '../lib/settings'
import { BACKGROUNDS, NOTES } from '../lib/skins'
import { useWallet } from '../lib/wallet'

type Tab = 'background' | 'note' | 'coins'

const TABS: { id: Tab; label: string }[] = [
  { id: 'background', label: '배경' },
  { id: 'note', label: '노트' },
  { id: 'coins', label: '코인 충전' },
]

const TOSS_CLIENT_KEY = (import.meta.env.VITE_TOSS_CLIENT_KEY as string) || 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm'
// 테스트 키(test_)면 실제 돈이 나가지 않는다
const TOSS_TEST = TOSS_CLIENT_KEY.startsWith('test_')

export default function Shop() {
  const [tab, setTab] = useState<Tab>('background')
  const [items, setItems] = useState<ShopItem[]>([])
  const [packages, setPackages] = useState<CoinPackage[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [checkout, setCheckout] = useState<CoinPackage | null>(null)
  const { wallet, setWallet } = useWallet()
  const settings = useSettings()

  useEffect(() => {
    fetchShop()
      .then(({ items, packages }) => {
        setItems(items)
        setPackages(packages)
      })
      .catch(() => setLoadError('상점 정보를 불러오지 못했어요. 새로고침해 주세요.'))
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  async function buy(item: ShopItem) {
    setBusy(item.id)
    try {
      const w = await buyItem(item.id)
      setWallet(w)
      equip(item)
      setToast(`${item.name}을(를) 구매하고 장착했어요.`)
    } catch (e) {
      const code = (e as { code?: string }).code
      setToast(code === 'NOT_ENOUGH_COINS' ? '코인이 부족해요. 코인 충전 탭에서 충전할 수 있어요.' : '구매하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  function equip(item: ShopItem) {
    updateSettings(item.kind === 'background' ? { background: item.id } : { note: item.id })
  }

  const shown = items.filter((i) => i.kind === tab)

  return (
    <Shell top={<h1 className="top-title">상점 · 컬렉션</h1>}>
      <div className="shop">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {loadError && <p className="notice error">{loadError}</p>}

        {tab !== 'coins' ? (
          <div className={`items ${tab}`}>
            {shown.map((item) => {
              const owned = wallet?.owned.includes(item.id) ?? item.price === 0
              const equipped = (item.kind === 'background' ? settings.background : settings.note) === item.id
              return (
                <article key={item.id} className={`item ${equipped ? 'equipped' : ''}`}>
                  {item.kind === 'background' ? (
                    <div className="item-bg" style={{ backgroundImage: `url(${BACKGROUNDS[item.id]?.image})` }}>
                      <img src={BACKGROUNDS[item.id]?.mascot} alt="" />
                    </div>
                  ) : (
                    <NotePreview id={item.id} />
                  )}
                  <div className="item-body">
                    <h3>{item.name}</h3>
                    {equipped ? (
                      <span className="badge">장착 중</span>
                    ) : owned ? (
                      <button className="ghost" onClick={() => equip(item)}>
                        장착하기
                      </button>
                    ) : (
                      <button className="buy" onClick={() => buy(item)} disabled={busy === item.id}>
                        <img src="/assets/items/quick-ball.png" alt="" className="pixel" />
                        <span className="num">{item.price.toLocaleString()}</span>
                        {busy === item.id ? '구매 중…' : '구매'}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="packages">
            <p className="muted">
              코인으로 배경과 노트를 구매할 수 있어요. 충전은 토스페이먼츠로 결제해요.
              {TOSS_TEST && (
                <>
                  {' '}
                  지금은 <b>테스트 키</b>라 실제로 돈이 빠져나가지 않아요.
                </>
              )}
            </p>
            <div className="pkg-grid">
              {packages.map((p, i) => (
                <button key={p.id} className="pkg" onClick={() => setCheckout(p)}>
                  <img src={['/assets/items/poke-ball.png', '/assets/items/great-ball.png', '/assets/items/ultra-ball.png', '/assets/items/master-ball.png'][i] ?? '/assets/items/poke-ball.png'} alt="" className="pixel" />
                  <span className="pkg-coins num">{p.coins.toLocaleString()}</span>
                  <span className="pkg-unit">코인</span>
                  <span className="pkg-price">{p.price_krw.toLocaleString()}원</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {checkout && <Checkout key={checkout.id} pkg={checkout} onClose={() => setCheckout(null)} />}
      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}
    </Shell>
  )
}

function NotePreview({ id }: { id: string }) {
  const s = NOTES[id]
  if (!s) return <div className="item-note" />
  return (
    <div className="item-note">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="note-bar"
          style={{ background: `linear-gradient(${s.top}, ${s.bottom})`, boxShadow: `0 0 14px ${s.glow}`, borderTopColor: s.edge }}
        >
          <img src={s.icon} alt="" className="pixel" />
        </span>
      ))}
    </div>
  )
}

function Checkout({ pkg, onClose }: { pkg: CoinPackage; onClose: () => void }) {
  const { playerId } = useWallet()
  const widgetsRef = useRef<TossPaymentsWidgets | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)

  // 토스 결제위젯은 한 페이지에 한 번만 렌더링할 수 있어서 StrictMode 이중 실행을 막는다
  const started = useRef(false)

  useEffect(() => {
    if (!playerId || started.current) return
    started.current = true
    ;(async () => {
      try {
        const toss = await loadTossPayments(TOSS_CLIENT_KEY)
        const widgets = toss.widgets({ customerKey: playerId })
        await widgets.setAmount({ currency: 'KRW', value: pkg.price_krw })
        await Promise.all([
          widgets.renderPaymentMethods({ selector: '#toss-methods', variantKey: 'DEFAULT' }),
          widgets.renderAgreement({ selector: '#toss-agreement', variantKey: 'AGREEMENT' }),
        ])
        widgetsRef.current = widgets
        setReady(true)
      } catch (e) {
        setError((e as Error).message || '결제창을 불러오지 못했어요.')
      }
    })()
  }, [playerId, pkg.price_krw])

  async function pay() {
    if (!widgetsRef.current) return
    setPaying(true)
    setError(null)
    try {
      const order = await createOrder(pkg.id)
      await widgetsRef.current.requestPayment({
        orderId: order.orderId,
        orderName: order.orderName,
        successUrl: `${location.origin}/payment/success`,
        failUrl: `${location.origin}/payment/fail`,
      })
    } catch (e) {
      setError((e as Error).message || '결제를 시작하지 못했어요.')
      setPaying(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="코인 결제">
      <div className="modal-card">
        <div className="modal-head">
          <h2>
            <span className="num">{pkg.coins.toLocaleString()}</span> 코인 · {pkg.price_krw.toLocaleString()}원
          </h2>
          <button className="detail-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div id="toss-methods" />
        <div id="toss-agreement" />
        {error && <p className="notice error">{error}</p>}
        <button className="start" onClick={pay} disabled={!ready || paying}>
          <span>{paying ? '결제창 여는 중…' : `${pkg.price_krw.toLocaleString()}원 결제하기`}</span>
          <small>{TOSS_TEST ? '토스페이먼츠 테스트 결제' : '토스페이먼츠'}</small>
        </button>
      </div>
    </div>
  )
}

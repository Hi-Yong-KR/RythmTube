import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Shell from '../components/Shell'
import { confirmPayment } from '../lib/supabase'
import { useWallet } from '../lib/wallet'

export function PaymentSuccess() {
  const [params] = useSearchParams()
  const { setWallet } = useWallet()
  const [state, setState] = useState<'confirming' | 'done' | 'error'>('confirming')
  const [message, setMessage] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const paymentKey = params.get('paymentKey')
    const orderId = params.get('orderId')
    const amount = Number(params.get('amount'))
    if (!paymentKey || !orderId || !amount) {
      setState('error')
      setMessage('결제 정보가 올바르지 않아요.')
      return
    }
    confirmPayment(paymentKey, orderId, amount)
      .then((r) => {
        setWallet({ coins: r.coins, owned: r.owned, nickname: r.nickname })
        setState('done')
        setMessage(r.coinsAdded ? `${r.coinsAdded.toLocaleString()} 코인을 충전했어요.` : '이미 충전이 완료된 결제예요.')
      })
      .catch((e) => {
        setState('error')
        setMessage(e.message || '결제 승인에 실패했어요.')
      })
  }, [params, setWallet])

  return (
    <Shell top={<h1 className="top-title">결제</h1>}>
      <div className="pay-result">
        <img src={state === 'error' ? '/assets/anim/94.gif' : '/assets/anim/25.gif'} alt="" />
        <h2>{state === 'confirming' ? '결제를 승인하고 있어요…' : state === 'done' ? '충전 완료' : '충전하지 못했어요'}</h2>
        <p>{message}</p>
        {state !== 'confirming' && (
          <Link className="start" to="/shop">
            <span>상점으로 돌아가기</span>
          </Link>
        )}
      </div>
    </Shell>
  )
}

export function PaymentFail() {
  const [params] = useSearchParams()
  return (
    <Shell top={<h1 className="top-title">결제</h1>}>
      <div className="pay-result">
        <img src="/assets/anim/94.gif" alt="" />
        <h2>결제가 취소되었어요</h2>
        <p>{params.get('message') ?? '결제를 완료하지 못했어요.'}</p>
        <Link className="start" to="/shop">
          <span>상점으로 돌아가기</span>
        </Link>
      </div>
    </Shell>
  )
}

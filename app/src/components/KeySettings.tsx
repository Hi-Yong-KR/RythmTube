import { useEffect, useState } from 'react'
import { DEFAULT_BINDS, HANDS, KEY_COUNTS, keyLabel, RESERVED_CODES, type KeyCount } from '../game/layout'
import { getKeyBinds, getSettings, updateSettings, useSettings } from '../lib/settings'

/**
 * 키 수 선택 + 레인별 조작 키 변경.
 * 레인 버튼을 누르고 원하는 키를 누르면 바뀐다. 다른 레인이 쓰던 키면 서로 맞바꾼다.
 * 플레이 화면에서는 채보가 이미 만들어져 있어 키 수는 못 바꾸고(showCount=false) 조작 키만 바꾼다.
 */
export default function KeySettings({ keys: fixedKeys, showCount = true }: { keys?: KeyCount; showCount?: boolean }) {
  const settings = useSettings()
  const keys = fixedKeys ?? settings.keyCount
  const binds = getKeyBinds(settings, keys)
  const [listening, setListening] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (listening === null) return
    // 캡처 단계에서 먼저 받아서 ESC(닫기)·T(탭)·플레이 입력 같은 다른 단축키로 새지 않게 한다
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.repeat) return
      if (e.code === 'Escape') {
        setListening(null)
        setMessage(null)
        return
      }
      if (RESERVED_CODES.has(e.code) || !e.code) {
        setMessage(`${keyLabel(e.code)}는 일시정지·속도·싱크·시작에 쓰여서 쓸 수 없어요.`)
        return
      }
      const next = [...getKeyBinds(getSettings(), keys)]
      const prev = next.indexOf(e.code)
      if (prev >= 0 && prev !== listening) next[prev] = next[listening]
      next[listening] = e.code
      updateSettings({ keyBinds: { ...getSettings().keyBinds, [keys]: next } })
      setMessage(prev >= 0 && prev !== listening ? `${keyLabel(e.code)}를 쓰던 레인과 키를 맞바꿨어요.` : null)
      setListening(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, keys])

  function reset() {
    const keyBinds = { ...getSettings().keyBinds }
    delete keyBinds[keys]
    updateSettings({ keyBinds })
    setListening(null)
    setMessage(null)
  }

  const isDefault = binds.every((c, i) => c === DEFAULT_BINDS[keys][i])

  return (
    <div className="keyset">
      {showCount && (
        <div className="keyset-count" role="radiogroup" aria-label="키 수">
          {KEY_COUNTS.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={keys === k}
              aria-label={`${k}키`}
              className={keys === k ? 'on' : ''}
              onClick={() => {
                setListening(null)
                updateSettings({ keyCount: k })
              }}
            >
              <span className="num">{k}</span>K
            </button>
          ))}
        </div>
      )}
      <div className="keyset-lanes">
        {binds.map((code, i) => (
          <button
            key={i}
            className={`keyset-lane ${HANDS[keys][i] === 'T' ? 'thumb' : ''} ${listening === i ? 'listening' : ''}`}
            aria-label={`${i + 1}번 레인 키: ${keyLabel(code)}. 눌러서 바꾸기`}
            onClick={(e) => {
              // 포커스가 남아 있으면 SPACE를 눌렀을 때 버튼이 다시 눌린다
              e.currentTarget.blur()
              setMessage(null)
              setListening(listening === i ? null : i)
            }}
          >
            <kbd className="num">{listening === i ? '?' : keyLabel(code)}</kbd>
          </button>
        ))}
      </div>
      <p className="keyset-hint">
        {listening !== null
          ? `${listening + 1}번 레인에 쓸 키를 누르세요 (ESC: 취소)`
          : (message ?? '레인을 누르고 원하는 키를 누르면 조작 키가 바뀌어요.')}
        {!isDefault && listening === null && (
          <button className="keyset-reset" onClick={reset}>
            기본 키로
          </button>
        )}
      </p>
    </div>
  )
}

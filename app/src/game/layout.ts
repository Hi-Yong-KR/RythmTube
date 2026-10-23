// 키 수별 손 배치와 기본 조작 키.
// 노트 배치기는 레인이 어느 손(왼손 L / 엄지 T / 오른손 R)에 속하는지만 보고 사람이 칠 수 있는 배치를 고른다.

export type Hand = 'L' | 'T' | 'R'

export const KEY_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8] as const
export type KeyCount = (typeof KEY_COUNTS)[number]

export const HANDS: Record<KeyCount, Hand[]> = {
  1: ['T'],
  2: ['L', 'R'],
  3: ['L', 'T', 'R'],
  4: ['L', 'L', 'R', 'R'],
  5: ['L', 'L', 'T', 'R', 'R'],
  6: ['L', 'L', 'L', 'R', 'R', 'R'],
  7: ['L', 'L', 'L', 'T', 'R', 'R', 'R'],
  8: ['L', 'L', 'L', 'L', 'R', 'R', 'R', 'R'],
}

/** 기본 조작 키 (KeyboardEvent.code) */
export const DEFAULT_BINDS: Record<KeyCount, string[]> = {
  1: ['Space'],
  2: ['KeyF', 'KeyJ'],
  3: ['KeyF', 'Space', 'KeyJ'],
  4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  5: ['KeyF', 'KeyV', 'Space', 'KeyN', 'KeyJ'],
  6: ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'],
  7: ['KeyS', 'KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK', 'KeyL'],
  8: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
}

/** 레인에 줄 수 없는 키: 일시정지 · 속도/싱크 조절 · 시작 */
export const RESERVED_CODES = new Set(['Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'MetaLeft', 'MetaRight'])

const SYMBOLS: Record<string, string> = {
  Space: 'SPACE',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  ShiftLeft: 'L⇧',
  ShiftRight: 'R⇧',
  ControlLeft: 'LCTRL',
  ControlRight: 'RCTRL',
  AltLeft: 'LALT',
  AltRight: 'RALT',
  CapsLock: 'CAPS',
  Backspace: 'BKSP',
}

export function keyLabel(code: string) {
  if (SYMBOLS[code]) return SYMBOLS[code]
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad/.test(code)) return 'N' + code.slice(6).replace('Decimal', '.').replace('Enter', '↵')
  return code.toUpperCase()
}

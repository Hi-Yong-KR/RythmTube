// 상점 아이템 id → 실제 렌더링에 쓰는 비주얼 정의 (가격/이름은 Supabase shop_items 테이블이 원본)

export interface BackgroundSkin {
  image: string
  /** 기어 뒤 배경을 얼마나 어둡게 덮을지 (0~1) */
  dim: number
  mascot: string
}

export interface NoteSkin {
  /** 막대 노트 그라디언트: 위 → 아래 */
  top: string
  bottom: string
  edge: string
  glow: string
  icon: string
}

export const BACKGROUNDS: Record<string, BackgroundSkin> = {
  'bg-space': { image: '/assets/bg/bg-space.jpg', dim: 0.35, mascot: '/assets/anim/151.gif' },
  'bg-party': { image: '/assets/bg/client-bg-psday.jpg', dim: 0.45, mascot: '/assets/anim/25.gif' },
  'bg-mountain': { image: '/assets/bg/client-bg.jpg', dim: 0.5, mascot: '/assets/anim/133.gif' },
  'bg-ocean': { image: '/assets/bg/client-bg-ocean.jpg', dim: 0.5, mascot: '/assets/anim/39.gif' },
  'bg-shaymin': { image: '/assets/bg/client-bg-shaymin.jpg', dim: 0.6, mascot: '/assets/anim/648.gif' },
  'bg-horizon': { image: '/assets/bg/client-bg-horizon.jpg', dim: 0.35, mascot: '/assets/anim/151.gif' },
  'bg-charizard': { image: '/assets/bg/client-bg-charizards.jpg', dim: 0.4, mascot: '/assets/anim/94.gif' },
}

export const NOTES: Record<string, NoteSkin> = {
  'note-poke': { top: '#ff5a64', bottom: '#d81f2f', edge: '#ffffff', glow: '#ff4d5e', icon: '/assets/items/poke-ball.png' },
  'note-premier': { top: '#ffffff', bottom: '#d9dde8', edge: '#ff4d5e', glow: '#ffffff', icon: '/assets/items/premier-ball.png' },
  'note-great': { top: '#4fa3ff', bottom: '#1d5fd6', edge: '#ff6070', glow: '#4fa3ff', icon: '/assets/items/great-ball.png' },
  'note-ultra': { top: '#4a4a52', bottom: '#1b1b20', edge: '#ffd23f', glow: '#ffd23f', icon: '/assets/items/ultra-ball.png' },
  'note-love': { top: '#ff9ccf', bottom: '#e05aa0', edge: '#ffffff', glow: '#ff7ac0', icon: '/assets/items/love-ball.png' },
  'note-luxury': { top: '#3a3a3f', bottom: '#121214', edge: '#ffcc33', glow: '#ff3344', icon: '/assets/items/luxury-ball.png' },
  'note-quick': { top: '#5cc8ff', bottom: '#1f7fd1', edge: '#ffe14d', glow: '#ffe14d', icon: '/assets/items/quick-ball.png' },
  'note-dusk': { top: '#2f7a3c', bottom: '#0f2f17', edge: '#ff7a2f', glow: '#57ff7a', icon: '/assets/items/dusk-ball.png' },
  'note-beast': { top: '#3b4bff', bottom: '#1a1580', edge: '#ffe14d', glow: '#7d6bff', icon: '/assets/items/beast-ball.png' },
  'note-master': { top: '#a061ff', bottom: '#5b1fc2', edge: '#ff62c8', glow: '#c08bff', icon: '/assets/items/master-ball.png' },
}

export const DEFAULT_BG = 'bg-space'
export const DEFAULT_NOTE = 'note-poke'

export function previewImage(itemId: string) {
  return BACKGROUNDS[itemId]?.image ?? NOTES[itemId]?.icon ?? ''
}

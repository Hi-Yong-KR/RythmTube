// 기기 종류. 터치 화면이면 레인을 손가락으로 치고, 키보드 안내는 숨긴다(html에 touch 클래스).

/** 주로 손가락으로 조작하는 기기 (휴대폰·태블릿) */
export const TOUCH = window.matchMedia?.('(pointer: coarse)').matches ?? false

/** 아이폰·아이패드: 유튜브 음량을 페이지에서 바꿀 수 없다 (기기 볼륨만) */
export const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)

document.documentElement.classList.toggle('touch', TOUCH)

import { IOS } from '../lib/device'
import { updateSettings, useSettings } from '../lib/settings'

/** 음악 음량 슬라이더. 바꾸면 바로 적용되고 다음 플레이에도 유지된다 */
export default function VolumeOpt() {
  const { volume } = useSettings()
  // 아이폰은 유튜브 음량을 페이지에서 못 바꾼다 (기기 볼륨 버튼으로)
  if (IOS) return null
  return (
    <label className="opt volume">
      <span>
        음량 <b className="num">{volume > 0 ? `${volume}%` : '음소거'}</b>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={volume}
        onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
        // 놓으면 포커스를 돌려준다: 슬라이더에 포커스가 남으면 방향키·SPACE가 게임 조작 대신 슬라이더를 움직인다
        onPointerUp={(e) => e.currentTarget.blur()}
        aria-label="음량"
      />
    </label>
  )
}

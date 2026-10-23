import type { MyRank, RankingRow } from '../lib/supabase'

/** 순위표. 내 기록이 목록 밖에 있으면 맨 아래에 따로 붙인다 */
export default function RankList({
  rows,
  me,
  myNickname,
  showAccuracy = false,
}: {
  rows: RankingRow[]
  me: MyRank | null
  myNickname: string | null
  showAccuracy?: boolean
}) {
  const meListed = rows.some((r) => r.is_me)
  return (
    <ol>
      {rows.map((r) => (
        <li key={`${r.rank}-${r.nickname}`} className={r.is_me ? 'me' : ''}>
          <span className={`rk num ${r.rank === 1 ? 'first' : ''}`}>{r.rank}</span>
          <span className="nick">
            {r.nickname}
            {r.is_random && <em className="num rnd">R</em>}
          </span>
          {showAccuracy && <span className="acc num">{Number(r.accuracy).toFixed(2)}%</span>}
          <span className="sc num">{r.score.toLocaleString()}</span>
        </li>
      ))}
      {me && !meListed && myNickname && (
        <li className="me apart">
          <span className="rk num">{me.rank}</span>
          <span className="nick">
            {myNickname}
            {me.is_random && <em className="num rnd">R</em>}
          </span>
          {showAccuracy && <span className="acc num">{Number(me.accuracy).toFixed(2)}%</span>}
          <span className="sc num">{me.score.toLocaleString()}</span>
        </li>
      )}
    </ol>
  )
}

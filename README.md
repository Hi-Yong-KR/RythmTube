# Rythm Tube

유튜브(뮤직) 곡에 맞춰 노트가 내려오는 1~8키 웹 리듬게임. 키 수와 조작 키는 곡 상세에서 바꿀 수 있다.

## 실행

```bash
cd app
npm install
npm run dev
```

## 필요한 API 키와 넣는 곳

| 키 | 용도 | 넣는 곳 | 필수 |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | 랭킹·상점·지갑 | `app/.env.local` | 이미 채워져 있음 |
| `VITE_YOUTUBE_API_KEY` | 곡 검색·카테고리 추천 (YouTube Data API v3) | `app/.env.local` | 없으면 기본 곡 6개만 |
| `VITE_TOSS_CLIENT_KEY` / `TOSS_SECRET_KEY` | 코인 충전 (토스페이먼츠 결제위젯) | 앞은 `app/.env.local`, 뒤는 Supabase Secrets | 선택 (기본은 토스 문서 공개 테스트 키 — 실제 돈이 나가지 않음) |

- `app/.env.local`을 바꾸면 `npm run dev`를 다시 시작한다.
- Supabase Secrets는 대시보드(프로젝트 `rythm-tube` → Edge Functions → Secrets)에서 넣거나 CLI로 넣는다.
  넣은 뒤 함수 재배포는 필요 없다.

- 챗봇 "피카 DJ"는 키가 필요 없다. 아래 [챗봇](#챗봇-피카-dj) 참고.
- YouTube 키는 브라우저에 노출되므로 Google Cloud 콘솔에서 **HTTP 리퍼러 제한**(예: `http://localhost:5173/*`)과
  **YouTube Data API v3만 허용**으로 제한해 두는 것을 권장한다. 검색 1회에 할당량 100단위를 쓴다(기본 하루 10,000).

## 조작

| 키 | 동작 |
| --- | --- |
| 레인 키 | 기본값은 아래 표. 곡 상세(또는 플레이 시작 전·일시정지 화면)에서 레인을 누르고 원하는 키를 누르면 바뀐다 |
| `SPACE` / `ENTER` | 시작 화면에서 바로 시작 |
| `↑` `↓` | 노트 속도 ±0.1 (플레이 중에도 바로 적용) |
| `←` `→` | 싱크 ∓5ms (노트가 음악보다 빨리 오면 →) |
| `ESC` | 일시정지 (일시정지 화면에서도 속도·싱크 조절 가능) |
| `T` | 곡 상세에서 영상 재생 중 박자 탭 → BPM·박 위치 자동 맞춤 |

| 키 수 | 손 배치 | 기본 키 |
| --- | --- | --- |
| 1K | 엄지 | `SPACE` |
| 2K | 왼손 1 · 오른손 1 | `F` `J` |
| 3K | 왼손 1 · 엄지 · 오른손 1 | `F` `SPACE` `J` |
| 4K | 왼손 2 · 오른손 2 | `D` `F` `J` `K` |
| 5K | 왼손 2 · 엄지 · 오른손 2 | `F` `V` `SPACE` `N` `J` |
| 6K | 왼손 3 · 오른손 3 | `S` `D` `F` `J` `K` `L` |
| 7K | 왼손 3 · 엄지 · 오른손 3 | `S` `D` `F` `SPACE` `J` `K` `L` |
| 8K | 왼손 4 · 오른손 4 | `A` `S` `D` `F` `J` `K` `L` `;` |

- 조작 키는 키 수별로 따로 저장된다(브라우저 localStorage). 방향키 · `ESC` · `ENTER` · `TAB`은 레인에 쓸 수 없다.
- 이미 다른 레인이 쓰는 키를 고르면 두 레인의 키를 맞바꾼다.

결과 화면은 평균 타이밍 오차를 보여 주고, 버튼 한 번으로 싱크 보정값에 반영할 수 있다.

## 구조

```
app/src
  game/layout.ts      키 수별 손 배치 · 기본 조작 키
  game/chart.ts       노트 자동 배치 (난이도 = 노트 수, 손 구조 기반 인체공학 규칙, 시드 고정, 랜덤 옵션)
  game/engine.ts      판정(MAX 100% ~ 40%, BREAK) · 점수 · 콤보 · 평균 타이밍
  game/clock.ts       유튜브 재생 시간 보간
  game/renderer.ts    DJMAX 스타일 기어 캔버스 렌더러
  components/ChatPanel.tsx  음악 추천 챗봇 (텍스트 + 마이크 입력)
  lib/localBot.ts     챗봇 모델 (Qwen3.5, 브라우저 WebGPU · JSON 출력: 답장 / 검색어 / 선택할 곡)
  lib/voice.ts        음성 입력 (Whisper, 브라우저 WebGPU)
  pages/              곡 선택 · 플레이 · 결과(랭킹 등록) · 상점 · 결제 결과
supabase/functions
  game-api            지갑 · 아이템 구매 · 토스 결제 주문/승인
```

### 챗봇 "피카 DJ"

API 키 없이 사용자 브라우저 안에서 모델을 직접 돌린다. 둘 다 상업적 이용·수정·재배포가 자유로운 라이선스다.

| 역할 | 모델 | 라이선스 | 라이브러리 | 첫 다운로드 |
| --- | --- | --- | --- | --- |
| 대화 | Qwen3.5 9B (`Qwen3.5-9B-q4f16_1-MLC`) | Apache 2.0 | `@mlc-ai/web-llm` | 약 5GB (챗봇을 처음 켤 때) |
| 음성 → 텍스트 | Whisper large-v3-turbo (`onnx-community/whisper-large-v3-turbo`) | MIT | `@huggingface/transformers` | 약 1.5GB (마이크를 처음 누를 때) |

- 받은 모델은 브라우저 캐시에 남아 다음부터는 바로 켜진다.
- WebGPU가 되는 브라우저(최신 Chrome · Edge)와 그래픽 메모리 약 6.5GB가 필요하다. 사양이 낮으면
  `lib/localBot.ts`의 모델을 `Qwen3.5-4B-q4f16_1-MLC`(더 작음)로 바꿀 수 있지만 조건을 놓치는 일이 늘어난다.
- 같은 질문 7개로 비교한 결과: Qwen3-8B는 "밤편지 말고", "영어 노래" 같은 조건을 자주 놓치고 엉뚱한 곡을 골랐다.
  생각(thinking) 모드는 답 하나에 10초(8B)~80초(9B) 걸려 쓸 수 없었다. Qwen3.5-9B는 생각 모드 없이 2~3초에 조건을 가장 잘 따랐다.
- 음성은 마이크 → Whisper 받아쓰기 → 받아쓴 문장을 그대로 챗봇에 보내는 순서다.

### 난이도와 노트 수

난이도는 플레이 구간 1초당 노트 수를 정한다: NORMAL 2.2 · HARD 3.4 · MAXIMUM 4.8 · SC 6.4.
3분 30초 곡이면 약 450 / 690 / 980 / 1,300개(5키 기준).
키가 많을수록 레인이 넓게 퍼지므로 1K ×0.6 · 2K ×0.72 · 3K ×0.82 · 4K ×0.9 · 6K ×1.1 · 7K ×1.15 · 8K ×1.25로 노트 수를 조정한다
(레인이 적으면 같은 손가락 연타가 많아지므로 줄인다). 후보 노트를 넉넉히 만든 뒤 중요도가 낮은 노트
(동시치기 보조 → 16분 엇박 → 8분 엇박)부터 지워 목표 개수에 맞춘다. 아주 느린 곡의 SC처럼
손 간격 규칙 때문에 목표만큼 못 넣는 경우에는 규칙이 우선한다.

### 노트 배치 규칙

브라우저에서는 유튜브 오디오를 분석할 수 없어서, 곡 길이와 BPM·첫 박 위치로 곡 구조(인트로 → 벌스 → 후렴 …)를 추정한다.

- 레인을 왼손 · 엄지 · 오른손으로 나눠(`layout.ts`), 난이도별 같은 손가락 연타·같은 손 연타의 최소 간격을 강제
- 초당 노트 수 상한, 동시치기 개수 제한(NORMAL은 같은 손 동시치기 금지), 롱노트 중 같은 손 사용 제한
- 같은 곡 · 같은 난이도 · 같은 BPM · 같은 키 수면 항상 같은 채보(5키 채보는 키 수 기능 추가 전과 동일). 랜덤을 켜면 구간마다 손/손가락 배치를 섞고 같은 규칙으로 재검증

### 데이터베이스 (Supabase)

- `rankings` — 곡·난이도·키 수(`key_count`, 1~8)별 랭킹. 누구나 조회·등록 (값 범위는 테이블 제약으로 검사)
- `shop_items`, `coin_packages` — 상품 목록 (공개 조회)
- `players`, `inventory`, `payments` — 지갑. RLS 정책 없이 잠가 두고 `game-api` 엣지 함수만 접근.
  코인은 토스페이먼츠 승인(`confirm_payment`)으로만 지급된다: 서버가 주문 금액을 저장 → 결제위젯 → 성공 페이지에서
  서버가 토스 승인 API를 호출하고 금액·주문번호를 대조한 뒤 지급. (예전 테스트 충전 기록은 `payment_key = 'TEST_MODE'`로 남아 있다.)
- 실제 결제로 바꾸려면 토스페이먼츠 상점의 **라이브 클라이언트 키 / 시크릿 키**를 위 두 곳에 넣는다. 아래 에셋 저작권 주의 참고.

## 에셋 출처

- 포켓몬 스프라이트·아트워크: [PokeAPI/sprites](https://github.com/PokeAPI/sprites)
- 배경: [Pokémon Showdown](https://play.pokemonshowdown.com/fx/) 클라이언트 배경
- 포켓몬은 Nintendo / Creatures / GAME FREAK / The Pokémon Company의 저작물이다.
  이 프로젝트는 개인 학습용이며, 포켓몬 에셋을 쓴 채로 실제 결제로 판매하면 저작권 침해가 된다.

// 음악 추천 챗봇 "피카 DJ" — API 키 없이 사용자 브라우저에서 돌아가는 Qwen3.5 (Apache 2.0, WebLLM/WebGPU)
// 답장(reply)과 함께 유튜브 검색어(search) 또는 화면 목록에서 고를 곡 id(select)를 JSON으로 돌려준다.
import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm'

const SYSTEM = `당신은 웹 리듬게임 "Rythm Tube"의 음악 추천 챗봇 "피카 DJ"예요.
사용자는 유튜브에 올라온 곡을 골라 5키(F V SPACE N J) 리듬게임으로 플레이해요.

할 일
- 기분, 장르, 상황, 좋아하는 가수를 듣고 곡을 추천해요.
- 곡명은 정말 확실할 때만 말해요. 프로그램 이름, 앨범 이름, 다른 가수의 곡을 곡명처럼 말하면 안 돼요.
  확실하지 않으면 곡명을 지어내지 말고 "가수 + 분위기"로 검색해서 화면에 띄워 줘요. 예: search "아이유 잔잔한 노래 official MV"
- 사용자가 추천이나 곡 찾기를 부탁하면 되묻지 말고 바로 search를 채워 곡을 띄워요.
- 곡을 화면에 띄워야 하면 search에 유튜브 검색어 하나를 넣어요. 커버, 리믹스, AI 커버가 아닌 원곡이 나오게 official을 붙여요.
- 사용자가 화면 목록의 특정 곡을 고르거나 플레이하겠다고 분명히 말했을 때만 select에 그 곡의 id를 넣어요. 그냥 추천할 때는 select를 비우고 search를 써요. 목록에 없는 id는 절대 넣지 않아요.
- 해당 없으면 search와 select는 빈 문자열로 둬요.
- 리듬게임 관점의 짧은 팁(빠른 곡은 노트가 많아 어렵다 등)을 곁들여도 좋아요.
- 사용자의 말을 그대로 따라 하지 말고, 공감하는 한마디로 시작해요.
- 음악과 무관한 질문(취향, 일상 등)에는 피카츄 DJ 캐릭터로서 먼저 직접 대답하고(예: 좋아하는 음식은 케첩), 그다음 자연스럽게 음악 이야기로 이어 가요.

reply는 한국어 존댓말 해요체(~해요, ~예요, ~볼까요?)로 2~4문장. 반말(~야, ~해, ~자)은 쓰지 않아요.반드시 {"reply": "...", "search": "...", "select": "..."} 형태의 JSON 하나로만 답해요.`

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    reply: { type: 'string' },
    search: { type: 'string' },
    select: { type: 'string' },
  },
  required: ['reply', 'search', 'select'],
})

export interface ChatReply {
  reply: string
  search: string
  select: string
}

export interface ShownSong {
  videoId: string
  title: string
  channel: string
}

type Turn = { role: 'user' | 'assistant'; content: string }

let engine: Promise<WebWorkerMLCEngine> | null = null

export function webGpuSupported() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

/**
 * 화면에 안내할 모델 정보. 같은 질문으로 비교했을 때 Qwen3-8B는 "밤편지 말고"·"영어 노래" 같은 조건을 자주 놓쳤고,
 * 생각 모드는 답 하나에 10~80초가 걸려서, 생각 모드 없이도 조건을 잘 따르는 Qwen3.5-9B를 쓴다 (그래픽 메모리 약 6.5GB)
 */
export const MODEL_INFO = { name: 'Qwen3.5 9B', size: '약 5GB' }

/** shader-f16을 지원하면 더 가벼운 f16 가중치를 쓴다 */
async function pickModel() {
  const adapter = await navigator.gpu?.requestAdapter()
  if (!adapter) throw new Error('NO_WEBGPU')
  return adapter.features.has('shader-f16') ? 'Qwen3.5-9B-q4f16_1-MLC' : 'Qwen3.5-9B-q4f32_1-MLC'
}

/** 모델을 내려받아 올린다. 처음 한 번만 약 5GB를 받고, 이후엔 브라우저 캐시에서 읽는다. */
export function loadBot(onProgress?: (progress: number, text: string) => void) {
  engine ??= Promise.all([pickModel(), import('@mlc-ai/web-llm')])
    .then(async ([model, { CreateWebWorkerMLCEngine, prebuiltAppConfig }]) => {
      const create = (cacheBackend: 'cache' | 'indexeddb') =>
        CreateWebWorkerMLCEngine(
          new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' }),
          model,
          { appConfig: { ...prebuiltAppConfig, cacheBackend }, initProgressCallback: (r) => onProgress?.(r.progress, r.text) },
          // 기본 4096 토큰은 시스템 안내 + 화면 곡 목록 + 대화 12개를 담기에 빠듯하다
          { context_window_size: 8192 },
        )
      try {
        return await create('cache')
      } catch (e) {
        // 일부 브라우저는 큰 파일을 Cache API에 넣다가 실패한다 → IndexedDB로 한 번 더 시도
        if (!String(e).includes("'Cache'")) throw e
        return create('indexeddb')
      }
    })
    .catch((e) => {
      engine = null
      throw e
    })
  return engine
}

export async function askMusicBot(history: Turn[], shown: ShownSong[]): Promise<ChatReply> {
  const bot = await loadBot()

  // 최근 12개 메시지, 메시지당 600자, 목록 24곡까지만 (작은 모델의 컨텍스트를 아끼기 위해)
  const turns = history.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 600) }))
  while (turns.length && turns[0].role !== 'user') turns.shift()
  const list = shown.length
    ? shown
        .slice(0, 24)
        .map((s, i) => `${i + 1}. ${s.title.slice(0, 120)} — ${s.channel.slice(0, 60)} (id: ${s.videoId})`)
        .join('\n')
    : '(비어 있음)'
  const last = turns.pop()
  if (!last) throw new Error('NO_USER_MESSAGE')

  const res = await bot.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM },
      ...turns,
      { role: 'user', content: `${last.content}\n\n<현재_화면_곡_목록>\n${list}\n</현재_화면_곡_목록>` },
    ],
    response_format: { type: 'json_object', schema: SCHEMA },
    extra_body: { enable_thinking: false },
    temperature: 0.7,
    max_tokens: 400,
  })

  let parsed: Partial<ChatReply> = {}
  try {
    // Qwen 계열은 생각 끄기 표시(<think></think>)를 답 앞에 붙이므로 JSON 부분만 잘라 읽는다
    const raw = res.choices[0]?.message.content ?? ''
    parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
  } catch {
    // 길이 제한에 걸려 JSON이 잘린 경우
  }
  const select = shown.some((s) => s.videoId === parsed.select) ? String(parsed.select) : ''
  return {
    // 한국어 문장 사이에 한자가 한두 글자 섞여 나오는 경우가 있어 지운다
    reply: String(parsed.reply ?? '').replace(/[㐀-䶿一-鿿]/g, '').trim() || '음, 다시 한 번 말해 주시겠어요?',
    search: String(parsed.search ?? '').slice(0, 100),
    select,
  }
}

// 마이크 녹음 → Whisper(MIT, 브라우저 WebGPU)로 한국어 받아쓰기. API 키가 필요 없다.

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>()
let ready: Promise<void> | null = null
let progressListener: ((p: number) => void) | undefined

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data
    if (m.type === 'progress') progressListener?.(m.progress)
    else if (m.type === 'result') pending.get(m.id)?.resolve(m.text)
    else if (m.type === 'error') pending.get(m.id)?.reject(new Error(m.message))
    if (m.type === 'result' || m.type === 'error') pending.delete(m.id)
  }
  return worker
}

/** 음성 인식 모델을 미리 받아 둔다 (첫 사용 때 약 1GB) */
export function loadVoice(onProgress?: (progress: number) => void) {
  progressListener = onProgress
  ready ??= new Promise<void>((resolve, reject) => {
    const w = getWorker()
    const onMsg = (e: MessageEvent) => {
      if (e.data.type === 'ready') resolve()
      else if (e.data.type === 'error' && e.data.id === -1) reject(new Error(e.data.message))
      else return
      w.removeEventListener('message', onMsg)
    }
    w.addEventListener('message', onMsg)
    w.postMessage({ type: 'load' })
  }).catch((e) => {
    ready = null
    throw e
  })
  return ready
}

function transcribe(audio: Float32Array) {
  const id = nextId++
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ type: 'transcribe', id, audio }, [audio.buffer])
  })
}

/** Whisper 입력 형식(16kHz 모노)으로 바꾼다 */
async function toMono16k(blob: Blob) {
  const ctx = new AudioContext({ sampleRate: 16000 })
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    return buf.getChannelData(0).slice()
  } finally {
    ctx.close()
  }
}

export interface Recording {
  /** 녹음을 끝내고 받아쓴 텍스트를 돌려준다 */
  stop: () => Promise<string>
  cancel: () => void
}

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()))
  rec.start()
  const release = () => stream.getTracks().forEach((t) => t.stop())

  return {
    async stop() {
      rec.stop()
      await stopped
      release()
      const audio = await toMono16k(new Blob(chunks, { type: rec.mimeType }))
      if (audio.length < 16000 * 0.3) return ''
      await loadVoice(progressListener)
      return transcribe(audio)
    },
    cancel() {
      if (rec.state !== 'inactive') rec.stop()
      release()
    },
  }
}

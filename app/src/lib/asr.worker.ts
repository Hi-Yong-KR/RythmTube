// Whisper 음성 인식을 별도 스레드에서 돌린다
import { pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from '@huggingface/transformers'

// MIT 라이선스. 한국어 인식률을 우선해 large-v3-turbo를 쓴다 (첫 사용 때 약 1.5GB 다운로드, 이후 브라우저 캐시)
// 디코더를 q4로 줄이면 실제 녹음에서 단어를 통째로 놓쳐서 fp16을 쓴다
const MODEL = 'onnx-community/whisper-large-v3-turbo'

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null

function load() {
  asr ??= pipeline('automatic-speech-recognition', MODEL, {
    device: 'webgpu',
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'fp16' },
    progress_callback: (p: ProgressInfo) => {
      if (p.status === 'progress_total') self.postMessage({ type: 'progress', progress: p.progress / 100 })
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>
  return asr
}

self.onmessage = async (e: MessageEvent<{ type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array }>) => {
  const msg = e.data
  try {
    const pipe = await load()
    if (msg.type === 'load') {
      self.postMessage({ type: 'ready' })
      return
    }
    const out = await pipe(msg.audio, { language: 'korean', task: 'transcribe', chunk_length_s: 30 })
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim()
    self.postMessage({ type: 'result', id: msg.id, text })
  } catch (err) {
    asr = null
    self.postMessage({ type: 'error', id: 'id' in msg ? msg.id : -1, message: String(err) })
  }
}

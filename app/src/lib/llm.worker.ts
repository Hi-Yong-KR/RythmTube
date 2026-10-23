// WebLLM 엔진을 별도 스레드에서 돌린다 (모델 추론 중에도 화면이 멈추지 않게)
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg)

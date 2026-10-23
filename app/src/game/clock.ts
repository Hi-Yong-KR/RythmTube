// YouTube 플레이어의 getCurrentTime()은 수십~수백 ms 단위로 계단식으로 갱신된다.
// performance.now()로 사이를 보간하고, 실제 값과 크게 어긋날 때만 다시 맞춘다.

export class SongClock {
  private anchorMs = 0
  private anchorPerf = 0
  private lastRaw = -1
  private running = false

  constructor(private player: { getCurrentTime(): number }) {}

  start() {
    this.running = true
    this.resync(performance.now(), true)
  }

  stop() {
    this.resync(performance.now(), true)
    this.running = false
  }

  /** perfNow 시점의 영상 시간(ms) */
  at(perfNow: number) {
    if (!this.running) return this.anchorMs
    return this.anchorMs + (perfNow - this.anchorPerf)
  }

  /** 매 프레임 호출 */
  tick(perfNow: number) {
    this.resync(perfNow, false)
    return this.at(perfNow)
  }

  private resync(perfNow: number, force: boolean) {
    const raw = this.player.getCurrentTime() * 1000
    if (!force && raw === this.lastRaw) return
    this.lastRaw = raw
    const predicted = this.anchorMs + (perfNow - this.anchorPerf)
    const drift = raw - predicted
    if (force || !this.running || Math.abs(drift) > 90) {
      this.anchorMs = raw
      this.anchorPerf = perfNow
    } else {
      // 작은 오차는 천천히 따라간다 (화면이 튀지 않게)
      this.anchorMs += drift * 0.1
    }
  }
}

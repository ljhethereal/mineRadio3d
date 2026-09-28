export interface StyleFeatures {
  bpm: number
  energy: number
  brightness: number
  bassRatio: number
}

const KEYWORDS: Array<[RegExp, string]> = [
  [/remix|dj\b|电音|电子|edm|蹦迪|舞曲|nightcore/i, 'ELECTRO'],
  [/摇滚|朋克|金属|rock\b|metal\b/i, 'ROCK'],
  [/古风|戏腔|国风/i, 'ANCIENT'],
  [/民谣|folk/i, 'FOLK'],
  [/纯音乐|轻音乐|钢琴|演奏|钢琴曲|instrumental/i, 'PIANO'],
  [/爵士|jazz|蓝调|blues/i, 'JAZZ'],
  [/说唱|rap|嘻哈|hip.?hop/i, 'RAP'],
  [/动漫|acg|游戏|ost\b/i, 'ANIME'],
  [/儿歌|童谣/i, 'PLAYFUL'],
  [/治愈|安静|睡眠|助眠|冥想/i, 'HEAL'],
]

export function keywordStyle(title: string, author = ''): string | null {
  const s = `${title} ${author}`.toLowerCase()
  for (const [re, tag] of KEYWORDS) {
    if (re.test(s)) return tag
  }
  return null
}

export function estimateBpm(rmsSeries: number[], intervalMs: number): number {
  if (rmsSeries.length < 20) return 0
  const max = Math.max(...rmsSeries)
  if (max < 0.045) return 0
  const thresh = max * 0.65
  const peaks: number[] = []
  for (let i = 1; i < rmsSeries.length - 1; i++) {
    const v = rmsSeries[i]
    if (v > thresh && v >= rmsSeries[i - 1] && v >= rmsSeries[i + 1]) {
      const last = peaks[peaks.length - 1]
      if (last === undefined || i - last >= Math.round(250 / intervalMs)) peaks.push(i)
    }
  }
  if (peaks.length < 2) return 0
  const intervals: number[] = []
  for (let i = 1; i < peaks.length; i++) {
    const sec = ((peaks[i] - peaks[i - 1]) * intervalMs) / 1000
    if (sec >= 0.25 && sec <= 2.5) intervals.push(sec)
  }
  if (!intervals.length) return 0
  intervals.sort((a, b) => a - b)
  const med = intervals[Math.floor(intervals.length / 2)]
  return Math.round(Math.max(50, Math.min(210, 60 / med)))
}

export function computeStyleFeatures(
  rmsSeries: number[],
  freqSum: Float32Array,
  freqReads: number
): StyleFeatures {
  const energy = rmsSeries.reduce((a, b) => a + b, 0) / rmsSeries.length
  let num = 0
  let sum = 0
  let bass = 0
  const n = freqSum.length
  for (let i = 0; i < n; i++) {
    const a = freqSum[i]
    num += i * a
    sum += a
    if (i <= 2) bass += a
  }
  const brightness = sum > 0 ? num / sum / n : 0.5
  const bassRatio = sum > 0 ? bass / sum : 0.3
  return { bpm: estimateBpm(rmsSeries, 40), energy, brightness, bassRatio }
}

export function audioStyleTag(f: StyleFeatures): string {
  const { bpm, energy, brightness, bassRatio } = f
  const quiet = energy < 0.055
  const loud = energy > 0.12
  const bright = brightness > 0.22
  const dark = brightness < 0.08
  if (bpm >= 132) {
    if (quiet) return 'BOUNCE'
    return bright ? 'HYPE' : 'ELECTRO'
  }
  if (bpm >= 96) {
    if (loud) return bright ? 'SPARK' : 'GROOVE'
    return 'POP'
  }
  if (bpm >= 1) {
    if (quiet) return bright ? 'ETHER' : 'CHILL'
    if (dark) return bassRatio > 0.45 ? 'DEEP' : 'RETRO'
    return 'MELODY'
  }
  if (quiet) return bright ? 'ETHER' : 'CHILL'
  if (loud) return 'BEAT'
  return 'MELODY'
}

export function detectSongStyle(title: string, f: StyleFeatures, author = ''): string {
  return keywordStyle(title, author) || audioStyleTag(f)
}

export function analyzeAudio(analyser: AnalyserNode, signal?: AbortSignal): Promise<StyleFeatures> {
  return new Promise((resolve, reject) => {
    const fftSize = analyser.fftSize
    const binCount = analyser.frequencyBinCount
    const timeBuf = new Uint8Array(fftSize)
    const freqSum = new Float32Array(binCount)
    const rmsSeries: number[] = []
    const intervalMs = 40
    const totalMs = 3600
    const freqEvery = 5
    let freqReads = 0
    let elapsed = 0
    const finish = () => window.clearInterval(timer)
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      finish()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(timeBuf)
      let sum = 0
      for (let i = 0; i < fftSize; i++) {
        const v = (timeBuf[i] - 128) / 128
        sum += v * v
      }
      rmsSeries.push(Math.sqrt(sum / fftSize))
      if (elapsed % (intervalMs * freqEvery) === 0) {
        const freq = new Uint8Array(binCount)
        analyser.getByteFrequencyData(freq)
        for (let i = 0; i < binCount; i++) freqSum[i] += freq[i]
        freqReads++
      }
      elapsed += intervalMs
      if (elapsed >= totalMs) {
        finish()
        signal?.removeEventListener('abort', onAbort)
        if (freqReads > 0) {
          for (let i = 0; i < binCount; i++) freqSum[i] /= freqReads
        }
        resolve(computeStyleFeatures(rmsSeries, freqSum, freqReads))
      }
    }, intervalMs)
  })
}
export interface LrcLine {
  time: number
  text: string
}

/** 解析 LRC 歌词文本：支持多个时间戳、[offset:] 偏移、忽略元数据标签 */
export function parseLrc(raw: string): LrcLine[] {
  if (!raw) return []
  const lines = raw.split(/\r?\n/)
  let metadataOffset = 0
  const result: LrcLine[] = []

  const timeTagRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

  for (const line of lines) {
    const trim = line.trim()
    if (!trim) continue

    const offsetMatch = /\[offset:([+-]?\d+)\]/i.exec(trim)
    if (offsetMatch) {
      metadataOffset = Number(offsetMatch[1])
      continue
    }

    if (/^\[(ti|ar|al|by|re|ve):/i.test(trim)) continue

    const timeMatches = [...trim.matchAll(timeTagRe)]
    if (timeMatches.length === 0) continue

    const text = trim.replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim()
    if (!text) continue

    for (const m of timeMatches) {
      const min = Number(m[1])
      const sec = Number(m[2])
      const fracRaw = m[3] || '0'
      let frac = Number(fracRaw)
      if (fracRaw.length === 1) frac *= 100
      else if (fracRaw.length === 2) frac *= 10
      result.push({ time: min * 60 + sec + frac / 1000, text })
    }
  }

  const adjust = metadataOffset / 1000
  return result
    .map((l) => ({ time: Math.max(0, l.time + adjust), text: l.text }))
    .sort((a, b) => a.time - b.time)
}

/** 根据当前播放时间返回正在播放的歌词下标（-1 表示尚无匹配行） */
export function findLyricIndex(lines: LrcLine[], currentTime: number): number {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) idx = i
    else break
  }
  return idx
}
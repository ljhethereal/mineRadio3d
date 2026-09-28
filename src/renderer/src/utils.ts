export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    wav: 'audio/wav',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime'
  }
  return map[ext] || 'application/octet-stream'
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/**
 * 从 B 站视频标题中提取可用的歌曲搜索关键词：
 * 去掉括号内容、常见杂质关键词，以及 "-" 等分隔符后的 UP 主/来源部分
 */
export function cleanSongKeyword(title: string): string {
  if (!title) return ''
  const t = title.replace(/[[【(（].*?[\]】)）]/g, ' ')
  const main = t.split(/[-—–|~·]+/)[0].trim()
  const cleaned = main
    .replace(
      /\s*(?:mv|live|cover|remix|翻唱|纯音乐|伴奏|官方|高清|完整版|字幕|现场|钢琴|吉他|小提琴|演唱会|无损|动态歌词)\s*.*$/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim()
  const candidate = cleaned.length >= 2 ? cleaned : t.trim()
  return candidate.replace(/\s+/g, ' ').trim()
}

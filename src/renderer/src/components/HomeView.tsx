import { useEffect, useMemo, useRef } from 'react'
import { MediaItem } from '../types'

interface Stat {
  plays: number
  seconds: number
  lastPlayed: number
}

export type HomeNavTab = 'home' | 'playlist' | 'stats' | 'recommend' | 'settings'

interface HomeViewProps {
  playlist: MediaItem[]
  currentIndex: number
  currentItem: MediaItem | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  likedIds: Set<string>
  playStats: Record<string, Stat>
  onTogglePlay: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (t: number) => void
  onVolumeChange: (v: number) => void
  onToggleLike: (item: MediaItem) => void
  onPlay: (index: number) => void
  onStart: () => void
  onNavigate: (tab: HomeNavTab) => void
  onImportFiles: () => void
  onImportFolder: () => void
}

// 每日轮换标语：按「年内第几天」取模，日期与文案每天一换
const SLAGANS = [
  '星海之下必有回响',
  '于深空之中聆听风语',
  '把今天交给一段旋律',
  '寂静宇宙因你而鸣',
  '穿越光年的共鸣',
  '数据流里的银河'
]

const PALETTE = [
  [234, 255, 251, 0.62],
  [0, 245, 212, 0.58],
  [120, 160, 255, 0.56],
  [244, 210, 138, 0.55],
  [255, 120, 160, 0.5]
]

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return m + ':' + (ss < 10 ? '0' : '') + ss
}

function HomeView({
  playlist,
  currentItem,
  isPlaying,
  currentTime,
  duration,
  volume,
  likedIds,
  playStats,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onVolumeChange,
  onToggleLike,
  onPlay,
  onStart,
  onNavigate,
  onImportFiles,
  onImportFolder
}: HomeViewProps) {
  const tiltRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  /* 每天一换：日期 + 竖排标语文案 */
  const dayInfo = useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const start = new Date(y, 0, 0)
    const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000)
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
    return {
      date: `${y} / ${m} / ${d}`,
      week,
      slogan: SLAGANS[dayOfYear % SLAGANS.length]
    }
  }, [])

  /* 最近播放：真实 lastPlayed 排序，无记录回退歌单尾部 */
  const recentItems = useMemo(() => {
    const withTs = playlist
      .map((item, idx) => ({ item, idx, last: playStats[item.id]?.lastPlayed || 0 }))
      .filter((x) => x.last > 0)
      .sort((a, b) => b.last - a.last)
      .slice(0, 6)
    if (withTs.length > 0) return withTs
    return playlist
      .map((item, idx) => ({ item, idx, last: 0 }))
      .slice(-6)
      .reverse()
  }, [playlist, playStats])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const isLiked = !!currentItem && likedIds.has(currentItem.path)

  /* 粒子星空 + 2.5D 视差弹簧：单条 rAF 驱动（星空不参与旋转） */
  useEffect(() => {
    const canvas = canvasRef.current
    const tilt = tiltRef.current
    const stage = stageRef.current
    if (!canvas || !tilt || !stage) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let W = 0, H = 0
    let stars: {
      x: number; y: number; r: number; a: number; tw: number; ph: number
      vx: number; vy: number; col: string
    }[] = []
    let meteors: { x: number; y: number; vx: number; vy: number; life: number }[] = []
    let auroras: { x: number; y: number; r: number; col: string; a: number; ph: number }[] = []
    let bursts: { x: number; y: number; vx: number; vy: number; life: number; r: number; col: string }[] = []
    let shockwaves: { x: number; y: number; r: number; life: number; col: string }[] = []
    let cx = -500, cy = -500, tx = -9999, ty = -9999

    const MAX_ANGLE = 5
    const MAX_FLOAT = 26
    const K = 60, D = 14
    const spring = { rx: 0, ry: 0, fx: 0, fy: 0, vx: 0, vy: 0, ux: 0, uy: 0 }
    let nx = 0, ny = 0
    let fit = 1

    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // 窗口自适应：按设计尺寸(1100x620)等比缩放三栏布局，留出标题栏/边距余量
      const availW = Math.max(320, W - 56)
      const availH = Math.max(280, H - 36 - 56)
      fit = Math.min(1.15, Math.max(0.55, Math.min(availW / 1100, availH / 620)))
      const count = Math.min(320, Math.round((W * H) / 9000))
      stars = []
      for (let i = 0; i < count; i++) {
        const c = PALETTE[(Math.random() * PALETTE.length) | 0]
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: Math.random() < 0.8 ? 0.5 + Math.random() * 1.1 : 1.6 + Math.random() * 1.2,
          a: 0.18 + Math.random() * 0.42,
          tw: 0.8 + Math.random() * 2.4,
          ph: Math.random() * Math.PI * 2,
          vx: -2.4 + Math.random() * 2.4,
          vy: 0.2 + Math.random() * 0.8,
          col: 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ','
        })
      }
      auroras = [
        { x: W * 0.2, y: H * 0.75, r: Math.max(W, H) * 0.65, col: '0,245,212', a: 0.11, ph: 0 },
        { x: W * 0.8, y: H * 0.2, r: Math.max(W, H) * 0.7, col: '58,108,255', a: 0.11, ph: 2.1 },
        { x: W * 0.7, y: H * 0.85, r: Math.max(W, H) * 0.6, col: '244,210,138', a: 0.09, ph: 4.2 },
        { x: W * 0.5, y: H * 0.5, r: Math.max(W, H) * 0.42, col: '255,120,160', a: 0.06, ph: 1.2 }
      ]
    }

    const maybeMeteor = () => {
      if (Math.random() > 0.008) return
      meteors.push({
        x: Math.random() * W * 0.8 + W * 0.2,
        y: Math.random() * H * 0.4,
        vx: -(9 + Math.random() * 9),
        vy: 4 + Math.random() * 5,
        life: 1
      })
    }

    const drawStars = () => {
      ctx.clearRect(0, 0, W, H)
      const now = performance.now() / 1000

      // 极光星云：缓慢漂移的大范围柔光
      for (let i = 0; i < auroras.length; i++) {
        const a = auroras[i]
        const ax = a.x + Math.sin(now * 0.05 + a.ph) * 140
        const ay = a.y + Math.cos(now * 0.04 + a.ph) * 90
        const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, a.r)
        g.addColorStop(0, 'rgba(' + a.col + ',' + a.a + ')')
        g.addColorStop(0.55, 'rgba(' + a.col + ',' + (a.a * 0.45) + ')')
        g.addColorStop(1, 'rgba(' + a.col + ',0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
      }

      // 光标柔光：跟随鼠标（弹簧平滑）
      if (tx > -1000) {
        cx += (tx - cx) * 0.09
        cy += (ty - cy) * 0.09
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 420)
        g.addColorStop(0, 'rgba(0,245,212,0.16)')
        g.addColorStop(0.4, 'rgba(58,108,255,0.08)')
        g.addColorStop(1, 'rgba(58,108,255,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
      }

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i]
        const alpha = s.a * (0.6 + 0.4 * Math.sin(now * s.tw + s.ph))
        ctx.fillStyle = s.col + alpha.toFixed(3) + ')'
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
        // 大星十字星芒 + 光晕
        if (s.r > 1.35) {
          const fl = 0.5 + 0.5 * Math.sin(now * s.tw + s.ph)
          const len = 5 + s.r * 5.5 * fl
          ctx.strokeStyle = s.col + (alpha * 0.7).toFixed(3) + ')'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(s.x - len, s.y); ctx.lineTo(s.x + len, s.y)
          ctx.moveTo(s.x, s.y - len); ctx.lineTo(s.x, s.y + len)
          ctx.stroke()
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 9)
          g.addColorStop(0, s.col + (alpha * 0.5).toFixed(3) + ')')
          g.addColorStop(1, s.col + '0)')
          ctx.fillStyle = g
          ctx.fillRect(s.x - s.r * 9, s.y - s.r * 9, s.r * 18, s.r * 18)
        }
        s.x += s.vx * 0.016
        s.y += s.vy * 0.016
        if (s.x < -2) s.x = W + 2
        else if (s.x > W + 2) s.x = -2
        if (s.y > H + 2) s.y = -2
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]
        m.x += m.vx * 0.016
        m.y += m.vy * 0.016
        m.life -= 0.02
        if (m.life <= 0) { meteors.splice(i, 1); continue }
        const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 6, m.y - m.vy * 6)
        grad.addColorStop(0, 'rgba(234,255,251,' + (m.life * 0.55).toFixed(3) + ')')
        grad.addColorStop(1, 'rgba(234,255,251,0)')
        ctx.strokeStyle = grad
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(m.x, m.y)
        ctx.lineTo(m.x - m.vx * 6, m.y - m.vy * 6)
        ctx.stroke()
      }

      // 点击迸发粒子
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i]
        b.x += b.vx * 0.016
        b.y += b.vy * 0.016
        b.vx *= 0.94
        b.vy *= 0.94
        b.life -= 0.02
        if (b.life <= 0) { bursts.splice(i, 1); continue }
        ctx.fillStyle = b.col + (b.life * 0.85).toFixed(3) + ')'
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r * b.life, 0, Math.PI * 2)
        ctx.fill()
      }

      // 点击冲击波
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i]
        sw.r += 14
        sw.life -= 0.035
        if (sw.life <= 0) { shockwaves.splice(i, 1); continue }
        ctx.strokeStyle = sw.col + (sw.life * 0.8).toFixed(3) + ')'
        ctx.lineWidth = 2.5 * sw.life
        ctx.beginPath()
        ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2)
        ctx.stroke()
        const g = ctx.createRadialGradient(sw.x, sw.y, 0, sw.x, sw.y, sw.r)
        g.addColorStop(0, sw.col + (sw.life * 0.22).toFixed(3) + ')')
        g.addColorStop(1, sw.col + '0)')
        ctx.fillStyle = g
        ctx.fillRect(sw.x - sw.r, sw.y - sw.r, sw.r * 2, sw.r * 2)
      }
    }

    const step = (val: number, vel: number, target: number, dt: number): [number, number] => {
      const f = Math.min(dt, 0.05)
      vel += (target - val) * K * f
      vel *= Math.exp(-D * f)
      val += vel * f
      return [val, vel]
    }

    const apply = () => {
      tilt.style.transform =
        'rotateX(' + spring.rx.toFixed(3) + 'deg) ' +
        'rotateY(' + spring.ry.toFixed(3) + 'deg) scale(' + (1.06 * fit).toFixed(3) + ')'
      const wraps = stage.querySelectorAll('.card-wrap')
      for (let i = 0; i < wraps.length; i++) {
        const w = wraps[i] as HTMLElement
        const d = parseFloat(w.dataset.depth || '') || 0
        w.style.transform =
          'translate3d(' + (spring.fx * d).toFixed(2) + 'px, ' +
          (spring.fy * d).toFixed(2) + 'px, var(--zd))'
      }
    }

    const onMove = (e: MouseEvent) => {
      nx = (e.clientX / window.innerWidth - 0.5) * 2
      ny = (e.clientY / window.innerHeight - 0.5) * 2
      tx = e.clientX
      ty = e.clientY
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t && t.closest && t.closest('.card-wrap, button')) return
      if (reduceMotion) return
      const c = PALETTE[(Math.random() * PALETTE.length) | 0]
      for (let i = 0; i < 42; i++) {
        const ang = Math.random() * Math.PI * 2
        const sp = 60 + Math.random() * 280
        bursts.push({
          x: e.clientX,
          y: e.clientY,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          life: 0.6 + Math.random() * 0.6,
          r: 0.8 + Math.random() * 2.2,
          col: 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ','
        })
      }
      shockwaves.push({
        x: e.clientX,
        y: e.clientY,
        r: 4,
        life: 1,
        col: 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ','
      })
    }
    const onLeave = (e: MouseEvent) => {
      if (!(e as MouseEvent).relatedTarget) { nx = 0; ny = 0 }
    }
    const reset = () => { nx = 0; ny = 0 }

    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseout', onLeave)
    window.addEventListener('blur', reset)
    window.addEventListener('resize', resize)
    window.addEventListener('click', onClick)
    resize()
    apply()

    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = (now - last) / 1000
      last = now
      drawStars()
      maybeMeteor()
      if (reduceMotion) return
      const trx = -ny * MAX_ANGLE, try_ = nx * MAX_ANGLE
      const tfx = -nx * MAX_FLOAT, tfy = -ny * MAX_FLOAT
      const r1 = step(spring.rx, spring.vx, trx, dt)
      const r2 = step(spring.ry, spring.vy, try_, dt)
      const r3 = step(spring.fx, spring.ux, tfx, dt)
      const r4 = step(spring.fy, spring.uy, tfy, dt)
      spring.rx = r1[0]; spring.vx = r1[1]
      spring.ry = r2[0]; spring.vy = r2[1]
      spring.fx = r3[0]; spring.ux = r3[1]
      spring.fy = r4[0]; spring.uy = r4[1]
      apply()
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseout', onLeave)
      window.removeEventListener('blur', reset)
      window.removeEventListener('resize', resize)
      window.removeEventListener('click', onClick)
    }
  }, [])

  const menu = (no: string, label: string, en: string, onClick: () => void, primary = false) => (
    <div className="card-wrap zd-24" data-depth="1.1">
      <button className={`glass home-menu${primary ? ' primary' : ''}`} onClick={onClick}>
        <span className="no">{no}</span>
        <span className="body">
          <span className="lb">{label}</span>
          <span className="en">{en}</span>
        </span>
        {isPlaying && primary && (
          <span className="eq playing" aria-hidden="true"><span /><span /><span /><span /><span /></span>
        )}
      </button>
    </div>
  )

  return (
    <div className="home-screen">
      <div className="nebula" aria-hidden="true" />
      <canvas ref={canvasRef} className="home-stars" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      <div className="scene">
        <div className="tilt" ref={tiltRef}>
          <div className="home-stage" ref={stageRef}>
            {/* 左侧菜单 */}
            <nav className="rail left" aria-label="主导航">
              {menu('01', '首页', 'HOME', () => onNavigate('home'))}
              {menu('02', '开始播放', 'START PLAYBACK', onStart, true)}
              {menu('03', '自定义歌单', 'PLAYLISTS', () => onNavigate('playlist'))}
              {menu('04', '常听排行', 'TOP LISTENED', () => onNavigate('stats'))}
              {menu('05', '每日推荐', 'BILIBILI PICK', () => onNavigate('recommend'))}
            </nav>

            {/* 中央竖排今日标语 */}
            <div className="card-wrap center-wrap zd-48" data-depth="1.6">
              <div className="glass slogan">
                <div className="slogan-top">{dayInfo.date} · {dayInfo.week}</div>
                <div className="slogan-text">{dayInfo.slogan}</div>
                <div className="slogan-line" />
                <div className="slogan-sub">MINE RADIO 3D</div>
              </div>
            </div>

            {/* 右侧：正在热播 + 最近播放/队列（真实数据） */}
            <div className="rail right">
              <div className="card-wrap zd-48" data-depth="2.0">
                <div className="glass home-player">
                  <div className="hero-label">NOW PLAYING · 正在热播</div>
                  {currentItem ? (
                    <>
                      <div className="hero-title">{currentItem.name.replace(/\.[^/.]+$/, '')}</div>
                      <div className="hero-meta">
                        {currentItem.source === 'bilibili' ? 'Bilibili 音频' : '本地音频'} · {fmt(duration)}
                      </div>

                      <div className="progress-row">
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0.1, duration)}
                          step={0.1}
                          value={currentTime}
                          onChange={(e) => onSeek(Number(e.currentTarget.value))}
                          aria-label="播放进度"
                        />
                        <span className="progress-time">{fmt(currentTime)} / {fmt(duration)}</span>
                      </div>

                      <div className="hero-actions">
                        <button className="btn-icon" aria-label="上一首" onClick={onPrev}>⏮</button>
                        <button className="btn-play" aria-label="播放/暂停" onClick={onTogglePlay}>
                          {isPlaying ? '⏸' : '▶'}
                        </button>
                        <button className="btn-icon" aria-label="下一首" onClick={onNext}>⏭</button>
                        {isPlaying && (
                          <div className="eq playing" aria-hidden="true"><span /><span /><span /><span /><span /></div>
                        )}
                        <button
                          className={`btn-icon${isLiked ? ' liked' : ''}`}
                          aria-label="收藏"
                          onClick={() => currentItem && onToggleLike(currentItem)}
                        >
                          {isLiked ? '♥' : '♡'}
                        </button>
                      </div>

                      <div className="player-volume">
                        <span className="vol-ico">🔊</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={volume}
                          onChange={(e) => onVolumeChange(Number(e.currentTarget.value))}
                          aria-label="音量"
                        />
                        <span className="vol-pct">{Math.round(volume * 100)}%</span>
                      </div>
                    </>
                  ) : (
                    <div className="home-empty">
                      <strong>还没有在播放的歌曲</strong>
                      <span>导入本地音乐，或点击菜单开始</span>
                      <div className="home-empty-actions">
                        <button className="btn-primary" onClick={onImportFiles}>导入本地音乐</button>
                        <button onClick={onImportFolder}>导入文件夹</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="card-wrap zd-24" data-depth="1.5">
                <div className="glass home-queue">
                  <div className="card-title">最近播放 · 队列 <span className="tag">QUEUE</span></div>
                  {recentItems.length > 0 ? (
                    <div className="queue">
                      {recentItems.map(({ item, idx }) => (
                        <div className="song" key={item.id} onClick={() => onPlay(idx)}>
                          <span className="idx">{idx + 1}</span>
                          <span className="name">{item.name.replace(/\.[^/.]+$/, '')}</span>
                          <span className="src">{item.source === 'bilibili' ? 'Bilibili' : '本地'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="home-empty compact">
                      <span>歌单为空</span>
                      <button onClick={onImportFiles}>导入本地音乐</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HomeView
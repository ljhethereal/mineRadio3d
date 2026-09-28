import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { MediaItem, ReverbPreset } from '../types'
import { formatTime } from '../utils'
import { LrcLine, findLyricIndex } from '../utils/lrc'

interface VisualizerProps {
  mediaElement: HTMLMediaElement | null
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  dataArrayRef: React.MutableRefObject<Uint8Array | null>
  isPlaying: boolean
  isFullscreen: boolean
  title?: string | null
  playlist: MediaItem[]
  currentIndex: number
  durations?: Record<string, number>
  onHistorySelect?: (index: number) => void
  reverbAmount?: number
  reverbPreset?: ReverbPreset
  lyricsLines?: LrcLine[]
  lyricsCurrentTime?: number
  lyricsVisible?: boolean
  lyricOffset?: number
  onLyricsAdjust?: (delta: number) => void
  onLyricsSearch?: () => void
  styleTag?: string
}

const dotTexture = createGlowTexture()
const discTexture = createDiscTexture()

// 风格标签视觉：按标签情绪选用系统手写/展示字体 + 渐变配色（路线A）
type GenreMood = 'bold' | 'script' | 'playful' | 'ancient'

const GENRE_STYLES: Record<string, { font: string; mood: GenreMood }> = {
  ELECTRO: { font: "Impact, 'Arial Black', 'Franklin Gothic Bold', sans-serif", mood: 'bold' },
  ROCK: { font: "Impact, 'Arial Black', 'Franklin Gothic Bold', sans-serif", mood: 'bold' },
  HYPE: { font: "Impact, 'Arial Black', 'Franklin Gothic Bold', sans-serif", mood: 'bold' },
  GROOVE: { font: "Impact, 'Arial Black', 'Franklin Gothic Bold', sans-serif", mood: 'bold' },
  BEAT: { font: "Impact, 'Arial Black', 'Franklin Gothic Bold', sans-serif", mood: 'bold' },
  RAP: { font: "Impact, 'Arial Black', 'Franklin Gothic Bold', sans-serif", mood: 'bold' },
  RETRO: { font: "Impact, 'Arial Black', 'Franklin Gothic Bold', sans-serif", mood: 'bold' },
  ANCIENT: { font: "'Old English Text MT', 'Papyrus', 'Cinzel', serif", mood: 'ancient' },
  MELODY: { font: "'Brush Script MT', 'Edwardian Script ITC', 'Monotype Corsiva', 'Segoe Script', cursive", mood: 'script' },
  CHILL: { font: "'Brush Script MT', 'Edwardian Script ITC', 'Monotype Corsiva', 'Segoe Script', cursive", mood: 'script' },
  ETHER: { font: "'Brush Script MT', 'Edwardian Script ITC', 'Monotype Corsiva', 'Segoe Script', cursive", mood: 'script' },
  DEEP: { font: "'Brush Script MT', 'Edwardian Script ITC', 'Monotype Corsiva', 'Segoe Script', cursive", mood: 'script' },
  HEAL: { font: "'Brush Script MT', 'Edwardian Script ITC', 'Monotype Corsiva', 'Segoe Script', cursive", mood: 'script' },
  PIANO: { font: "'Brush Script MT', 'Edwardian Script ITC', 'Monotype Corsiva', 'Segoe Script', cursive", mood: 'script' },
  FOLK: { font: "'Brush Script MT', 'Edwardian Script ITC', 'Monotype Corsiva', 'Segoe Script', cursive", mood: 'script' },
  JAZZ: { font: "'Brush Script MT', 'Edwardian Script ITC', 'Monotype Corsiva', 'Segoe Script', cursive", mood: 'script' },
  POP: { font: "'Brush Script MT', 'Edwardian Script ITC', 'Monotype Corsiva', 'Segoe Script', cursive", mood: 'script' },
  BOUNCE: { font: "'Comic Sans MS', 'Segoe Print', 'Lucida Handwriting', cursive", mood: 'playful' },
  SPARK: { font: "'Comic Sans MS', 'Segoe Print', 'Lucida Handwriting', cursive", mood: 'playful' },
  ANIME: { font: "'Comic Sans MS', 'Segoe Print', 'Lucida Handwriting', cursive", mood: 'playful' },
  PLAYFUL: { font: "'Comic Sans MS', 'Segoe Print', 'Lucida Handwriting', cursive", mood: 'playful' }
}

const DEFAULT_GENRE_STYLE = GENRE_STYLES.MELODY

function genreStyleFor(tag: string): { font: string; mood: GenreMood } {
  return GENRE_STYLES[tag] || DEFAULT_GENRE_STYLE
}

// 歌词自动缩放：测量文本宽度（用 canvas 度量，避免依赖 DOM 布局）
const lyricMeasureCtx = (() => {
  try {
    return document.createElement('canvas').getContext('2d')
  } catch {
    return null
  }
})()

function measureTextWidth(text: string, fontSize: number, weight: string): number {
  if (!lyricMeasureCtx) return text.length * fontSize * 0.9
  lyricMeasureCtx.font = `${weight} ${fontSize}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  return lyricMeasureCtx.measureText(text).width
}

// 单行自适应：能放下用基准字号；放不下按比例缩小；到最小字号仍放不下则折叠为多行
function fitLyricLine(
  el: HTMLDivElement,
  text: string,
  base: number,
  min: number,
  weight: string,
  maxW: number
) {
  el.classList.remove('vlyrics-fold')
  const empty = !text || text === '\u00a0'
  if (empty) {
    el.style.fontSize = `${base}px`
    return
  }
  const baseW = measureTextWidth(text, base, weight)
  if (baseW <= maxW) {
    el.style.fontSize = `${base}px`
    return
  }
  const scaled = Math.floor((base * maxW) / baseW)
  const scaledW = measureTextWidth(text, scaled, weight)
  if (scaledW <= maxW) {
    el.style.fontSize = `${scaled}px`
    return
  }
  el.style.fontSize = `${min}px`
  el.classList.add('vlyrics-fold')
}

const vertexShader = `
  attribute float size;
  attribute vec3 color;
  attribute float baseAlpha;
  attribute float radius;
  attribute float twinkleSpeed;
  attribute float twinklePhase;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float fadeRadius;
  uniform float uBeat;
  uniform float uEnergy;
  uniform float uTime;

  void main() {
    vColor = color;
    float edgeFade = 1.0 - smoothstep(fadeRadius * 0.78, fadeRadius, radius);
    float emotionAlpha = 0.5 + uEnergy * 0.85 + uBeat * 0.65;
    float twinkle = 1.0 + 0.38 * sin(uTime * twinkleSpeed + twinklePhase);
    float emotionBoost = 1.0 + uEnergy * 0.55 + uBeat * 1.6;
    vAlpha = baseAlpha * edgeFade * emotionAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float audioBoost = 1.0 + uBeat * 0.9 + uEnergy * 0.38;
    gl_PointSize = size * twinkle * emotionBoost * audioBoost * (450.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const matrixVertexShader = `
  attribute float size;
  attribute vec3 color;
  attribute float baseAlpha;
  attribute float radius;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float fadeRadius;
  uniform float uBeat;
  uniform float uEnergy;

  void main() {
    vColor = color;
    float edgeFade = 1.0 - smoothstep(fadeRadius * 0.78, fadeRadius, radius);
    float emotionAlpha = 0.5 + uEnergy * 0.85 + uBeat * 0.65;
    vAlpha = baseAlpha * edgeFade * emotionAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float audioBoost = 1.0 + uBeat * 0.9 + uEnergy * 0.38;
    gl_PointSize = size * audioBoost * edgeFade * (450.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = `
  uniform sampler2D uDotTex;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 tex = texture2D(uDotTex, gl_PointCoord);
    if (tex.a < 0.02) discard;
    vec3 col = vColor * (1.0 + tex.r * 1.6);
    gl_FragColor = vec4(col, tex.a * vAlpha);
  }
`

const bloomVertexShader = vertexShader.replace(
  'gl_PointSize = size * twinkle * emotionBoost * audioBoost * (450.0 / -mvPosition.z);',
  'gl_PointSize = size * twinkle * emotionBoost * audioBoost * 1.85 * (450.0 / -mvPosition.z);'
)

const bloomFragmentShader = `
  uniform sampler2D uDotTex;
  varying vec3 vColor;
  varying float vAlpha;

  void main(){
    vec4 tex = texture2D(uDotTex, gl_PointCoord);
    if (tex.a < 0.01) discard;
    float soft = tex.a * tex.a;
    vec3 col = vColor * 0.55;
    gl_FragColor = vec4(col, soft * vAlpha * 0.42);
  }
`

const matrixFragmentShader = `
  uniform sampler2D uDotTex;
  varying vec3 vColor;
  varying float vAlpha;

  void main(){
    vec4 tex = texture2D(uDotTex, gl_PointCoord);
    if (tex.a < 0.02) discard;
    vec3 col = vColor * (0.9 + tex.r * 0.75);
    gl_FragColor = vec4(col, tex.a * vAlpha);
  }
`

const matrixBloomVertexShader = `
  attribute float size;
  attribute vec3 color;
  attribute float baseAlpha;
  attribute float radius;
  attribute float halo;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float fadeRadius;
  uniform float uBeat;
  uniform float uEnergy;

  void main() {
    vColor = color;
    float edgeFade = 1.0 - smoothstep(fadeRadius * 0.78, fadeRadius, radius);
    float emotionAlpha = 0.5 + uEnergy * 0.85 + uBeat * 0.65;
    vAlpha = baseAlpha * edgeFade * emotionAlpha * halo;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float audioBoost = 1.0 + uBeat * 0.9 + uEnergy * 0.38;
    gl_PointSize = size * audioBoost * 2.6 * edgeFade * (450.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const matrixBloomFragmentShader = `
  uniform sampler2D uDotTex;
  varying vec3 vColor;
  varying float vAlpha;

  void main(){
    vec4 tex = texture2D(uDotTex, gl_PointCoord);
    if (tex.a < 0.01) discard;
    float soft = tex.a * tex.a;
    vec3 col = vColor * 0.65;
    gl_FragColor = vec4(col, soft * vAlpha * 0.55);
  }
`

const floatVertexShader = `
  precision highp float;
  attribute vec3 position;
  attribute vec3 aColor;
  attribute vec3 aPhase;
  attribute float aRand;
  attribute float aAmp;
  varying vec3 vC;
  varying float vA;
  uniform float uTime;
  uniform float uBass;
  uniform float uEnergy;
  uniform float uPixel;

  void main(){
    vec3 pos = position;
    float orbit = uTime * (0.025 + aRand * 0.028);
    float cs = cos(orbit), sn = sin(orbit);
    pos.xy = mat2(cs, -sn, sn, cs) * pos.xy;
    float breathe = 1.0 + sin(uTime * 0.30 + aPhase.x) * 0.04;
    pos.xy *= breathe;
    pos.x += sin(uTime * (0.14 + aRand * 0.05) + aPhase.x) * aAmp * (0.30 + uBass * 0.35);
    pos.y += cos(uTime * (0.12 + aRand * 0.06) + aPhase.y) * aAmp * (0.26 + uBass * 0.30);
    pos.z += sin(uTime * (0.09 + aRand * 0.04) + aPhase.z) * aAmp * 0.55 + uBass * 0.45 * sin(aRand * 12.0);
    vC = aColor;
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mvPos.z;
    float twinkle = 0.58 + 0.42 * sin(uTime * (0.38 + aRand * 0.30) + aPhase.z);
    float emotionAlpha = 0.45 + uEnergy * 1.0 + uBass * 0.7;
    vA = clamp(0.18 + (5.0 - dist) * 0.09, 0.045, 0.48) * twinkle * emotionAlpha;
    float sz = clamp(34.0 / max(0.5, dist), 1.0, 3.4);
    gl_PointSize = sz * uPixel;
    gl_Position = projectionMatrix * mvPos;
  }
`

const floatFragmentShader = `
  precision highp float;
  uniform sampler2D uDotTex;
  varying vec3 vC;
  varying float vA;

  void main(){
    vec4 tex = texture2D(uDotTex, gl_PointCoord);
    if (tex.a < 0.02) discard;
    gl_FragColor = vec4(vC, tex.a * vA);
  }
`

const STAR_COUNT = 6000
const STARFIELD_RADIUS = 600
const STARFIELD_CENTER_Z = -380

// 低配自适应：按设备像素比与屏幕面积缩放粒子数，保证低端机流畅
function visualQualityScale(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const area =
    typeof window !== 'undefined' ? (window.screen?.width || 1280) * (window.screen?.height || 800) : 1024000
  if (dpr >= 2 || area >= 2500000) return 1
  if (dpr >= 1.5 || area >= 1500000) return 0.75
  return 0.5
}

const FLOAT_COUNT = Math.round(900 * visualQualityScale())
const STAR_COUNT_DYNAMIC = Math.round(STAR_COUNT * visualQualityScale())

const MATRIX_SIZE = 48
const MATRIX_GAP = 1.8
const MATRIX_Z = -56

const ORBIT_DIST_KEY = 'mr3d.orbitDistance'
const ORBIT_MIN_R = 18
const ORBIT_MAX_R = 260

// 歌词锚点平面：位于矩阵与相机之间、更靠近屏幕（矩阵z=-56，相机z=44）
const LYRICS_Z = -22

function pickStarColor(): THREE.Color {
  const r = Math.random()
  if (r < 0.52) return new THREE.Color(0xeef6f9)
  if (r < 0.72) return new THREE.Color(0xa8e6ff)
  if (r < 0.86) return new THREE.Color(0x00f5d4)
  if (r < 0.95) return new THREE.Color(0xf4d28a)
  return new THREE.Color(0xb8c8ff)
}

function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.26, 'rgba(255,255,255,0.92)')
  g.addColorStop(0.46, 'rgba(255,255,255,0.78)')
  g.addColorStop(0.56, 'rgba(255,255,255,0.3)')
  g.addColorStop(0.8, 'rgba(255,255,255,0.07)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

function createDiscTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.4, 'rgba(255,255,255,1)')
  g.addColorStop(0.46, 'rgba(255,255,255,0.5)')
  g.addColorStop(0.52, 'rgba(255,255,255,0)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

function displayDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '-:--'
  return formatTime(seconds)
}

export default function Visualizer({
  mediaElement,
  analyserRef,
  dataArrayRef,
  isPlaying,
  isFullscreen,
  title,
  playlist,
  currentIndex,
  durations = {},
  onHistorySelect,
  reverbAmount = 0,
  reverbPreset = 'off',
  lyricsLines = [],
  lyricsCurrentTime = 0,
  lyricsVisible = false,
  lyricOffset = 0,
  onLyricsAdjust,
  onLyricsSearch,
  styleTag = ''
}: VisualizerProps) {
  const reverbAmountRef = useRef(reverbAmount)
  reverbAmountRef.current = reverbAmount
  const onLyricsAdjustRef = useRef(onLyricsAdjust)
  onLyricsAdjustRef.current = onLyricsAdjust
  const onLyricsSearchRef = useRef(onLyricsSearch)
  onLyricsSearchRef.current = onLyricsSearch
  const lyricOffsetRef = useRef(lyricOffset)
  lyricOffsetRef.current = lyricOffset
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const canvasRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement | null>(null)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const bigTitleRef = useRef<HTMLDivElement | null>(null)
  const titleObjRef = useRef<CSS3DObject | null>(null)
  const historyObjRef = useRef<CSS3DObject | null>(null)
  const bigTitleObjRef = useRef<CSS3DObject | null>(null)
  const genreObjRef = useRef<CSS3DObject | null>(null)
  const genreElRef = useRef<HTMLDivElement | null>(null)
  const lyricsObjRef = useRef<CSS3DObject | null>(null)
  const lyricsElRef = useRef<HTMLDivElement | null>(null)
  const screenToPlaneRef = useRef<(sx: number, sy: number) => THREE.Vector3 | null>(null)
  const screenToPlaneAtRef = useRef<(sx: number, sy: number, z: number) => THREE.Vector3 | null>(null)
  const planeToScreenRef = useRef<(point: THREE.Vector3) => { x: number; y: number } | null>(null)
  const matrixLeftWorldRef = useRef<THREE.Vector3 | null>(null)
  const isFullscreenRef = useRef(isFullscreen)

  const matrixPosAttrRef = useRef<THREE.BufferAttribute | null>(null)
  const matrixSizeAttrRef = useRef<THREE.BufferAttribute | null>(null)
  const matrixBaseSizesRef = useRef<Float32Array | null>(null)
  const matrixPhaseRef = useRef<Float32Array | null>(null)
  const matrixJumpRef = useRef<Float32Array | null>(null)
  const matrixJumpVelRef = useRef<Float32Array | null>(null)
  const matrixHaloJitRef = useRef<Float32Array | null>(null)
  const peaksRef = useRef<{ cx: number; cy: number; radius: number; radius2: number; amplitude: number; target: number; growing: boolean }[]>([])
  const peakCooldownRef = useRef(0)
  const isDraggingRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  // 混响 / 空间感可视化：可随节拍后退的网格、放大的漂浮粒子、增强的山峰余韵
  const matrixGroupRef = useRef<THREE.Group | null>(null)
  const floatGroupRef = useRef<THREE.Group | null>(null)
  const starGroupRef = useRef<THREE.Group | null>(null)
  const spaceDepthRef = useRef(0)
  const orbitSphericalRef = useRef<THREE.Spherical | null>(null)
  const prevFullscreenRef = useRef<boolean | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const orbitTargetRef = useRef<THREE.Vector3 | null>(null)

  const smoothEnergyRef = useRef(0)
  const prevBassRef = useRef(0)
  const beatPulseRef = useRef(0)
  const energyHistoryRef = useRef<Float32Array>(new Float32Array(16))
  const energyIndexRef = useRef(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!canvasRef.current) return

    const container = canvasRef.current
    const width = container.clientWidth || 1
    const height = container.clientHeight || 1

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000)
    camera.position.set(0, 0, 44)
    camera.lookAt(0, 0, 0)

    // 全屏环绕视角初始化（以矩阵中心为焦点）
    const orbitTarget = new THREE.Vector3(-5, 0, MATRIX_Z)
    orbitSphericalRef.current = new THREE.Spherical().setFromVector3(
      camera.position.clone().sub(orbitTarget)
    )
    cameraRef.current = camera
    orbitTargetRef.current = orbitTarget

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(width, height)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    // ---------- CSS3D 层：标题 / 列表 与矩阵强制合并为同一 3D 图层 ----------
    const cssScene = new THREE.Scene()
    const cssRenderer = new CSS3DRenderer()
    cssRenderer.setSize(width, height)
    cssRenderer.domElement.style.position = 'absolute'
    cssRenderer.domElement.style.inset = '0'
    cssRenderer.domElement.style.pointerEvents = 'none'
    cssRenderer.domElement.style.zIndex = '5'
    container.appendChild(cssRenderer.domElement)

    const matrixPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -MATRIX_Z)
    const matrixHalf = (MATRIX_SIZE - 1) * MATRIX_GAP * 0.5
    const matrixLeftWorld = new THREE.Vector3(-5 - matrixHalf, 0, MATRIX_Z)
    matrixLeftWorldRef.current = matrixLeftWorld

    const screenToPlane = (sx: number, sy: number) => {
      const raycaster = new THREE.Raycaster()
      const w = container.clientWidth
      const h = container.clientHeight
      raycaster.setFromCamera(
        { x: (sx / w) * 2 - 1, y: -(sy / h) * 2 + 1 },
        camera
      )
      const point = new THREE.Vector3()
      raycaster.ray.intersectPlane(matrixPlane, point)
      return point
    }

    // 与 screenToPlane 相同，但投影到指定 z 的平行平面（用于歌词这类更靠近相机的对象）
    const screenToPlaneAt = (sx: number, sy: number, z: number) => {
      const raycaster = new THREE.Raycaster()
      const w = container.clientWidth
      const h = container.clientHeight
      raycaster.setFromCamera(
        { x: (sx / w) * 2 - 1, y: -(sy / h) * 2 + 1 },
        camera
      )
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z)
      const point = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, point)
      return point
    }

    const planeToScreen = (point: THREE.Vector3) => {
      const w = container.clientWidth
      const h = container.clientHeight
      const projected = point.clone().project(camera)
      return {
        x: (projected.x * 0.5 + 0.5) * w,
        y: (-projected.y * 0.5 + 0.5) * h
      }
    }

    const titleAnchor = document.createElement('div')
    titleAnchor.className = 'css3d-anchor'
    const titleEl = document.createElement('div')
    titleEl.className = 'visualizer-title'
    titleEl.innerHTML =
      '<div class="track-title"></div><div class="clock-time"></div><div class="clock-date"></div>'
    titleAnchor.appendChild(titleEl)
    const titleObj = new CSS3DObject(titleAnchor)
    titleObj.position.copy(screenToPlane(70, 40))
    titleObj.scale.set(0.8, 0.8, 0.8)
    cssScene.add(titleObj)
    titleObjRef.current = titleObj
    titleRef.current = titleEl

    const historyAnchor = document.createElement('div')
    historyAnchor.className = 'css3d-anchor'
    const historyEl = document.createElement('div')
    historyEl.className = 'visualizer-history'
    historyEl.style.pointerEvents = 'auto'
    historyEl.addEventListener('mousedown', (e) => e.stopPropagation())
    historyEl.addEventListener('dblclick', (e) => {
      const card = (e.target as HTMLElement).closest('.history-card')
      if (!card || !onHistorySelect) return
      const idx = Number(card.getAttribute('data-index'))
      if (!Number.isNaN(idx)) onHistorySelect(idx)
    })
    historyAnchor.appendChild(historyEl)
    const historyObj = new CSS3DObject(historyAnchor)
    historyObj.position.copy(
      screenToPlane(container.clientWidth - 180, container.clientHeight * 0.5)
    )
    historyObj.scale.set(0.12, 0.12, 0.12)
    cssScene.add(historyObj)
    historyObjRef.current = historyObj
    historyRef.current = historyEl

    const bigTitleAnchor = document.createElement('div')
    bigTitleAnchor.className = 'css3d-anchor'
    const bigTitleEl = document.createElement('div')
    bigTitleEl.className = 'visualizer-big-title'
    bigTitleAnchor.appendChild(bigTitleEl)
    const bigTitleObj = new CSS3DObject(bigTitleAnchor)
    const matrixLeftScreen = planeToScreen(matrixLeftWorld)
    bigTitleObj.position.copy(screenToPlane(matrixLeftScreen.x, 45))
    bigTitleObj.scale.set(0.3, 0.3, 0.3)
    cssScene.add(bigTitleObj)
    bigTitleObjRef.current = bigTitleObj
    bigTitleRef.current = bigTitleEl

    screenToPlaneRef.current = screenToPlane
    screenToPlaneAtRef.current = screenToPlaneAt
    planeToScreenRef.current = planeToScreen

    // ---------- Layer 0: 3D 歌词（屏幕中央、比矩阵更靠近相机，随全屏环绕一起旋转） ----------
    const lyricsAnchor = document.createElement('div')
    lyricsAnchor.className = 'css3d-anchor'
    const lyricsEl = document.createElement('div')
    lyricsEl.className = 'visualizer-lyrics'
    lyricsEl.innerHTML =
      '<div class="vlyrics-prev"></div>' +
      '<div class="vlyrics-current"></div>' +
      '<div class="vlyrics-next"></div>' +
      '<div class="vlyrics-tools">' +
      '<button type="button" class="vlyrics-btn" data-action="minus">-0.5s</button>' +
      '<span class="vlyrics-offset">同步</span>' +
      '<button type="button" class="vlyrics-btn" data-action="plus">+0.5s</button>' +
      '<button type="button" class="vlyrics-btn vlyrics-reset" data-action="reset" style="display:none">归零</button>' +
      '<button type="button" class="vlyrics-btn vlyrics-search" data-action="search">换歌</button>' +
      '</div>'
    lyricsEl.addEventListener('mousedown', (e) => e.stopPropagation())
    lyricsEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null
      if (!btn) return
      const action = btn.getAttribute('data-action')
      if (action === 'minus') onLyricsAdjustRef.current?.(-0.5)
      else if (action === 'plus') onLyricsAdjustRef.current?.(0.5)
      else if (action === 'reset') onLyricsAdjustRef.current?.(-lyricOffsetRef.current)
      else if (action === 'search') onLyricsSearchRef.current?.()
    })
    lyricsAnchor.appendChild(lyricsEl)
    const lyricsObj = new CSS3DObject(lyricsAnchor)
    lyricsObj.position.copy(
      screenToPlaneAt(container.clientWidth / 2, container.clientHeight / 2, LYRICS_Z)
    )
    lyricsObj.scale.set(0.2, 0.2, 0.2)
    lyricsObj.visible = false
    cssScene.add(lyricsObj)
    lyricsObjRef.current = lyricsObj
    lyricsElRef.current = lyricsEl

    // ---------- 歌曲风格标签（左上角、独立对象，同一矩阵平面，全屏随内容转动）----------
    const genreAnchor = document.createElement('div')
    genreAnchor.className = 'css3d-anchor'
    const genreEl = document.createElement('div')
    genreEl.className = 'visualizer-genre'
    genreEl.innerHTML =
      '<svg class="genre-tag-svg" xmlns="http://www.w3.org/2000/svg" overflow="visible">' +
      '<defs>' +
      '<linearGradient id="genre-grad-bold" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="16" y2="16" spreadMethod="repeat">' +
      '<stop offset="0" stop-color="rgba(255,110,80,0.95)"/><stop offset="0.28" stop-color="#ffffff"/><stop offset="0.55" stop-color="#ffd700"/><stop offset="1" stop-color="rgba(255,110,80,0.95)"/>' +
      '<animateTransform attributeName="gradientTransform" type="translate" values="0 0; 22.63 22.63" dur="2.6s" repeatCount="indefinite"/>' +
      '</linearGradient>' +
      '<linearGradient id="genre-grad-script" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="16" y2="16" spreadMethod="repeat">' +
      '<stop offset="0" stop-color="rgba(126,240,255,0.95)"/><stop offset="0.28" stop-color="#ffffff"/><stop offset="0.55" stop-color="#c79bff"/><stop offset="1" stop-color="rgba(126,240,255,0.95)"/>' +
      '<animateTransform attributeName="gradientTransform" type="translate" values="0 0; 22.63 22.63" dur="2.6s" repeatCount="indefinite"/>' +
      '</linearGradient>' +
      '<linearGradient id="genre-grad-playful" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="16" y2="16" spreadMethod="repeat">' +
      '<stop offset="0" stop-color="#ff9dd2"/><stop offset="0.28" stop-color="#ffffff"/><stop offset="0.55" stop-color="#7ef0ff"/><stop offset="1" stop-color="#ff9dd2"/>' +
      '<animateTransform attributeName="gradientTransform" type="translate" values="0 0; 22.63 22.63" dur="2.6s" repeatCount="indefinite"/>' +
      '</linearGradient>' +
      '<linearGradient id="genre-grad-ancient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="16" y2="16" spreadMethod="repeat">' +
      '<stop offset="0" stop-color="#ffd9a0"/><stop offset="0.28" stop-color="#ffffff"/><stop offset="0.55" stop-color="#d9a05b"/><stop offset="1" stop-color="#ffd9a0"/>' +
      '<animateTransform attributeName="gradientTransform" type="translate" values="0 0; 22.63 22.63" dur="2.6s" repeatCount="indefinite"/>' +
      '</linearGradient>' +
      '<filter id="genre-glow" x="-70%" y="-70%" width="240%" height="240%">' +
      '<feGaussianBlur stdDeviation="1.1" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter>' +
      '</defs>' +
      '<text x="2" y="0" font-size="28" font-weight="700" letter-spacing="2" fill="url(#genre-grad-script)" filter="url(#genre-glow)"></text>' +
      '</svg>'
    genreAnchor.appendChild(genreEl)
    const genreObj = new CSS3DObject(genreAnchor)
    genreObj.position.copy(screenToPlane(70, 70))
    genreObj.scale.set(0.8, 0.8, 0.8)
    genreObj.visible = false
    cssScene.add(genreObj)
    genreObjRef.current = genreObj
    genreElRef.current = genreEl

    // ---------- Layer 4: 最远星空（固定背景，绑定在相机上） ----------
    const starGroup = new THREE.Group()
    starGroupRef.current = starGroup
    scene.add(camera)
    camera.add(starGroup)
    const starPositions = new Float32Array(STAR_COUNT_DYNAMIC * 3)
    const starColors = new Float32Array(STAR_COUNT_DYNAMIC * 3)
    const starSizes = new Float32Array(STAR_COUNT_DYNAMIC)
    const starBaseSizes = new Float32Array(STAR_COUNT_DYNAMIC)
    const starBaseAlphas = new Float32Array(STAR_COUNT_DYNAMIC)
    const starRadii = new Float32Array(STAR_COUNT_DYNAMIC)
    const starPhases = new Float32Array(STAR_COUNT_DYNAMIC)
    const starTwinkleSpeeds = new Float32Array(STAR_COUNT_DYNAMIC)

    for (let i = 0; i < STAR_COUNT_DYNAMIC; i++) {
      const r = STARFIELD_RADIUS * Math.cbrt(Math.random())
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)

      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      starPositions[i * 3 + 2] = r * Math.cos(phi)

      const color = pickStarColor()
      starColors[i * 3] = color.r
      starColors[i * 3 + 1] = color.g
      starColors[i * 3 + 2] = color.b

      const size = 1.5 + Math.random() * 1.8
      starBaseSizes[i] = size
      starSizes[i] = size
      starBaseAlphas[i] = 0.7 + Math.random() * 0.25
      starRadii[i] = r
      starPhases[i] = Math.random() * Math.PI * 2
      starTwinkleSpeeds[i] = 0.5 + Math.random() * 1.5
    }

    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3))
    starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1))
    starGeometry.setAttribute('baseAlpha', new THREE.BufferAttribute(starBaseAlphas, 1))
    starGeometry.setAttribute('radius', new THREE.BufferAttribute(starRadii, 1))
    starGeometry.setAttribute('twinkleSpeed', new THREE.BufferAttribute(starTwinkleSpeeds, 1))
    starGeometry.setAttribute('twinklePhase', new THREE.BufferAttribute(starPhases, 1))

    const sharedUniforms = {
      fadeRadius: { value: STARFIELD_RADIUS },
      uDotTex: { value: dotTexture },
      uBeat: { value: 0 },
      uEnergy: { value: 0 },
      uTime: { value: 0 }
    }

    const starMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: sharedUniforms,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true
    })

    const starBloomMaterial = new THREE.ShaderMaterial({
      vertexShader: bloomVertexShader,
      fragmentShader: bloomFragmentShader,
      uniforms: sharedUniforms,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true
    })

    starGroup.add(new THREE.Points(starGeometry, starBloomMaterial))
    starGroup.add(new THREE.Points(starGeometry, starMaterial))

    // ---------- Layer 3: 平面正方形圆点矩阵----------
    const matrixGroup = new THREE.Group()
    matrixGroup.position.set(-5, 0, MATRIX_Z)
    matrixGroupRef.current = matrixGroup
    scene.add(matrixGroup)
    const matrixCount = MATRIX_SIZE * MATRIX_SIZE
    const matrixPositions = new Float32Array(matrixCount * 3)
    const matrixColors = new Float32Array(matrixCount * 3)
    const matrixSizes = new Float32Array(matrixCount)
    const matrixBaseSizes = new Float32Array(matrixCount)
    const matrixBaseAlphas = new Float32Array(matrixCount)
    const matrixRadii = new Float32Array(matrixCount)
    const matrixPhases = new Float32Array(matrixCount)
    const matrixJump = new Float32Array(matrixCount)
    const matrixJumpVel = new Float32Array(matrixCount)
    const matrixHalo = new Float32Array(matrixCount)
    const matrixHaloJit = new Float32Array(matrixCount)

    const half = (MATRIX_SIZE - 1) * MATRIX_GAP * 0.5
    const colorMain = new THREE.Color(0x00e5ff)

    for (let row = 0; row < MATRIX_SIZE; row++) {
      for (let col = 0; col < MATRIX_SIZE; col++) {
        const i = row * MATRIX_SIZE + col
        matrixPositions[i * 3] = col * MATRIX_GAP - half
        matrixPositions[i * 3 + 1] = half - row * MATRIX_GAP
        matrixPositions[i * 3 + 2] = 0

        matrixColors[i * 3] = colorMain.r
        matrixColors[i * 3 + 1] = colorMain.g
        matrixColors[i * 3 + 2] = colorMain.b

        const jit = Math.random()
        const size = 3.0 * (0.7 + jit * 0.6)
        matrixBaseSizes[i] = size
        matrixSizes[i] = size
        matrixBaseAlphas[i] = 0.72 + jit * 0.46
        matrixHaloJit[i] = 0.55 + jit * 0.75
        matrixRadii[i] = Math.sqrt(
          matrixPositions[i * 3] ** 2 + matrixPositions[i * 3 + 1] ** 2
        )
        matrixPhases[i] = Math.random() * Math.PI * 2
        matrixJump[i] = 0
        matrixJumpVel[i] = 0
        matrixHalo[i] = 0.2
      }
    }

    const matrixGeometry = new THREE.BufferGeometry()
    matrixGeometry.setAttribute('position', new THREE.BufferAttribute(matrixPositions, 3))
    matrixGeometry.setAttribute('color', new THREE.BufferAttribute(matrixColors, 3))
    matrixGeometry.setAttribute('size', new THREE.BufferAttribute(matrixSizes, 1))
    matrixGeometry.setAttribute('baseAlpha', new THREE.BufferAttribute(matrixBaseAlphas, 1))
    matrixGeometry.setAttribute('radius', new THREE.BufferAttribute(matrixRadii, 1))
    matrixGeometry.setAttribute('halo', new THREE.BufferAttribute(matrixHalo, 1))

    const matrixUniforms = {
      fadeRadius: { value: half * 1.15 },
      uDotTex: { value: discTexture },
      uBeat: { value: 0 },
      uEnergy: { value: 0 }
    }

    const matrixBloomUniforms = {
      fadeRadius: matrixUniforms.fadeRadius,
      uDotTex: { value: dotTexture },
      uBeat: matrixUniforms.uBeat,
      uEnergy: matrixUniforms.uEnergy
    }

    const matrixMaterial = new THREE.ShaderMaterial({
      vertexShader: matrixVertexShader,
      fragmentShader: matrixFragmentShader,
      uniforms: matrixUniforms,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true
    })

    const matrixBloomMaterial = new THREE.ShaderMaterial({
      vertexShader: matrixBloomVertexShader,
      fragmentShader: matrixBloomFragmentShader,
      uniforms: matrixBloomUniforms,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true
    })

    const matrixColorAttr = matrixGeometry.attributes.color as THREE.BufferAttribute
    const matrixColorsArr = matrixColorAttr.array as Float32Array
    const matrixHaloAttr = matrixGeometry.attributes.halo as THREE.BufferAttribute
    const matrixHaloArr = matrixHaloAttr.array as Float32Array
    const colorLow = new THREE.Color(0x0f88b0)
    const colorHot = new THREE.Color(0x3b82ff)
    const scratchColor = new THREE.Color()

    matrixGroup.add(new THREE.Points(matrixGeometry, matrixBloomMaterial))
    matrixGroup.add(new THREE.Points(matrixGeometry, matrixMaterial))

    // ---------- Layer 2.5: 飘浮微尘 ----------
    const floatGeometry = new THREE.BufferGeometry()
    const floatPositions = new Float32Array(FLOAT_COUNT * 3)
    const floatColors = new Float32Array(FLOAT_COUNT * 3)
    const floatPhases = new Float32Array(FLOAT_COUNT * 3)
    const floatAmps = new Float32Array(FLOAT_COUNT)
    const floatRands = new Float32Array(FLOAT_COUNT)

    const floatColorPalette = [
      new THREE.Color(0xeef6f9),
      new THREE.Color(0x00f5d4),
      new THREE.Color(0xf4d28a),
      new THREE.Color(0xa8e6ff)
    ]

    for (let i = 0; i < FLOAT_COUNT; i++) {
      const halo = i < FLOAT_COUNT * 0.72
      let bx, by, bz
      if (halo) {
        const a = Math.random() * Math.PI * 2
        const r = 1.2 + Math.pow(Math.random(), 0.75) * 5.5
        const lane = (Math.random() - 0.5) * 1.2
        bx = Math.cos(a) * r
        by = Math.sin(a) * r * 0.5 + lane
        bz = (Math.random() - 0.5) * 4.5 - 0.6
      } else {
        bx = (Math.random() - 0.5) * 14
        by = (Math.random() - 0.5) * 9
        bz = (Math.random() - 0.5) * 8
      }
      floatPositions[i * 3] = bx
      floatPositions[i * 3 + 1] = by
      floatPositions[i * 3 + 2] = bz
      floatPhases[i * 3] = Math.random() * Math.PI * 2
      floatPhases[i * 3 + 1] = Math.random() * Math.PI * 2
      floatPhases[i * 3 + 2] = Math.random() * Math.PI * 2
      floatAmps[i] = 0.18 + Math.random() * 0.32
      floatRands[i] = Math.random()
      const col = floatColorPalette[Math.floor(Math.random() * floatColorPalette.length)]
      floatColors[i * 3] = col.r
      floatColors[i * 3 + 1] = col.g
      floatColors[i * 3 + 2] = col.b
    }

    floatGeometry.setAttribute('position', new THREE.BufferAttribute(floatPositions, 3))
    floatGeometry.setAttribute('aColor', new THREE.BufferAttribute(floatColors, 3))
    floatGeometry.setAttribute('aPhase', new THREE.BufferAttribute(floatPhases, 3))
    floatGeometry.setAttribute('aAmp', new THREE.BufferAttribute(floatAmps, 1))
    floatGeometry.setAttribute('aRand', new THREE.BufferAttribute(floatRands, 1))

    const floatUniforms = {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uEnergy: { value: 0 },
      uDotTex: { value: dotTexture },
      uPixel: { value: Math.min(window.devicePixelRatio, 1.5) }
    }

    const floatMaterial = new THREE.ShaderMaterial({
      vertexShader: floatVertexShader,
      fragmentShader: floatFragmentShader,
      uniforms: floatUniforms,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true
    })

    const floatGroup = new THREE.Points(floatGeometry, floatMaterial)
    floatGroup.frustumCulled = false
    scene.add(floatGroup)
    floatGroupRef.current = floatGroup

    matrixPosAttrRef.current = matrixGeometry.attributes.position as THREE.BufferAttribute
    matrixSizeAttrRef.current = matrixGeometry.attributes.size as THREE.BufferAttribute
    matrixBaseSizesRef.current = matrixBaseSizes
    matrixHaloJitRef.current = matrixHaloJit
    matrixPhaseRef.current = matrixPhases
    matrixJumpRef.current = matrixJump
    matrixJumpVelRef.current = matrixJumpVel
    peaksRef.current = []
    peakCooldownRef.current = 0

    // ---------- 动画循环 ----------
    let time = 0
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate)
      time += 0.016

      try {
        let bass = 0
        let mid = 0
        let treble = 0

        if (analyserRef.current && dataArrayRef.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current)
        const data = dataArrayRef.current
        const len = data.length
        let bassSum = 0
        let midSum = 0
        let trebleSum = 0
        let bassCount = 0
        let midCount = 0
        let trebleCount = 0

        for (let i = 0; i < len; i++) {
          const v = data[i] / 255
          if (i < len * 0.08) {
            bassSum += v
            bassCount++
          } else if (i < len * 0.45) {
            midSum += v
            midCount++
          } else {
            trebleSum += v
            trebleCount++
          }
        }

        bass = bassCount ? bassSum / bassCount : 0
        mid = midCount ? midSum / midCount : 0
        treble = trebleCount ? trebleSum / trebleCount : 0
      }

      // 优化节奏解析：基于近期能量均值检测 onset / 收放
      const energy = bass * 0.5 + mid * 0.32 + treble * 0.18
      const history = energyHistoryRef.current
      const idx = energyIndexRef.current
      const historyLen = history.length

      let historySum = 0
      for (let i = 0; i < historyLen; i++) historySum += history[i]
      const historyAvg = historyLen ? historySum / historyLen : energy

      const threshold = historyAvg * 1.12 + 0.03
      const rawOnset = Math.max(0, energy - threshold) * 5
      beatPulseRef.current = beatPulseRef.current * 0.72 + rawOnset * 0.28

      history[idx] = energy
      energyIndexRef.current = (idx + 1) % historyLen

      smoothEnergyRef.current = smoothEnergyRef.current * 0.88 + energy * 0.12
      prevBassRef.current = bass

      // 同步 shader uniform
      sharedUniforms.uBeat.value = beatPulseRef.current
      sharedUniforms.uEnergy.value = smoothEnergyRef.current
      sharedUniforms.uTime.value = time
      matrixUniforms.uBeat.value = beatPulseRef.current
      matrixUniforms.uEnergy.value = smoothEnergyRef.current
      floatUniforms.uTime.value = time
      floatUniforms.uBass.value = bass
      floatUniforms.uEnergy.value = smoothEnergyRef.current

      // 星空闪烁已在 vertex shader 中完成（uTime + twinkleSpeed/twinklePhase），
      // 不再每帧回传 6000 颗粒子的大小属性，显著降低 CPU 开销。
      // 矩阵随节奏生成多个圆锥形“山峰”
      const matrixPos = matrixPosAttrRef.current
      const matrixSizeAttr = matrixSizeAttrRef.current
      const matrixJump = matrixJumpRef.current
      const matrixJumpVel = matrixJumpVelRef.current
      const matrixBaseSizes = matrixBaseSizesRef.current
      const matrixPhases = matrixPhaseRef.current
      const matrixHaloJit = matrixHaloJitRef.current

      if (
        matrixPos &&
        matrixSizeAttr &&
        matrixJump &&
        matrixJumpVel &&
        matrixBaseSizes &&
        matrixPhases &&
        matrixHaloJit
      ) {
        const positions = matrixPos.array as Float32Array
        const sizes = matrixSizeAttr.array as Float32Array
        const peaks = peaksRef.current

        // 节奏触发新的山峰
        const intensity = beatPulseRef.current + bass * 0.75 + smoothEnergyRef.current * 0.45
        if (peakCooldownRef.current > 0) peakCooldownRef.current--
        if (peakCooldownRef.current <= 0 && intensity > 0.015 && peaks.length < 90) {
          const cellScale = 2.75 / MATRIX_GAP
          const margin = 3 * cellScale
          const spawnCount = Math.min(3, 1 + Math.floor(intensity * 4))
          for (let s = 0; s < spawnCount && peaks.length < 90; s++) {
            const radius = (0.55 + Math.random() * 0.85 + intensity * 0.35) * cellScale
            peaks.push({
              cx: margin + Math.random() * (MATRIX_SIZE - margin * 2),
              cy: margin + Math.random() * (MATRIX_SIZE - margin * 2),
              radius,
              radius2: radius * radius,
              amplitude: 0,
              target: 7 + intensity * 11,
              growing: true
            })
          }
          peakCooldownRef.current = 0
        }

        // 更新山峰生命周期
        for (let p = peaks.length - 1; p >= 0; p--) {
          const peak = peaks[p]
          peak.amplitude += (peak.target - peak.amplitude) * 0.12
          if (peak.growing && Math.abs(peak.target - peak.amplitude) < 0.8) {
            peak.growing = false
            peak.target = 0
          }
          if (!peak.growing && peak.amplitude < 0.3) {
            peaks.splice(p, 1)
          }
        }

        const reverbR = reverbAmountRef.current
        for (let i = 0; i < matrixCount; i++) {
          const col = i % MATRIX_SIZE
          const row = Math.floor(i / MATRIX_SIZE)

          let targetJump = 0
          for (const peak of peaks) {
            const dx = col - peak.cx
            const dy = row - peak.cy
            const d2 = dx * dx + dy * dy
            if (d2 < peak.radius2) {
              // 更陡峭的圆锥，避免山顶连成片
              const t = Math.sqrt(d2) / peak.radius
              const cone = Math.pow(Math.cos(t * Math.PI * 0.5), 3.0)
              targetJump += peak.amplitude * cone
            }
          }

          matrixJumpVel[i] += (targetJump - matrixJump[i]) * 0.1
          matrixJumpVel[i] *= 0.88
          matrixJump[i] += matrixJumpVel[i]

          const mountainZ =
            matrixJump[i] + Math.sin(time * 1.5 + matrixPhases[i]) * 0.12

          // 混响模式：正弦波阵列（低频驱动波间距(节奏)，中高频驱动波高(旋律)）
          const nx = (col / (MATRIX_SIZE - 1)) * 2 - 1
          const ny = (row / (MATRIX_SIZE - 1)) * 2 - 1
          let waveZ = 0
          // 低频：大波长、高振幅（节奏）
          waveZ += Math.sin(nx * Math.PI * 1.8 + time * 1.1) * bass * 16.0
          waveZ += Math.cos(ny * Math.PI * 1.4 - time * 0.85) * bass * 13.0
          // 中频：中等波长（旋律）
          waveZ += Math.sin(nx * Math.PI * 3.5 - time * 1.7 + ny * 2.2) * mid * 10.0
          waveZ += Math.cos(ny * Math.PI * 3.2 + time * 1.4 + nx * 1.3) * mid * 8.0
          // 高频：细密波长、细节质感
          waveZ += Math.sin((nx + ny) * Math.PI * 5.5 + time * 2.2) * treble * 5.0
          waveZ += Math.cos((nx - ny) * Math.PI * 6.0 - time * 1.9) * treble * 4.0

          const z = mountainZ * (1 - reverbR) + waveZ * reverbR
          positions[i * 3 + 2] = z
          const h = z > 0 ? (z < 18 ? z / 18 : 1) : 0
          if (h < 0.5) scratchColor.copy(colorLow).lerpHSL(colorMain, h * 2)
          else scratchColor.copy(colorMain).lerpHSL(colorHot, (h - 0.5) * 2)
          matrixColorsArr[i * 3] = scratchColor.r
          matrixColorsArr[i * 3 + 1] = scratchColor.g
          matrixColorsArr[i * 3 + 2] = scratchColor.b
          sizes[i] = matrixBaseSizes[i] * (1 + h * 0.5)
          matrixHaloArr[i] = (0.12 + Math.pow(h, 2.2) * 0.78) * matrixHaloJit[i]
        }
        matrixPos.needsUpdate = true
        matrixSizeAttr.needsUpdate = true
        matrixColorAttr.needsUpdate = true
        matrixHaloAttr.needsUpdate = true
      }

      // ===== 混响空间感：网格后退 / 漂浮粒子扩散 / 星云涌动，强化 3D 纵深 =====
      const targetDepth = reverbAmountRef.current * 16
      spaceDepthRef.current += (targetDepth - spaceDepthRef.current) * 0.06
      const depth = spaceDepthRef.current
      if (matrixGroupRef.current) {
        // 网格随混响“后退”，形成后向纵深(accents 立体声场的视觉纵深感)
        matrixGroupRef.current.position.z = MATRIX_Z - depth
        // 轻微越障 Dias 缩放，营造“大厅”体积感
        const s = 1 + reverbAmountRef.current * 0.12
        matrixGroupRef.current.scale.set(s, s, 1)
      }
      if (floatGroupRef.current) {
        const fs = 1 + reverbAmountRef.current * 0.35
        floatGroupRef.current.scale.set(fs, fs, fs)
      }
      if (starGroupRef.current) {
        // 星云随混响轻微起伏，模拟反射的漂浮空间
        const swirl = 1 + reverbAmountRef.current * 0.18
        starGroupRef.current.scale.set(swirl, swirl, swirl)
      }

      // 矩阵 / 标题 / 列表已合并为同一 3D 图层，由 CSS3DRenderer 随相机一起渲染
      renderer.render(scene, camera)
      cssRenderer.render(cssScene, camera)
    } catch (err) {
        console.error('Visualizer animate error:', err)
      }
    }

    animate()

    const handleResize = () => {
      if (!container || !camera || !renderer || !cssRenderer) return
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      cssRenderer.setSize(w, h)
      // 全屏/窗口切换后重新把标题和列表定位到屏幕对应位置
      titleObj.position.copy(screenToPlane(70, 40))
      historyObj.position.copy(screenToPlane(w - 180, h * 0.5))
      const mls = planeToScreen(matrixLeftWorld)
      bigTitleObj.position.copy(screenToPlane(mls.x, 45))
      if (lyricsObjRef.current) {
        lyricsObjRef.current.position.copy(screenToPlaneAt(w / 2, h / 2, LYRICS_Z))
      }
    }

    window.addEventListener('resize', handleResize)
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    // 全屏时鼠标拖拽环绕视角
    const handleMouseDown = (e: MouseEvent) => {
      if (!isFullscreenRef.current || e.button !== 0) return
      isDraggingRef.current = true
      lastMouseRef.current = { x: e.clientX, y: e.clientY }
      container.style.cursor = 'grabbing'
    }

    const handleMouseMove = (e: MouseEvent) => {
      // 左键拖拽环绕视角
      if (!isDraggingRef.current || !orbitSphericalRef.current) return
      const dx = e.clientX - lastMouseRef.current.x
      const dy = e.clientY - lastMouseRef.current.y
      lastMouseRef.current = { x: e.clientX, y: e.clientY }

      const spherical = orbitSphericalRef.current
      spherical.theta -= dx * 0.005
      spherical.phi -= dy * 0.005
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi))

      const offset = new THREE.Vector3().setFromSpherical(spherical)
      camera.position.copy(orbitTarget).add(offset)
      camera.lookAt(orbitTarget)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      container.style.cursor = ''
    }

    // 全屏时滚轮缩放视角远近（指数平滑，历史记录列表内让位给列表滚动）
    const handleWheel = (e: WheelEvent) => {
      if (!isFullscreenRef.current || !orbitSphericalRef.current) return
      if ((e.target as HTMLElement)?.closest?.('.visualizer-history')) return
      e.preventDefault()
      const spherical = orbitSphericalRef.current
      const factor = Math.exp(e.deltaY * 0.0012)
      spherical.radius = Math.min(ORBIT_MAX_R, Math.max(ORBIT_MIN_R, spherical.radius * factor))
      const offset = new THREE.Vector3().setFromSpherical(spherical)
      camera.position.copy(orbitTarget).add(offset)
      camera.lookAt(orbitTarget)
    }

    container.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      container.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('wheel', handleWheel)
      cancelAnimationFrame(rafRef.current)
      renderer.dispose()
      starGeometry.dispose()
      starMaterial.dispose()
      starBloomMaterial.dispose()
      matrixGeometry.dispose()
      matrixMaterial.dispose()
      floatGeometry.dispose()
      floatMaterial.dispose()
      dotTexture.dispose()
      discTexture.dispose()
      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      if (container && cssRenderer.domElement && container.contains(cssRenderer.domElement)) {
        container.removeChild(cssRenderer.domElement)
      }
    }
  }, [])

  useEffect(() => {
    isFullscreenRef.current = isFullscreen
  }, [isFullscreen])

  // 同步 CSS3D 标题内容
  useEffect(() => {
    if (!titleRef.current) return
    titleRef.current.querySelector('.track-title')!.textContent = title || 'MineRadio3D'
  }, [title])

  // 同步大标题（矩阵上方）
  useEffect(() => {
    if (!bigTitleRef.current) return
    const text = title || 'MineRadio3D'
    const isLong = text.length > 14

    // 用 DOM API + textContent 构建，避免标题含 HTML 被注入执行
    const track = document.createElement('div')
    track.className = `big-title-track ${isLong ? 'long' : ''}`
    const span1 = document.createElement('span')
    span1.className = 'big-title-text'
    span1.textContent = text
    track.appendChild(span1)
    if (isLong) {
      const span2 = document.createElement('span')
      span2.className = 'big-title-text'
      span2.textContent = text
      track.appendChild(span2)
    }
    const el = bigTitleRef.current
    el.innerHTML = ''
    el.appendChild(track)
  }, [title])

  useEffect(() => {
    if (!titleRef.current) return
    titleRef.current.querySelector('.clock-time')!.textContent = now.toLocaleTimeString('zh-CN', {
      hour12: false
    })
    titleRef.current.querySelector('.clock-date')!.textContent = now.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  }, [now])

  // 同步 3D 歌曲风格标签：字体、配色按情绪、宽度自适应、入场动画
  useEffect(() => {
    const el = genreElRef.current
    const obj = genreObjRef.current
    if (!el || !obj) return
    const svg = el.querySelector('.genre-tag-svg') as SVGSVGElement | null
    const text = svg ? (svg.querySelector('text') as SVGTextElement | null) : null
    if (!svg || !text) return
    if (!styleTag) {
      obj.visible = false
      svg.style.display = 'none'
      return
    }
    obj.visible = true
    svg.style.display = 'block'

    const gs = genreStyleFor(styleTag)
    text.setAttribute('font-family', gs.font)
    text.setAttribute('fill', `url(#genre-grad-${gs.mood})`)

    // 硬约束：以矩阵左缘的实际屏幕位置为上限，超宽先缩字号、仍超则换行
    const container = canvasRef.current
    const p2s = planeToScreenRef.current
    const mlsWorld = matrixLeftWorldRef.current
    let edgeX = container ? container.clientWidth * 0.28 : 320
    let pxPerDom = 0.8
    if (p2s && mlsWorld) {
      const a = p2s(new THREE.Vector3(mlsWorld.x, mlsWorld.y, mlsWorld.z))
      const b = p2s(new THREE.Vector3(mlsWorld.x + 1, mlsWorld.y, mlsWorld.z))
      if (a && b && Number.isFinite(a.x) && Number.isFinite(b.x)) {
        edgeX = a.x
        pxPerDom = Math.max(0.5, Math.abs(b.x - a.x) * 0.8)
      }
    }
    const maxDom = Math.max(60, (edgeX - 70 - 18) / pxPerDom)
    const measure = (size: number, str: string) => {
      const mctx = lyricMeasureCtx
      if (!mctx) return size * 0.62 * str.length + 2 * str.length
      mctx.font = `${size}px ${gs.font}`
      return mctx.measureText(str).width + 2 * str.length
    }
    let fs = 28
    let lines = [styleTag]
    let w = measure(fs, styleTag) + 8
    if (w > maxDom) {
      fs = Math.max(15, Math.floor((maxDom / w) * fs))
      w = measure(fs, styleTag) + 8
    }
    if (w > maxDom && styleTag.length > 3) {
      const cut = Math.ceil(styleTag.length / 2)
      lines = [styleTag.slice(0, cut), styleTag.slice(cut)]
      w = Math.max(measure(fs, lines[0]), measure(fs, lines[1])) + 8
    }
    const h = fs * (lines.length > 1 ? 3.1 : 1.6)
    svg.setAttribute('width', String(Math.ceil(w)))
    svg.setAttribute('height', String(Math.ceil(h)))
    svg.setAttribute('viewBox', `0 0 ${Math.ceil(w)} ${Math.ceil(h)}`)
    text.setAttribute('font-size', String(fs))
    text.setAttribute('x', '2')
    while (text.firstChild) text.removeChild(text.firstChild)
    if (lines.length === 1) {
      text.setAttribute('y', String(Math.ceil(fs * 1.15)))
      text.textContent = lines[0]
    } else {
      text.removeAttribute('y')
      lines.forEach((ln, k) => {
        const ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan')
        ts.setAttribute('x', '2')
        ts.setAttribute('y', String(Math.ceil(fs * (1.15 + k * 1.4))))
        ts.textContent = ln
        text.appendChild(ts)
      })
    }

    // 入场动画：切换标签时重新触发弹出
    svg.classList.remove('genre-anim')
    void svg.offsetWidth
    svg.classList.add('genre-anim')
  }, [styleTag])

  // 同步 CSS3D 历史列表内容
  useEffect(() => {
    if (!historyRef.current) return
    if (!isFullscreen || currentIndex <= 0) {
      historyRef.current.style.display = 'none'
      return
    }
    historyRef.current.style.display = 'block'
    const items = playlist
      .slice(0, currentIndex)
      .map((item, idx) => ({ item, idx }))
      .reverse()

    // 用 DOM API + textContent 构建，避免文件名/标题含 HTML 时被注入执行
    const shell = document.createElement('div')
    shell.className = 'history-shell'

    const header = document.createElement('div')
    header.className = 'history-header'
    const headerTitle = document.createElement('span')
    headerTitle.className = 'history-header-title'
    headerTitle.textContent = '播放历史'
    const headerCount = document.createElement('span')
    headerCount.className = 'history-header-count'
    headerCount.textContent = String(items.length)
    header.appendChild(headerTitle)
    header.appendChild(headerCount)
    shell.appendChild(header)

    const list = document.createElement('div')
    list.className = 'history-list'
    for (const { item, idx } of items) {
      const card = document.createElement('div')
      card.className = 'history-card'
      card.setAttribute('data-index', String(idx))
      card.title = item.name

      const cover = document.createElement('div')
      cover.className = 'history-cover'

      const body = document.createElement('div')
      body.className = 'history-body'
      const name = document.createElement('div')
      name.className = 'history-name'
      name.textContent = item.name.replace(/\.[^/.]+$/, '')
      const duration = document.createElement('div')
      duration.className = 'history-duration'
      duration.textContent = displayDuration(durations[item.id])
      body.appendChild(name)
      body.appendChild(duration)

      card.appendChild(cover)
      card.appendChild(body)
      list.appendChild(card)
    }
    shell.appendChild(list)

    const el = historyRef.current
    el.innerHTML = ''
    el.appendChild(shell)
  }, [currentIndex, isFullscreen, durations])

  // 同步 CSS3D 歌词内容：根据播放时间高亮当前行，并同步偏移工具状态
  useEffect(() => {
    const obj = lyricsObjRef.current
    const el = lyricsElRef.current
    if (!obj || !el) return
    const visible = lyricsVisible && lyricsLines.length > 0
    obj.visible = visible
    if (!visible) return

    const prevEl = el.querySelector('.vlyrics-prev') as HTMLDivElement | null
    const currentEl = el.querySelector('.vlyrics-current') as HTMLDivElement | null
    const nextEl = el.querySelector('.vlyrics-next') as HTMLDivElement | null
    const offsetEl = el.querySelector('.vlyrics-offset') as HTMLSpanElement | null
    const resetBtn = el.querySelector('.vlyrics-reset') as HTMLButtonElement | null
    if (!prevEl || !currentEl || !nextEl || !offsetEl || !resetBtn) return

    const idx = findLyricIndex(lyricsLines, lyricsCurrentTime + lyricOffset)
    const current = idx >= 0 ? lyricsLines[idx] : null
    const prev = idx > 0 ? lyricsLines[idx - 1] : null
    const next = idx >= 0 && idx < lyricsLines.length - 1 ? lyricsLines[idx + 1] : null

    prevEl.textContent = prev ? prev.text : '\u00a0'
    currentEl.textContent = current ? current.text : (lyricsLines[0]?.text || '\u00a0')
    nextEl.textContent = next ? next.text : '\u00a0'

    // 自动缩放：放得下用基准字号，放不下缩小，最小字号仍超宽则折叠为多行
    fitLyricLine(prevEl, prev ? prev.text : '\u00a0', 30, 18, '500', 700)
    fitLyricLine(currentEl, current ? current.text : (lyricsLines[0]?.text || '\u00a0'), 42, 24, '700', 700)
    fitLyricLine(nextEl, next ? next.text : '\u00a0', 30, 18, '500', 700)

    offsetEl.textContent =
      lyricOffset === 0 ? '同步' : `${lyricOffset > 0 ? '+' : ''}${lyricOffset.toFixed(1)}s`
    resetBtn.style.display = lyricOffset !== 0 ? '' : 'none'
  }, [lyricsLines, lyricsCurrentTime, lyricOffset, lyricsVisible])

  // 进入/退出全屏：重置相机（避免拖拽环绕后的角度遗留），退出时保存视角与锚点距离，待尺寸稳定后重定位标题
  useEffect(() => {
    const camera = cameraRef.current
    const target = orbitTargetRef.current
    if (camera && target) {
      // 仅“从全屏退出”的那一刻保存，避免挂载时用默认值覆盖
      if (prevFullscreenRef.current === true && !isFullscreen && orbitSphericalRef.current) {
        try {
          localStorage.setItem(ORBIT_DIST_KEY, String(orbitSphericalRef.current.radius))
        } catch {
          /* storage unavailable */
        }
      }
      prevFullscreenRef.current = isFullscreen
      // 恢复上次保存的距离，观测方向回到默认机位（矩阵正前方）
      let savedRadius = 0
      try {
        const parsed = Number.parseFloat(localStorage.getItem(ORBIT_DIST_KEY) || '')
        if (Number.isFinite(parsed) && parsed > 0) savedRadius = parsed
      } catch {
        /* ignore */
      }
      const defaultOffset = new THREE.Vector3(0, 0, 44).sub(target)
      if (savedRadius > 0) {
        defaultOffset.setLength(Math.min(ORBIT_MAX_R, Math.max(ORBIT_MIN_R, savedRadius)))
      }
      camera.position.copy(target).add(defaultOffset)
      camera.lookAt(0, 0, 0)
      orbitSphericalRef.current = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(target)
      )
    }

    const reposition = () => {
      if (!canvasRef.current || !titleObjRef.current || !historyObjRef.current || !bigTitleObjRef.current || !screenToPlaneRef.current || !planeToScreenRef.current || !matrixLeftWorldRef.current) return
      const container = canvasRef.current
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      const stp = screenToPlaneRef.current
      const pts = planeToScreenRef.current
      titleObjRef.current.position.copy(stp(70, 40))
      historyObjRef.current.position.copy(stp(w - 180, h * 0.5))
      const mls = pts(matrixLeftWorldRef.current)
      bigTitleObjRef.current.position.copy(stp(mls.x, 45))
      if (genreObjRef.current) {
        genreObjRef.current.position.copy(stp(70, 70))
      }
      if (lyricsObjRef.current && screenToPlaneAtRef.current) {
        lyricsObjRef.current.position.copy(screenToPlaneAtRef.current(w / 2, h / 2, LYRICS_Z))
      }
    }

    // 等一帧让容器尺寸更新到位再重定位，避免用过渡中的尺寸投影
    const raf = requestAnimationFrame(reposition)
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(reposition))
    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(raf2)
    }
  }, [isFullscreen])

  return (
    <div className="visualizer">
      <div ref={canvasRef} className="visualizer-canvas" />
    </div>
  )
}

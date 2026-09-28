import { useEffect, useRef, useState } from 'react'

interface SplashScreenProps {
  onExiting?: () => void
  onComplete: () => void
  cover?: string | null
}

export default function SplashScreen({ onExiting, onComplete, cover }: SplashScreenProps) {
  const [phase, setPhase] = useState<'in' | 'out'>('in')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setPhase('out')
      onExiting?.()
    }, 2600)
    return () => clearTimeout(exitTimer)
  }, [onExiting])

  const handleTransitionEnd = (e: React.TransitionEvent) => {
    if (e.propertyName === 'opacity' && phase === 'out') {
      onComplete()
    }
  }

  return (
    <div
      ref={containerRef}
      className={`splash-screen ${phase}`}
      onTransitionEnd={handleTransitionEnd}
    >
      {cover && <div className="splash-cover" style={{ backgroundImage: `url(${cover})` }} />}
      <div className="splash-field" />
      <div className="splash-noise" />
      <div className="splash-vignette" />

      <div className="splash-content">
        <div className="splash-wordmark">
          <span className="splash-word-mine">Mine</span>
          <span className="splash-word-radio">
            Rad<span className="splash-word-i">i</span>o
          </span>
          <span className="splash-word-3d">3D</span>
        </div>
        <div className="splash-signal-line" />
        <div className="splash-sub">Immersive Audio Player</div>
      </div>
    </div>
  )
}

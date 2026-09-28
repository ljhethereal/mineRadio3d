interface LockScreenProps {
  isFullscreen: boolean
  isIdle: boolean
  onExitFullscreen: () => void
}

export default function LockScreen({
  isFullscreen,
  isIdle,
  onExitFullscreen
}: LockScreenProps) {
  if (!isFullscreen) return null

  return (
    <div className={`lock-screen ${isIdle ? 'idle' : ''}`}>
      {!isIdle && (
        <button className="lock-exit-btn" onClick={onExitFullscreen}>
          退出全屏
        </button>
      )}
    </div>
  )
}

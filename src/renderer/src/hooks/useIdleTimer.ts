import { useState, useEffect, useRef, useCallback } from 'react'

export function useIdleTimer(timeout = 3000) {
  const [isIdle, setIsIdle] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    setIsIdle(false)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      setIsIdle(true)
    }, timeout)
  }, [timeout])

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel']

    const handleActivity = () => {
      reset()
    }

    events.forEach((event) => {
      window.addEventListener(event, handleActivity)
    })

    reset()

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity)
      })
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [reset])

  return isIdle
}

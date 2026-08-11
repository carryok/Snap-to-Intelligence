/**
 * useScan — the single state machine that owns the whole app.
 *
 *   idle → previewing → processing → results
 *      └─────────────→ error
 *
 * No global state library: the app has one screen's worth of state, and this
 * hook is it. `status` drives what's rendered; `stage` drives the progress
 * view while a scan is in flight.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMock, fetchMocks, scanImage, validateFile } from './client'

const STAGE_TIMING = [
  { stage: 'uploading', at: 0 },
  { stage: 'extracting', at: 1200 },
  { stage: 'enriching', at: 4800 },
]
const SLOW_AT = 15_000
const STUCK_AT = 45_000

export function useScan() {
  const [status, setStatus] = useState('idle') // idle | previewing | processing | results | error
  const [stage, setStage] = useState('uploading') // uploading | extracting | enriching
  const [slow, setSlow] = useState(false)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [envelope, setEnvelope] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [samples, setSamples] = useState([])

  const timers = useRef([])
  const alive = useRef(true)

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  const resetToIdle = useCallback(() => {
    clearTimers()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
    setEnvelope(null)
    setUploadError(null)
    setSlow(false)
    setStage('uploading')
    setStatus('idle')
  }, [clearTimers, previewUrl])

  const selectFile = useCallback(
    (nextFile) => {
      if (!nextFile) return
      const error = validateFile(nextFile)
      if (error) {
        setUploadError(error)
        return
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setUploadError(null)
      setFile(nextFile)
      setPreviewUrl(URL.createObjectURL(nextFile))
      setStatus('previewing')
    },
    [previewUrl]
  )

  const scan = useCallback(
    async (mode = 'auto') => {
      if (!file) return
      setStatus('processing')
      setEnvelope(null)
      setSlow(false)

      for (const { stage: s, at } of STAGE_TIMING) {
        timers.current.push(setTimeout(() => alive.current && setStage(s), at))
      }
      timers.current.push(setTimeout(() => alive.current && setSlow(true), SLOW_AT))
      timers.current.push(setTimeout(() => alive.current && setSlow(false), STUCK_AT))

      const result = await scanImage(file, mode)
      if (!alive.current) return

      clearTimers()
      if (result.status === 'failed') {
        setEnvelope(result)
        setStatus('error')
      } else {
        setEnvelope(result)
        setStatus('results')
      }
    },
    [clearTimers, file]
  )

  const loadMock = useCallback(
    async (id) => {
      const envelope = await fetchMock(id)
      if (!alive.current) return
      setEnvelope(envelope)
      if (envelope.status === 'failed') {
        setStatus('error')
      } else {
        setStatus('results')
      }
    },
    []
  )

  useEffect(() => {
    alive.current = true
    fetchMocks().then((list) => alive.current && setSamples(list))
    return () => {
      alive.current = false
      clearTimers()
    }
  }, [clearTimers])

  return {
    status,
    stage,
    slow,
    file,
    previewUrl,
    envelope,
    uploadError,
    samples,
    selectFile,
    clearFile: resetToIdle,
    scan,
    loadMock,
    reset: resetToIdle,
  }
}

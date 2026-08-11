import { useEffect, useState } from 'react'
import { useScan } from './api/useScan'
import { UploadPanel } from './components/UploadPanel'
import { ProcessingView } from './components/ProcessingView'
import { ProfileView } from './components/ProfileView'
import { ErrorView } from './components/ErrorView'
import './styles/app.css'

function ThemeToggle() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'system'
  )
  // 'system' follows the OS, so the icon and the action have to track what is
  // actually on screen. Reading data-theme alone offers a system-dark visitor
  // "switch to dark", which does nothing.
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = (e) => setSystemDark(e.matches)
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const isDark = theme === 'dark' || (theme === 'system' && systemDark)
  const next = isDark ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="themebtn"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {isDark ? '☾' : '☀'}
    </button>
  )
}

export default function App() {
  const {
    status, stage, slow, file, previewUrl, envelope, uploadError, samples,
    selectFile, clearFile, scan, loadMock, reset,
  } = useScan()

  return (
    <div className="app">
      <div className="app__glow" aria-hidden="true" />

      <header className="topbar">
        <div className="topbar__inner">
          <span className="brandmark">
            <span className="brandmark__dot" aria-hidden="true" />
            Snap<span className="brandmark__light">to</span>Intelligence
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="main">
        {(status === 'idle' || status === 'previewing') && (
          <UploadPanel
            file={file}
            previewUrl={previewUrl}
            error={uploadError}
            samples={samples}
            onSelect={selectFile}
            onClear={clearFile}
            onScan={scan}
            onLoadMock={loadMock}
          />
        )}

        {status === 'processing' && (
          <ProcessingView stage={stage} slow={slow} previewUrl={previewUrl} />
        )}

        {status === 'results' && (
          <ProfileView envelope={envelope} onReset={reset} />
        )}

        {status === 'error' && (
          <ErrorView
            error={envelope?.error}
            detail={envelope?.error_detail}
            samples={samples}
            onRetry={() => scan('auto')}
            onLoadMock={loadMock}
            onReset={reset}
          />
        )}
      </main>

      <footer className="foot">
        Every value is traceable to the source it came from.
      </footer>
    </div>
  )
}

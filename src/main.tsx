import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import { store } from './app/store'
import App from './App'
import './styles.css'

const theme = createTheme({
  palette: {
    primary: { main: '#1d6d65' },
    secondary: { main: '#b65e35' },
    background: { default: '#f3f1ed', paper: '#ffffff' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
    button: { textTransform: 'none', fontWeight: 700 },
  },
})

async function enableMocking() {
  if (!import.meta.env.DEV) return
  const { worker } = await import('./api/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })
  // 水合 MSW：把本地持久化的依赖链状态同步给内存 mock 库
  try {
    const persisted = localStorage.getItem('garment-sampling-draft-v3')
    if (persisted) {
      const parsed = JSON.parse(persisted) as { schemaVersion?: number; samples?: unknown[] }
      if (parsed.schemaVersion === 3 && Array.isArray(parsed.samples) && parsed.samples.length > 0) {
        await fetch('/api/state/hydrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ samples: parsed.samples }),
        })
      }
    }
  } catch {
    // 水合失败时使用 MSW 种子数据
  }
}

enableMocking().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ThemeProvider>
      </Provider>
    </React.StrictMode>,
  )
})

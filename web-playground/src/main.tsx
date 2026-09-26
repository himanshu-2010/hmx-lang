import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SplashLoader } from './ui/SplashLoader.tsx'
import { applyTheme, getInitialTheme } from './ui/theme.ts'

// Apply the persisted (or system-preferred) theme before first paint so the
// splash and the app never flash the wrong theme.
applyTheme(getInitialTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <SplashLoader />
  </StrictMode>,
)
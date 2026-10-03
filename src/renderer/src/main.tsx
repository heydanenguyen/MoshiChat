/// <reference types="vite/client" />
import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Only the hidden share window draws the story picture.
const ShareRoot = lazy(() => import('./components/ShareCard').then((m) => ({ default: m.ShareRoot })))
import { useStore } from './store'
import { useUpdate } from './updateStore'
import { useInsights } from './components/Insights'
import './styles/tokens.css'
import './styles/app.css'
import './styles/todos.css'
import './styles/liquid.css'
import './styles/pals.css'
import './styles/mono.css'

// Development only: scripted UI checks (MOSHI_UI_SCRIPT, see main/index.ts) drive the store from the page.
if (import.meta.env.DEV) (window as unknown as { __moshi: unknown }).__moshi = { store: useStore, update: useUpdate, insights: useInsights }

// #share is the hidden window that draws the Close friends story picture (see shareCard in main/index.ts).
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.hash === '#share' ? (
      <Suspense fallback={null}>
        <ShareRoot />
      </Suspense>
    ) : (
      <App />
    )}</React.StrictMode>)

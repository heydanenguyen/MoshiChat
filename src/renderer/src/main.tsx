/// <reference types="vite/client" />
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { useStore } from './store'
import { useUpdate } from './updateStore'
import './styles/tokens.css'
import './styles/app.css'

// Development only: scripted UI checks (MOSHI_UI_SCRIPT, see main/index.ts) drive the store from the page.
if (import.meta.env.DEV) (window as unknown as { __moshi: unknown }).__moshi = { store: useStore, update: useUpdate }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

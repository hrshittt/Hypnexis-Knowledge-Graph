/// <reference types="vite/client" />
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth'
import { ToastProvider } from './lib/toast'
import './index.css'

// Analytics are optional: the PostHog bundle is only downloaded when a key is configured.
const posthogKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined
if (typeof window !== 'undefined' && posthogKey) {
  import('posthog-js').then(({ default: posthog }) => {
    posthog.init(posthogKey, {
      api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

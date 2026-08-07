import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { SettingsApp } from './settings-app.js'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from settings.html')

createRoot(root).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
)

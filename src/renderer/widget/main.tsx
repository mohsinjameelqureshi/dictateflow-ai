import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './widget.css'
import { Widget } from './widget.js'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from widget.html')

createRoot(root).render(
  <StrictMode>
    <Widget />
  </StrictMode>,
)

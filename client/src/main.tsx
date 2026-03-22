import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Keep --vh CSS variable in sync with the visual viewport (accounts for keyboard + browser chrome)
function updateVH() {
  const h = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--vh', `${h}px`)
}
updateVH()
window.visualViewport?.addEventListener('resize', updateVH)
window.addEventListener('resize', updateVH)

createRoot(document.getElementById('root')!).render(<App />)

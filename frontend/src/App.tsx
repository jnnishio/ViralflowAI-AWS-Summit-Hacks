import { useCallback, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { LaunchScreen } from './components/LaunchScreen'
import { LanguageToggle } from './components/LanguageToggle'
import {
  HighlightsGridScreen,
  PlatformSelectScreen,
  ProcessingScreen,
  UploadScreen,
} from './screens'
import './App.css'

function App() {
  const [showLaunch, setShowLaunch] = useState(true)
  const handleLaunchFinish = useCallback(() => setShowLaunch(false), [])

  return (
    <>
      {showLaunch && <LaunchScreen onFinish={handleLaunchFinish} />}
      <LanguageToggle />
      <Routes>
        <Route path="/" element={<Navigate to="/upload" replace />} />
        <Route path="/upload" element={<UploadScreen />} />
        <Route path="/platforms" element={<PlatformSelectScreen />} />
        <Route path="/processing/:jobId" element={<ProcessingScreen />} />
        <Route path="/highlights/:jobId" element={<HighlightsGridScreen />} />
        <Route path="*" element={<Navigate to="/upload" replace />} />
      </Routes>
    </>
  )
}

export default App

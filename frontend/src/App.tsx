import { Navigate, Route, Routes } from 'react-router-dom'
import {
  HandoffStubScreen,
  HighlightsGridScreen,
  PlatformSelectScreen,
  ProcessingScreen,
  UploadScreen,
} from './screens'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/upload" replace />} />
      <Route path="/upload" element={<UploadScreen />} />
      <Route path="/platforms" element={<PlatformSelectScreen />} />
      <Route path="/processing/:jobId" element={<ProcessingScreen />} />
      <Route path="/highlights/:jobId" element={<HighlightsGridScreen />} />
      <Route path="/handoff/:handoffId" element={<HandoffStubScreen />} />
      <Route path="*" element={<Navigate to="/upload" replace />} />
    </Routes>
  )
}

export default App

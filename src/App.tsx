import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import AppShell from './components/layout/AppShell'
import ProtectedRoute from './routes/ProtectedRoute'
import Login from './routes/Login'
import Dashboard from './routes/Dashboard'
import Settings from './routes/Settings'
import ComingSoon from './routes/ComingSoon'
import StudyEngine from './routes/study/StudyEngine'
import VideoDetail from './routes/study/VideoDetail'
import Channels from './routes/channels/Channels'
import ChannelDetail from './routes/channels/ChannelDetail'
import ReverseVideoDetail from './routes/channels/VideoDetail'

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="/study" element={<StudyEngine />} />
              <Route path="/study/:videoId" element={<VideoDetail />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/channels/:channelId" element={<ChannelDetail />} />
              <Route path="/channels/:channelId/videos/:videoId" element={<ReverseVideoDetail />} />
              <Route path="/content-builder" element={<ComingSoon title="Content Builder" />} />
              <Route path="/knowledge-base" element={<ComingSoon title="Knowledge Base" />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App

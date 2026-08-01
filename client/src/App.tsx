import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard, PublicRoute } from './components/AuthGuard';
import { ToastContainer, LoadingSpinner } from './components/ui';

// Route-level code splitting — each page ships as its own chunk, so the
// initial bundle only loads what the current route needs. Pages are small
// enough that the Suspense fallback usually flashes for <100ms.
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then(m => ({ default: m.ChatPage })));
const KnowledgePage = lazy(() => import('./pages/KnowledgePage').then(m => ({ default: m.KnowledgePage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ApiPage = lazy(() => import('./pages/ApiPage').then(m => ({ default: m.ApiPage })));
const ImportPage = lazy(() => import('./pages/ImportPage').then(m => ({ default: m.ImportPage })));
const SharePage = lazy(() => import('./pages/SharePage').then(m => ({ default: m.SharePage })));

const PageFallback = () => <LoadingSpinner fullScreen text="Loading..." />;

function App() {
  return (
    <>
      <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Public routes */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />

        {/* Protected routes */}
        <Route
          path="/chat"
          element={
            <AuthGuard>
              <ChatPage />
            </AuthGuard>
          }
        />
        <Route
          path="/chat/:conversationId"
          element={
            <AuthGuard>
              <ChatPage />
            </AuthGuard>
          }
        />
        <Route
          path="/knowledge"
          element={
            <AuthGuard>
              <KnowledgePage />
            </AuthGuard>
          }
        />
        <Route
          path="/profile"
          element={
            <AuthGuard>
              <ProfilePage />
            </AuthGuard>
          }
        />
        <Route
          path="/api"
          element={
            <AuthGuard>
              <ApiPage />
            </AuthGuard>
          }
        />
        <Route
          path="/api/:sessionId"
          element={
            <AuthGuard>
              <ApiPage />
            </AuthGuard>
          }
        />
        <Route
          path="/import"
          element={
            <AuthGuard>
              <ImportPage />
            </AuthGuard>
          }
        />
        <Route
          path="/dashboard"
          element={
            <AuthGuard requirePermission="canManageUsers">
              <DashboardPage />
            </AuthGuard>
          }
        />

        {/* Public share page - no auth required */}
        <Route path="/share/:slug" element={<SharePage />} />

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
      </Suspense>

      {/* Toast notifications */}
      <ToastContainer />
    </>
  );
}

export default App;

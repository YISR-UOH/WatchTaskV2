import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import Header from "@/Layout/Header";
import Footer from "@/Layout/Footer";
import { PeerProvider } from "@/p2p/PeerContext";
import PeerDebugPanel from "@/p2p/PeerDebugPanel";
import { AuthProvider, useAuth } from "@/Context/AuthContext";
import Login from "@/pages/Login";
import Admin from "@/pages/Admin";
import Supervisor from "@/pages/Supervisor";
import Mantenedor from "@/pages/Mantenedor";
import OrderDetail from "@/pages/OrderDetail";
import TaskDetail from "@/pages/TaskDetail";

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to="/login" replace />;
  return children;
}

function DefaultRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  if (user.role === "supervisor") return <Navigate to="/supervisor" replace />;
  if (user.role === "mantenedor") return <Navigate to="/mantenedor" replace />;
  return <Navigate to="/login" replace />;
}
function App() {
  const BASENAME = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "") || "/";
  return (
    <BrowserRouter basename={BASENAME}>
      <PeerProvider>
        <AuthProvider>
          <div className="min-h-dvh flex flex-col">
            <Header />
            <main className="flex-grow bg-gray-50 pt-12">
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute roles={["admin"]}>
                      <Admin />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/supervisor"
                  element={
                    <ProtectedRoute roles={["supervisor"]}>
                      <Supervisor />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/mantenedor"
                  element={
                    <ProtectedRoute roles={["mantenedor"]}>
                      <Mantenedor />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/mantenedor/orden/:code"
                  element={
                    <ProtectedRoute roles={["mantenedor"]}>
                      <OrderDetail />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/mantenedor/orden/:code/tarea/:taskIndex"
                  element={
                    <ProtectedRoute roles={["mantenedor"]}>
                      <TaskDetail />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<DefaultRedirect />} />
              </Routes>
              <PeerDebugPanel />
            </main>
            <Footer />
          </div>
        </AuthProvider>
      </PeerProvider>
    </BrowserRouter>
  );
}

export default App;

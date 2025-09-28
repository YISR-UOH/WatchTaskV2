import { usePeer } from "@/p2p/PeerContext";
import { useAuth } from "@/Context/AuthContext";

export default function Header() {
  const { toggleDebug } = usePeer();
  const { user, logout } = useAuth();
  return (
    <header className="fixed top-0 left-0 w-full bg-white shadow-md z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">WatchTask</h1>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <span className="text-sm text-gray-700">
                {user.name} · {user.role}
              </span>
              <button className="btn btn-outline btn-sm" onClick={logout}>
                Salir
              </button>
            </>
          ) : null}
          <button className="btn btn-outline" onClick={toggleDebug}>
            Debug
          </button>
        </div>
      </div>
    </header>
  );
}

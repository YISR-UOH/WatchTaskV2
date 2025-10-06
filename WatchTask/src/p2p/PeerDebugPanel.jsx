import { usePeer } from "@/p2p/PeerContext";

export default function PeerDebugPanel() {
  const {
    BACKOFF_MAX,
    PING_INTERVAL_MS,
    peerId,
    isOnline,
    peers,
    connectedPeerIds,
    peerRTT,
    debugLog,
    debugOpen,
    connectToPeer,
    scheduleConnect,
    setDebugLog,
    requestUsersSnapshot,
    clearBlockedPeers,
    storagePersistence,
    refreshStoragePersistence,
  } = usePeer();

  if (!debugOpen) return null;

  const storageStatus = storagePersistence ?? {
    supported: false,
    persisted: false,
    reason: "unknown",
  };

  const storageLabel = storageStatus.persisted
    ? "Persistente"
    : storageStatus.supported
    ? "No persistente"
    : "Sin soporte";

  const storageBadgeClass = storageStatus.persisted
    ? "bg-green-100 text-green-700"
    : storageStatus.supported
    ? "bg-yellow-100 text-yellow-700"
    : "bg-gray-200 text-gray-700";

  const storageDetails = storageStatus.persisted
    ? "IndexedDB está protegido contra purgas automáticas."
    : storageStatus.supported
    ? "El navegador podría liberar datos offline si necesita espacio."
    : "El navegador usa almacenamiento 'best-effort'; no admite persistencia forzada.";

  return (
    <aside className="fixed top-12 bottom-0 right-0 w-full md:w-[520px] overflow-auto z-20 bg-white border-l border-gray-200 shadow-lg text-xs">
      <div className="px-3 py-2 border-b flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold">P2P Debug</span>
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
              isOnline
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {isOnline ? "Online" : "Offline"}
          </span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-mono text-[11px] text-gray-600 truncate max-w-[200px]"
            title={peerId || "-"}
          >
            {peerId || "-"}
          </span>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <section className="card p-2">
          <div className="flex items-center justify-between mb-1">
            <div className="heading mb-0 text-sm">Almacenamiento local</div>
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${storageBadgeClass}`}
            >
              {storageLabel}
            </span>
          </div>
          <div className="text-[11px] text-gray-700">
            {storageDetails}
            {storageStatus.reason && (
              <span className="block text-[10px] text-gray-500 mt-1">
                Motivo: {storageStatus.reason}
              </span>
            )}
            {storageStatus.error && (
              <span className="block text-[10px] text-red-600 mt-1">
                Error: {String(storageStatus.error)}
              </span>
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="btn btn-outline px-2 py-1 text-[11px]"
              onClick={() => refreshStoragePersistence({ force: true })}
            >
              Reintentar persistencia
            </button>
          </div>
        </section>

        <section>
          <div className="mb-1 text-[12px] font-medium">Conectados</div>
          {connectedPeerIds.length === 0 ? (
            <p className="muted">Sin conexiones activas…</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {connectedPeerIds.map((p) => (
                <li
                  key={p}
                  className="px-2 py-0.5 rounded border bg-green-50 text-green-800 flex items-center gap-1"
                >
                  <span
                    className="font-mono text-[11px] break-all max-w-[200px] truncate"
                    title={p}
                  >
                    {p}
                  </span>
                  {typeof peerRTT[p] === "number" && (
                    <span className="text-[10px] text-gray-600">
                      {peerRTT[p]} ms
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-2">
          <div className="flex items-center justify-between">
            <div className="heading mb-0 text-sm">Peers</div>
          </div>
          {peers.length === 0 ? (
            <p className="muted mt-1">No hay peers disponibles.</p>
          ) : (
            <ul className="divide-y h-38 overflow-auto">
              {peers.map((rid) => (
                <li key={rid} className="py-1.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="min-w-0">
                      <div
                        className="font-mono text-[11px] break-all truncate"
                        title={rid}
                      >
                        {rid}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                      <button
                        className="btn btn-outline px-2 py-1 text-[11px]"
                        onClick={() => scheduleConnect(rid)}
                      >
                        Programar
                      </button>
                      <button
                        className="btn btn-primary px-2 py-1 text-[11px]"
                        onClick={() => connectToPeer(rid)}
                      >
                        Conectar
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-2">
          <div className="flex items-center justify-between mb-2">
            <div className="heading mb-0 text-sm">Jerarquía P2P</div>
            <button
              className="btn btn-outline px-2 py-1 text-[11px]"
              onClick={() => {
                const count = clearBlockedPeers();
                alert(`${count} peers desbloqueados`);
              }}
            >
              Desbloquear todos
            </button>
          </div>
          <div className="text-[10px] text-gray-600 mb-2">
            Reglas: admin↔supervisor, mantenedor↔supervisor
          </div>
        </section>

        <section className="card p-2">
          <div className="flex items-center justify-between mb-2">
            <div className="heading mb-0 text-sm">Log</div>
            <div className="flex gap-2">
              <button
                className="btn btn-outline px-2 py-1 text-[11px]"
                onClick={async () => {
                  if (!peerId) return;
                  try {
                    const { ref, remove } = await import("firebase/database");
                    const { db } = await import("@/utils/firebaseConfig");
                    await remove(ref(db, `signals/${peerId}`));
                  } catch {}
                }}
              >
                Limpiar señales
              </button>
              <button
                className="btn btn-outline px-2 py-1 text-[11px]"
                onClick={() => setDebugLog([])}
              >
                Limpiar log
              </button>
              <button
                className="btn btn-primary px-2 py-1 text-[11px]"
                onClick={() => requestUsersSnapshot()}
              >
                Pedir usuarios
              </button>
            </div>
          </div>
          <div className="border rounded p-2 bg-white">
            <ul className="messages h-50 overflow-auto">
              {debugLog.slice(-100).map((line, idx) => (
                <li key={idx} className="font-mono text-[11px]">
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 text-[10px] text-gray-500">
            BACKOFF: {BACKOFF_MAX} ms · PING: {PING_INTERVAL_MS} ms
          </div>
        </section>
      </div>
    </aside>
  );
}

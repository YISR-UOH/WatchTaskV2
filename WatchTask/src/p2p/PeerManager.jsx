// src/components/PeerManager.jsx
import { useEffect, useRef, useState } from "react";
import { db } from "@/utils/firebaseConfig";
import {
  ref,
  set,
  onValue,
  remove,
  push,
  onChildAdded,
  off,
  onDisconnect,
} from "firebase/database";
import adapter from "webrtc-adapter";

export default function PeerManager() {
  // Configuración
  const BACKOFF_MAX =
    Number.parseInt(import.meta.env.VITE_PEER_CONNECT_BACKOFF_MS, 10) || 15000; // ms
  const PING_INTERVAL_MS =
    Number.parseInt(import.meta.env.VITE_PEER_PING_INTERVAL_MS, 10) || 5000; // ms
  // STUN servers (configurable por env, con defaults múltiples)
  const STUN_URLS = (
    import.meta.env.VITE_STUN_URLS ||
    [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
      "stun:stun3.l.google.com:19302",
      "stun:stun4.l.google.com:19302",
    ].join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ICE_SERVERS = STUN_URLS.map((u) => ({ urls: u }));

  const [peerId, setPeerId] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [peers, setPeers] = useState([]);
  const [connectedPeerIds, setConnectedPeerIds] = useState([]);
  const [peerRTT, setPeerRTT] = useState({}); // { [peerId]: ms }
  const [debugLog, setDebugLog] = useState([]); // depuración
  const connectionsRef = useRef({}); // { [remoteId]: { pc, dc, pingTimer, lastPingTs, pendingCandidates: [] } }
  const isOnlineRef = useRef(isOnline);
  const signalsListenerRef = useRef(null); // { ref, cb }
  const makingOfferRef = useRef({}); // { [remoteId]: boolean }
  const politeRef = useRef({}); // { [remoteId]: boolean }
  const connectTimersRef = useRef({}); // { [remoteId]: timeoutId }
  const peersSetRef = useRef(new Set());
  const pendingConnectSetRef = useRef(new Set()); // peers a reintentar cuando vuelva la red
  const previousPeersRef = useRef(new Set()); // histórico de peers vistos/conectados
  const selfDbRefRef = useRef(null); // referencia a nuestra presencia en RTDB
  const attemptCountsRef = useRef({}); // número de intentos por peer
  // Nota: solo STUN + ICE, TUNR aun no es necesario.

  const dlog = (...args) => {
    const line = `[${new Date().toLocaleTimeString()}] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}`;
    setDebugLog((prev) => [...prev.slice(-200), line]);
    // eslint-disable-next-line no-console
    console.log("[PeerDebug]", ...args);
  };

  // Registro del peer y escucha de otros peers
  useEffect(() => {
    // Identidad estable por dispositivo/navegador
    let baseId = localStorage.getItem("peerBaseId");
    if (!baseId) {
      baseId = `guest-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      localStorage.setItem("peerBaseId", baseId);
    }
    // Sufijo efímero por pestaña/sesión
    let sessionId = sessionStorage.getItem("peerSessionId");
    if (!sessionId) {
      sessionId = `${Math.floor(Math.random() * 100000)}`;
      sessionStorage.setItem("peerSessionId", sessionId);
    }
    const id = `${baseId}-${sessionId}`;
    setPeerId(id);

    const selfRef = ref(db, `peers/${id}`);
    selfDbRefRef.current = selfRef;
    set(selfRef, {
      peerId: id,
      baseId: baseId,
      status: "online",
      updatedAt: Date.now(),
    });
    try {
      onDisconnect(selfRef).remove();
    } catch {}

    const beforeUnload = () => remove(selfRef);
    window.addEventListener("beforeunload", beforeUnload);

    const peersRef = ref(db, "peers");
    const unsub = onValue(peersRef, (snapshot) => {
      const data = snapshot.val() || {};
      const others = Object.keys(data).filter((key) => key !== id);
      setPeers(others);
      dlog("Peers actualizados:", others.join(", "));
    });

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      try {
        unsub();
      } catch {}
      remove(selfRef);
    };
  }, []);

  useEffect(() => {
    peersSetRef.current = new Set(peers);
  }, [peers]);

  // Mantener ref sincronizada con estado online
  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  // Escuchar cambios de red del navegador
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      dlog(
        "Red disponible: re-registrando presencia y reintentando conexiones"
      );
      // Re-registrar presencia
      try {
        const id = peerId;
        if (id) {
          const selfRef = selfDbRefRef.current || ref(db, `peers/${id}`);
          selfDbRefRef.current = selfRef;
          await set(selfRef, {
            peerId: id,
            status: "online",
            updatedAt: Date.now(),
          });
          try {
            onDisconnect(selfRef).remove();
          } catch {}
        }
      } catch (e) {
        dlog("Error re-registrando presencia:", String(e));
      }
      // Reprogramar todos los pendientes
      const toRetry = Array.from(pendingConnectSetRef.current);
      pendingConnectSetRef.current.clear();
      toRetry.forEach((rid) => scheduleConnect(rid));
      // Y además, intentar reconectar con peers conocidos
      Array.from(previousPeersRef.current).forEach((rid) =>
        scheduleConnect(rid)
      );
    };
    const handleOffline = () => {
      setIsOnline(false);
      dlog("Sin conexión: pausando intentos de conexión");
      // Cancelar timers en curso y poner en cola
      Object.keys(connectTimersRef.current).forEach((rid) => {
        try {
          clearTimeout(connectTimersRef.current[rid]);
        } catch {}
        delete connectTimersRef.current[rid];
        pendingConnectSetRef.current.add(rid);
      });
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [peerId]);

  // Crear/obtener RTCPeerConnection y configurar handlers comunes
  const ensurePeerConnection = (remoteId) => {
    let conn = connectionsRef.current[remoteId];
    if (conn && conn.pc) return conn;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    dlog(
      "RTCPeerConnection creada",
      remoteId,
      "iceServers=",
      ICE_SERVERS.map((s) => s.urls).join("|")
    );

    const pendingCandidates = [];

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const iceRef = push(ref(db, `signals/${remoteId}`));
        const cand = event.candidate.toJSON
          ? event.candidate.toJSON()
          : {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              usernameFragment: event.candidate.usernameFragment,
            };
        set(iceRef, { from: peerId, candidate: cand });
        dlog("ICE local ->", remoteId);
      }
    };

    pc.onicegatheringstatechange = () => {
      dlog("iceGatheringState", remoteId, pc.iceGatheringState);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        cleanupConnection(remoteId);
        // Intentar reconexión con backoff si el peer sigue presente
        if (peersSetRef.current.has(remoteId)) scheduleConnect(remoteId);
      }
      dlog("connectionState", remoteId, pc.connectionState);
      if (pc.connectionState === "failed") {
        dlog(
          "Conexión failed con",
          remoteId,
          "intentos=",
          attemptCountsRef.current[remoteId] || 0
        );
      }
    };

    pc.oniceconnectionstatechange = () => {
      // Si perdemos conectividad temporalmente, intentamos recuperar
      if (pc.iceConnectionState === "disconnected") {
        // Esperar un poco antes de decidir reconectar
        setTimeout(() => {
          if (
            connectionsRef.current[remoteId]?.pc?.iceConnectionState ===
            "disconnected"
          ) {
            cleanupConnection(remoteId);
            if (peersSetRef.current.has(remoteId)) scheduleConnect(remoteId);
          }
        }, 3000);
      }
      dlog("iceConnectionState", remoteId, pc.iceConnectionState);
    };

    // Si somos answerer, recibimos el dataChannel
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel?.label === "dataChannel") {
        setupDataChannel(remoteId, channel);
      }
    };

    // Estado DTLS/SCTP para diagnóstico
    pc.onnegotiationneeded = () => {
      dlog("negotiationneeded", remoteId);
    };
    // No hay eventos directos para DTLS/SCTP, pero podemos loguear transceiver
    pc.getTransceivers?.().forEach((t, idx) => {
      dlog("transceiver", idx, t.direction);
    });

    connectionsRef.current[remoteId] = {
      pc,
      dc: null,
      pingTimer: null,
      lastPingTs: null,
      pendingCandidates,
    };
    // Marcar como peer visto
    previousPeersRef.current.add(remoteId);
    return connectionsRef.current[remoteId];
  };

  const flushPendingCandidates = async (remoteId) => {
    const conn = connectionsRef.current[remoteId];
    if (!conn) return;
    const { pc, pendingCandidates } = conn;
    if (!pc.remoteDescription) return;
    while (pendingCandidates.length) {
      const c = pendingCandidates.shift();
      try {
        // eslint-disable-next-line no-await-in-loop
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {}
    }
  };

  const setupDataChannel = (remoteId, dc) => {
    const conn = connectionsRef.current[remoteId];
    if (!conn) return;
    conn.dc = dc;

    dc.onopen = () => {
      // Marcar como conectado y empezar pings
      setConnectedPeerIds((prev) => Array.from(new Set([...prev, remoteId])));
      startPing(remoteId);
      previousPeersRef.current.add(remoteId);
      dlog("DataChannel abierto con", remoteId);
      attemptCountsRef.current[remoteId] = 0;
    };

    dc.onclose = () => {
      stopPing(remoteId);
      setConnectedPeerIds((prev) => prev.filter((id) => id !== remoteId));
      dlog("DataChannel cerrado con", remoteId);
    };

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "ping") {
          // responder pong
          dc.send(JSON.stringify({ type: "pong", ts: msg.ts }));
        } else if (msg.type === "pong") {
          const now = performance.now();
          const rtt = Math.max(0, now - (msg.ts || now));
          setPeerRTT((prev) => ({ ...prev, [remoteId]: Math.round(rtt) }));
        } else {
          dlog("Msg de", remoteId, msg);
        }
      } catch {
        dlog("Msg crudo:", event.data);
      }
    };
  };

  const startPing = (remoteId) => {
    const conn = connectionsRef.current[remoteId];
    if (!conn || !conn.dc) return;
    stopPing(remoteId);
    conn.pingTimer = setInterval(() => {
      if (conn.dc?.readyState === "open") {
        const ts = performance.now();
        conn.lastPingTs = ts;
        conn.dc.send(JSON.stringify({ type: "ping", ts }));
      }
    }, PING_INTERVAL_MS);
  };

  const stopPing = (remoteId) => {
    const conn = connectionsRef.current[remoteId];
    if (conn?.pingTimer) {
      clearInterval(conn.pingTimer);
      conn.pingTimer = null;
    }
  };

  const cleanupConnection = (remoteId) => {
    const conn = connectionsRef.current[remoteId];
    if (!conn) return;
    stopPing(remoteId);
    try {
      conn.dc?.close?.();
    } catch {}
    try {
      conn.pc?.close?.();
    } catch {}
    delete connectionsRef.current[remoteId];
    setConnectedPeerIds((prev) => prev.filter((id) => id !== remoteId));
    setPeerRTT((prev) => {
      const { [remoteId]: _, ...rest } = prev;
      return rest;
    });
  };

  // Función para iniciar conexión con un peer (somos el offerer)
  const connectToPeer = async (remoteId) => {
    if (!peerId) return;
    if (!isOnlineRef.current) {
      dlog("Sin red; conexión diferida para", remoteId);
      pendingConnectSetRef.current.add(remoteId);
      return;
    }
    if (connectionsRef.current[remoteId]?.pc) return; // ya iniciando o conectado
    // Incrementar contador de intentos
    attemptCountsRef.current[remoteId] =
      (attemptCountsRef.current[remoteId] || 0) + 1;
    const attempts = attemptCountsRef.current[remoteId];
    dlog("Intento #", attempts, "con", remoteId);
    const { pc } = ensurePeerConnection(remoteId);

    // Crear canal de datos y configurarlo
    const dc = pc.createDataChannel("dataChannel");
    setupDataChannel(remoteId, dc);

    // Crear offer y enviarla por Firebase
    try {
      makingOfferRef.current[remoteId] = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const offerRef = push(ref(db, `signals/${remoteId}`));
      set(offerRef, { from: peerId, sdp: offer });
      dlog("Offer enviada ->", remoteId);
    } finally {
      makingOfferRef.current[remoteId] = false;
    }
  };

  // Programar intento de conexión con retardo aleatorio
  const scheduleConnect = (remoteId) => {
    if (!isOnlineRef.current) {
      pendingConnectSetRef.current.add(remoteId);
      dlog("Offline; intento diferido para", remoteId);
      return;
    }
    if (connectTimersRef.current[remoteId]) return;
    if (connectionsRef.current[remoteId]) return;
    const delayMs = Math.floor(Math.random() * (BACKOFF_MAX + 1));
    dlog("Programado intento en", delayMs, "ms para", remoteId);
    const tid = setTimeout(() => {
      // Verificar que el peer sigue presente y no estamos conectados
      if (
        !connectionsRef.current[remoteId] &&
        peersSetRef.current.has(remoteId)
      ) {
        connectToPeer(remoteId);
      }
      delete connectTimersRef.current[remoteId];
    }, delayMs);
    connectTimersRef.current[remoteId] = tid;
  };

  // Listener de señalización entrante (offers/answers/candidates)
  useEffect(() => {
    if (!peerId) return;
    const signalsRef = ref(db, `signals/${peerId}`);
    const cb = onChildAdded(signalsRef, async (snap) => {
      const data = snap.val();
      const from = data?.from;
      if (!from || from === peerId) {
        await remove(snap.ref); // limpiar igualmente
        return;
      }
      const conn = ensurePeerConnection(from);
      const pc = conn.pc;
      try {
        if (data.sdp) {
          const sdp = data.sdp;
          if (sdp.type === "offer") {
            // Minimal Perfect Negotiation
            // Calcular rol "polite" una sola vez por par
            if (politeRef.current[from] == null) {
              // Hacemos "polite" al peer con id lexicográficamente mayor
              politeRef.current[from] = peerId > from;
            }
            const polite = politeRef.current[from];
            const isMakingOffer = !!makingOfferRef.current[from];
            const isStable = pc.signalingState === "stable";
            if (!isStable || isMakingOffer) {
              if (!polite) {
                // Impolite: ignorar oferta en conflicto
                return;
              }
              // Polite: rollback local y aceptar la oferta remota
              try {
                await pc.setLocalDescription({ type: "rollback" });
              } catch {}
            }
            await pc.setRemoteDescription(sdp);
            await flushPendingCandidates(from);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const answerRef = push(ref(db, `signals/${from}`));
            set(answerRef, { from: peerId, sdp: answer });
            dlog("Answer enviada ->", from);
          } else if (sdp.type === "answer") {
            // Somos offerer: completar handshake
            if (pc.signalingState === "have-local-offer") {
              try {
                await pc.setRemoteDescription(sdp);
                await flushPendingCandidates(from);
                dlog("Answer aplicada de", from);
              } catch (e) {
                dlog("Error setRemoteDescription(answer):", String(e));
              }
            } else {
              dlog(
                "Descartando answer por estado",
                pc.signalingState,
                "de",
                from
              );
            }
          }
        } else if (data.candidate) {
          const candidate = data.candidate;
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch {}
            dlog("ICE remota aplicada de", from);
          } else {
            // Cola si aún no hay remoteDescription
            conn.pendingCandidates.push(candidate);
            // Intento de vaciado cuando llegue remoteDescription
            const int = setInterval(async () => {
              if (pc.remoteDescription) {
                clearInterval(int);
                await flushPendingCandidates(from);
                dlog("ICE encoladas aplicadas de", from);
              }
            }, 200);
          }
        }
      } finally {
        // limpiar señal procesada
        await remove(snap.ref);
      }
    });
    signalsListenerRef.current = { ref: signalsRef, cb };
    return () => {
      if (signalsListenerRef.current) {
        const { ref: r, cb: _cb } = signalsListenerRef.current;
        try {
          off(r, "child_added", _cb);
        } catch {}
      }
    };
  }, [peerId]);

  // Conectar automáticamente a nuevos peers (como offerer según regla anti-glare)
  useEffect(() => {
    if (!peerId) return;
    const currentPeersSet = new Set(peers);

    // Programar intentos por cada peer nuevo
    peers.forEach((remoteId) => scheduleConnect(remoteId));
    // Acumular en histórico
    peers.forEach((remoteId) => previousPeersRef.current.add(remoteId));

    // Cancelar timers de peers que ya no están
    Object.keys(connectTimersRef.current).forEach((rid) => {
      if (!currentPeersSet.has(rid)) {
        clearTimeout(connectTimersRef.current[rid]);
        delete connectTimersRef.current[rid];
      }
    });
  }, [peers, peerId]);

  // Limpiar timers al desmontar
  useEffect(() => {
    return () => {
      Object.values(connectTimersRef.current).forEach((tid) => {
        try {
          clearTimeout(tid);
        } catch {}
      });
      connectTimersRef.current = {};
    };
  }, []);

  // Limpieza general al salir
  useEffect(() => {
    if (!peerId) return;
    const peerRef = ref(db, `peers/${peerId}`);
    const handleBeforeUnload = () => {
      remove(peerRef);
      Object.keys(connectionsRef.current).forEach((rid) =>
        cleanupConnection(rid)
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      handleBeforeUnload();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [peerId]);

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">
        Peer ID: {peerId}
        <span
          className={`ml-3 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            isOnline ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}
          title={isOnline ? "Online" : "Offline"}
        >
          {isOnline ? "Online" : "Offline"}
        </span>
      </h2>
      <h3 className="text-md font-medium mb-2">
        Peers conectados (canal de datos activo):
      </h3>
      {connectedPeerIds.length === 0 ? (
        <p className="muted">Sin conexiones activas todavía…</p>
      ) : (
        <ul className="list-disc list-inside">
          {connectedPeerIds.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <span>{p}</span>
              {typeof peerRTT[p] === "number" && (
                <span className="text-sm text-gray-500">{peerRTT[p]} ms</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <div className="heading">Peers descubiertos</div>
          {peers.length === 0 ? (
            <p className="muted">No hay peers disponibles.</p>
          ) : (
            <ul className="space-y-2">
              {peers.map((rid) => {
                const conn = connectionsRef.current[rid];
                const scheduled = !!connectTimersRef.current[rid];
                const pc = conn?.pc;
                const dc = conn?.dc;
                const attempts = attemptCountsRef.current[rid] || 0;
                return (
                  <li key={rid} className="border rounded p-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-mono text-sm">{rid}</div>
                        <div className="text-xs text-gray-500">
                          {scheduled ? "Intento programado…" : "Sin intento"}
                          {attempts > 0 && (
                            <span className="ml-2">intentos: {attempts}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="btn btn-outline"
                          onClick={() => scheduleConnect(rid)}
                        >
                          Programar
                        </button>
                        <button
                          className="btn btn-primary"
                          onClick={() => connectToPeer(rid)}
                        >
                          Conectar ahora
                        </button>
                      </div>
                    </div>
                    {pc && (
                      <div className="mt-2 text-xs text-gray-600">
                        <div>signaling: {pc.signalingState}</div>
                        <div>conn: {pc.connectionState}</div>
                        <div>ice: {pc.iceConnectionState}</div>
                        <div>dc: {dc?.readyState || "-"}</div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="heading">Depuración</div>
          <div className="text-xs text-gray-700 mb-2">
            BACKOFF_MAX: {BACKOFF_MAX} ms · PING_INTERVAL: {PING_INTERVAL_MS} ms
          </div>
          <div className="flex gap-2 mb-2">
            <button
              className="btn btn-outline"
              onClick={async () => {
                if (!peerId) return;
                try {
                  await remove(ref(db, `signals/${peerId}`));
                  dlog("Señales pendientes limpiadas");
                } catch (e) {
                  dlog("Error limpiando señales:", String(e));
                }
              }}
            >
              Limpiar mis señales
            </button>
            <button className="btn btn-outline" onClick={() => setDebugLog([])}>
              Limpiar log
            </button>
          </div>
          <div className="h-48 overflow-auto border rounded p-2 bg-white">
            <ul className="messages">
              {debugLog.map((line, idx) => (
                <li key={idx} className="font-mono text-[11px]">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

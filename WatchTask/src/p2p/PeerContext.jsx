import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

const PeerContext = createContext(null);

export function PeerProvider({ children }) {
  // Configuración
  const BACKOFF_MAX =
    Number.parseInt(import.meta.env.VITE_PEER_CONNECT_BACKOFF_MS, 10) || 15000; // ms
  const PING_INTERVAL_MS =
    Number.parseInt(import.meta.env.VITE_PEER_PING_INTERVAL_MS, 10) || 5000; // ms
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
  const [peerRTT, setPeerRTT] = useState({});
  const [debugLog, setDebugLog] = useState([]);
  const [debugOpen, setDebugOpen] = useState(false);

  const connectionsRef = useRef({});
  const isOnlineRef = useRef(isOnline);
  const signalsListenerRef = useRef(null);
  const makingOfferRef = useRef({});
  const politeRef = useRef({});
  const connectTimersRef = useRef({});
  const peersSetRef = useRef(new Set());
  const pendingConnectSetRef = useRef(new Set());
  const previousPeersRef = useRef(new Set());
  const selfDbRefRef = useRef(null);
  const attemptCountsRef = useRef({});

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
      const toRetry = Array.from(pendingConnectSetRef.current);
      pendingConnectSetRef.current.clear();
      toRetry.forEach((rid) => scheduleConnect(rid));
      Array.from(previousPeersRef.current).forEach((rid) =>
        scheduleConnect(rid)
      );
    };
    const handleOffline = () => {
      setIsOnline(false);
      dlog("Sin conexión: pausando intentos de conexión");
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
      if (pc.iceConnectionState === "disconnected") {
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

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel?.label === "dataChannel") {
        setupDataChannel(remoteId, channel);
      }
    };

    pc.onnegotiationneeded = () => {
      dlog("negotiationneeded", remoteId);
    };
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

  const connectToPeer = async (remoteId) => {
    if (!peerId) return;
    if (!isOnlineRef.current) {
      dlog("Sin red; conexión diferida para", remoteId);
      pendingConnectSetRef.current.add(remoteId);
      return;
    }
    if (connectionsRef.current[remoteId]?.pc) return;
    attemptCountsRef.current[remoteId] =
      (attemptCountsRef.current[remoteId] || 0) + 1;
    const attempts = attemptCountsRef.current[remoteId];
    dlog("Intento #", attempts, "con", remoteId);
    const { pc } = ensurePeerConnection(remoteId);

    const dc = pc.createDataChannel("dataChannel");
    setupDataChannel(remoteId, dc);

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

  useEffect(() => {
    if (!peerId) return;
    const signalsRef = ref(db, `signals/${peerId}`);
    const cb = onChildAdded(signalsRef, async (snap) => {
      const data = snap.val();
      const from = data?.from;
      if (!from || from === peerId) {
        await remove(snap.ref);
        return;
      }
      const conn = ensurePeerConnection(from);
      const pc = conn.pc;
      try {
        if (data.sdp) {
          const sdp = data.sdp;
          if (sdp.type === "offer") {
            if (politeRef.current[from] == null) {
              politeRef.current[from] = peerId > from;
            }
            const polite = politeRef.current[from];
            const isMakingOffer = !!makingOfferRef.current[from];
            const isStable = pc.signalingState === "stable";
            if (!isStable || isMakingOffer) {
              if (!polite) {
                return;
              }
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
            conn.pendingCandidates.push(candidate);
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

  useEffect(() => {
    if (!peerId) return;
    const currentPeersSet = new Set(peers);
    peers.forEach((remoteId) => scheduleConnect(remoteId));
    peers.forEach((remoteId) => previousPeersRef.current.add(remoteId));
    Object.keys(connectTimersRef.current).forEach((rid) => {
      if (!currentPeersSet.has(rid)) {
        clearTimeout(connectTimersRef.current[rid]);
        delete connectTimersRef.current[rid];
      }
    });
  }, [peers, peerId]);

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

  const value = useMemo(
    () => ({
      // config
      ICE_SERVERS,
      BACKOFF_MAX,
      PING_INTERVAL_MS,
      // state
      peerId,
      isOnline,
      peers,
      connectedPeerIds,
      peerRTT,
      debugLog,
      debugOpen,
      // actions
      connectToPeer,
      scheduleConnect,
      cleanupConnection,
      setDebugLog,
      openDebug: () => setDebugOpen(true),
      closeDebug: () => setDebugOpen(false),
      toggleDebug: () => setDebugOpen((v) => !v),
    }),
    [peerId, isOnline, peers, connectedPeerIds, peerRTT, debugLog, debugOpen]
  );

  return <PeerContext.Provider value={value}>{children}</PeerContext.Provider>;
}

export function usePeer() {
  const ctx = useContext(PeerContext);
  if (!ctx) throw new Error("usePeer must be used within <PeerProvider>");
  return ctx;
}

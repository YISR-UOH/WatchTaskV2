import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ref,
  set,
  onValue,
  remove,
  push,
  onChildAdded,
  off,
  onDisconnect,
  update,
} from "firebase/database";
import { db } from "@/utils/firebaseConfig";
import {
  getUsersSnapshot,
  applyUsersSnapshot,
  getOrdersSnapshotForSpeciality,
  applyOrdersSnapshot,
  getUsersMeta,
  getOrdersMeta,
  getOrdersSnapshotForUser,
  ensurePersistentStorage,
  getPersistentStorageStatus,
} from "@/utils/APIdb";
import { useIceServerManager } from "@/p2p/hooks/useIceServerManager";
import {
  compressPayload,
  decompressPayload,
  createChunks,
  encodeBinaryChunk,
  decodeBinaryChunk,
  reassembleChunks,
  buildChunkKey,
} from "@/p2p/utils/dataTransfer";

const PeerContext = createContext(null);

export function PeerProvider({ children }) {
  const BACKOFF_MAX =
    Number.parseInt(import.meta.env.VITE_PEER_CONNECT_BACKOFF_MS, 10) || 15000;
  const PING_INTERVAL_MS =
    Number.parseInt(import.meta.env.VITE_PEER_PING_INTERVAL_MS, 10) || 5000;
  const CHUNK_SIZE = Number.parseInt(import.meta.env.VITE_CHUNK_SIZE, 10) || 5;
  const CHUNK_DELAY_MS =
    Number.parseInt(import.meta.env.VITE_CHUNK_DELAY_MS, 10) || 50;
  const DC_BUFFER_MAX =
    Number.parseInt(import.meta.env.VITE_DC_BUFFER_MAX, 10) || 128 * 1024;
  const DC_BUFFER_LOW =
    Number.parseInt(import.meta.env.VITE_DC_BUFFER_LOW, 10) ||
    Math.floor(DC_BUFFER_MAX / 2);

  const TURN_API_URL = (import.meta.env.VITE_TURN_CREDENTIALS_URL || "").trim();
  const TURN_API_KEY = (import.meta.env.VITE_TURN_API_KEY || "").trim();

  const [peerId, setPeerId] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [peers, setPeers] = useState([]);
  const [connectedPeerIds, setConnectedPeerIds] = useState([]);
  const [peerRTT, setPeerRTT] = useState({});
  const [debugLog, setDebugLog] = useState([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const [storagePersistence, setStoragePersistence] = useState(() =>
    getPersistentStorageStatus()
  );

  const connectionsRef = useRef({});
  const isOnlineRef = useRef(isOnline);
  const connectTimersRef = useRef({});
  const peersSetRef = useRef(new Set());
  const pendingConnectSetRef = useRef(new Set());
  const previousPeersRef = useRef(new Set());
  const signalsListenerRef = useRef(null);
  const makingOfferRef = useRef({});
  const politeRef = useRef({});
  const attemptCountsRef = useRef({});
  const selfDbRefRef = useRef(null);
  const blockedPeersRef = useRef(new Set());

  const authUserRef = useRef(null);
  const pendingUsersRequestsRef = useRef(new Set());
  const remoteInfoRef = useRef({});
  const accumulatingOrdersRef = useRef({});
  const accumulatingChunksRef = useRef({});
  const textEncoderRef = useRef(
    typeof TextEncoder !== "undefined" ? new TextEncoder() : null
  );
  const mountedRef = useRef(true);
  const scheduleConnectRef = useRef();

  const debugLogRef = useRef([]);
  const dlog = useCallback((...args) => {
    const line = `[${new Date().toLocaleTimeString()}] ${args
      .map((value) =>
        typeof value === "string" ? value : JSON.stringify(value, null, 2)
      )
      .join(" ")}`;
    debugLogRef.current = [...debugLogRef.current.slice(-500), line];
    setDebugLog(debugLogRef.current);
  }, []);

  const {
    iceServers: ICE_SERVERS,
    turnOnlyServers: TURN_ONLY_SERVERS,
    requestIceServers,
  } = useIceServerManager({
    apiUrl: TURN_API_URL,
    apiKey: TURN_API_KEY,
    dlog,
    mountedRef,
  });

  const connectionIceModeRef = useRef(new Map());

  const getIceServersForRemote = useCallback(
    (remoteId) =>
      connectionIceModeRef.current.get(remoteId) === "turn-only"
        ? TURN_ONLY_SERVERS
        : ICE_SERVERS,
    [ICE_SERVERS, TURN_ONLY_SERVERS]
  );

  const markRemoteForTurnOnly = useCallback(
    (remoteId, reason) => {
      if (connectionIceModeRef.current.get(remoteId) === "turn-only") {
        return false;
      }
      connectionIceModeRef.current.set(remoteId, "turn-only");
      dlog("Forzando TURN para peer", remoteId, reason);
      requestIceServers();
      return true;
    },
    [dlog, requestIceServers]
  );

  const enqueueReconnect = useCallback((remoteId) => {
    if (!remoteId) return;
    if (!peersSetRef.current.has(remoteId)) return;
    if (blockedPeersRef.current.has(remoteId)) return;
    pendingConnectSetRef.current.add(remoteId);
    if (isOnlineRef.current && scheduleConnectRef.current) {
      scheduleConnectRef.current(remoteId);
    }
  }, []);

  const flushQueue = useCallback(
    (remoteId) => {
      const conn = connectionsRef.current?.[remoteId];
      if (!conn) return;
      const { dc } = conn;
      if (!dc || dc.readyState !== "open") {
        if (conn.flushScheduled) {
          clearTimeout(conn.flushScheduled);
          conn.flushScheduled = null;
        }
        return;
      }
      if (!Array.isArray(conn.queue) || conn.queue.length === 0) {
        if (conn.flushScheduled) {
          clearTimeout(conn.flushScheduled);
          conn.flushScheduled = null;
        }
        return;
      }
      while (conn.queue.length) {
        const entry = conn.queue[0];
        if (!entry) {
          conn.queue.shift();
          continue;
        }
        const allowOverflow = entry.size > DC_BUFFER_MAX;
        if (!allowOverflow && dc.bufferedAmount + entry.size > DC_BUFFER_MAX) {
          break;
        }
        try {
          dc.send(entry.data);
        } catch (err) {
          dlog("sendJSON flush error", remoteId, String(err));
          break;
        }
        conn.queue.shift();
      }
      if (conn.queue.length === 0) {
        if (conn.flushScheduled) {
          clearTimeout(conn.flushScheduled);
          conn.flushScheduled = null;
        }
        return;
      }
      if (!conn.flushScheduled) {
        conn.flushScheduled = setTimeout(() => {
          conn.flushScheduled = null;
          flushQueue(remoteId);
        }, 120);
      }
    },
    [DC_BUFFER_MAX, dlog]
  );

  const sendJSON = useCallback(
    (remoteId, payload) => {
      try {
        let conn = connectionsRef.current?.[remoteId];
        if (!conn) {
          conn = {
            pc: null,
            dc: null,
            pingTimer: null,
            pendingCandidates: [],
            queue: [],
            bufferedLowHandler: null,
            flushScheduled: null,
          };
          connectionsRef.current[remoteId] = conn;
        }
        if (!Array.isArray(conn.queue)) {
          conn.queue = [];
        }
        const data = JSON.stringify(payload);
        const size = textEncoderRef.current?.encode(data).length ?? data.length;
        conn.queue.push({ data, size });

        const { dc } = conn;
        if (!dc || dc.readyState !== "open") {
          dlog(
            "sendJSON: canal pendiente",
            remoteId,
            "state",
            dc?.readyState ?? "sin canal",
            "pendientes",
            conn.queue.length
          );
          if (!conn.flushScheduled) {
            conn.flushScheduled = setTimeout(() => {
              conn.flushScheduled = null;
              flushQueue(remoteId);
            }, 150);
          }
          return true;
        }

        if (!conn.bufferedLowHandler) {
          const handler = () => flushQueue(remoteId);
          conn.bufferedLowHandler = handler;
          if (typeof dc.addEventListener === "function") {
            dc.addEventListener("bufferedamountlow", handler);
          } else {
            dc.onbufferedamountlow = handler;
          }
        }

        if (typeof dc.bufferedAmountLowThreshold === "number") {
          dc.bufferedAmountLowThreshold = DC_BUFFER_LOW;
        }

        if (dc.bufferedAmount + size > DC_BUFFER_MAX) {
          dlog(
            "sendJSON: encolado por buffer",
            remoteId,
            "buffered",
            dc.bufferedAmount,
            "pendientes",
            conn.queue.length
          );
        }

        flushQueue(remoteId);
        return true;
      } catch (err) {
        dlog("sendJSON fallo", remoteId, String(err));
        return false;
      }
    },
    [DC_BUFFER_LOW, DC_BUFFER_MAX, dlog, flushQueue]
  );
  const sendEfficientData = useCallback(
    (remoteId, payload, type, metadata = {}) => {
      try {
        const { data, compressed } = compressPayload(payload);
        const chunks = createChunks(data, compressed);

        if (chunks.length === 1) {
          const message = {
            type,
            payload: compressed
              ? {
                  data: encodeBinaryChunk(data),
                  compressed: true,
                }
              : payload,
            ...metadata,
          };
          return sendJSON(remoteId, message);
        } else {
          let sentCount = 0;
          const sendNextChunk = () => {
            if (sentCount >= chunks.length) return;

            const chunk = chunks[sentCount];
            const chunkData = chunk.data;
            const message = {
              type: "dataChunk",
              payload: {
                data: compressed ? encodeBinaryChunk(chunkData) : chunkData,
                index: chunk.index,
                total: chunk.total,
                compressed,
                originalType: type,
                metadata,
              },
            };

            const success = sendJSON(remoteId, message);
            if (success) {
              sentCount++;
              if (sentCount < chunks.length) {
                setTimeout(sendNextChunk, 0);
              }
            } else {
              dlog("Failed to send chunk", remoteId, chunk.index);
            }
          };

          sendNextChunk();
          return true;
        }
      } catch (err) {
        dlog("sendEfficientData error", remoteId, String(err));
        return false;
      }
    },
    [sendJSON, dlog]
  );

  const isHierarchyAllowed = useCallback((localUser, remoteUser) => {
    if (!localUser || !remoteUser) return true;
    const pair = [localUser.role, remoteUser.role].sort().join("-");
    return pair === "admin-supervisor" || pair === "mantenedor-supervisor";
  }, []);

  const canSendOrdersTo = useCallback(
    (remoteHello) => {
      const me = authUserRef.current;
      if (!me) return false;
      if (!remoteHello?.auth) return false;
      return isHierarchyAllowed(me, remoteHello.user);
    },
    [isHierarchyAllowed]
  );

  const sendHelloToPeer = useCallback(
    async (remoteId) => {
      if (!peerId) return false;
      const me = authUserRef.current
        ? {
            code: authUserRef.current.code,
            role: authUserRef.current.role,
            speciality: authUserRef.current.speciality ?? null,
            name: authUserRef.current.name,
          }
        : null;
      const usersMeta = await getUsersMeta();
      const ordersMeta = await getOrdersMeta();
      return sendJSON(remoteId, {
        type: "hello",
        from: peerId,
        auth: !!authUserRef.current,
        user: me,
        ts: Date.now(),
        version: usersMeta?.version || 0,
        ordersVersion: ordersMeta?.version || 0,
      });
    },
    [peerId, sendJSON]
  );

  const sendUsersSnapshotToPeer = useCallback(
    async (remoteId) => {
      if (!authUserRef.current) {
        dlog("omit usersSnapshot", remoteId, "sin auth local");
        return false;
      }
      try {
        const snap = await getUsersSnapshot();
        return sendEfficientData(remoteId, snap, "usersSnapshot", {
          fromAuth: true,
        });
      } catch (err) {
        dlog("usersSnapshot error", String(err));
        return false;
      }
    },
    [dlog, sendEfficientData]
  );

  const sendOrdersSnapshotToPeer = useCallback(
    async (remoteId, speciality) => {
      if (!authUserRef.current) return false;
      try {
        const snap = await getOrdersSnapshotForSpeciality(speciality);
        return sendEfficientData(remoteId, snap, "ordersSnapshot", {
          fromAuth: true,
          speciality,
        });
      } catch (err) {
        dlog("ordersSnapshot error", String(err));
        return false;
      }
    },
    [dlog, sendEfficientData]
  );

  useEffect(() => {
    requestIceServers();
  }, [requestIceServers]);

  const broadcastSync = useCallback(async () => {
    try {
      const me = authUserRef.current;
      if (!me) return;
      const ids = Object.keys(connectionsRef.current || {});
      if (!ids.length) return;

      // Batch fetch data once for all peers
      const [usersSnap, ordersMeta] = await Promise.all([
        getUsersSnapshot(),
        getOrdersMeta(),
      ]);

      const localUsersVersion = usersSnap.meta?.version || 0;
      const localOrdersVersion = ordersMeta?.version || 0;

      // Send to all peers efficiently
      ids.forEach((remoteId) => {
        const remoteInfo = remoteInfoRef.current?.[remoteId] || {};
        const remoteUsersVersion = remoteInfo.version || 0;
        const remoteOrdersVersion = remoteInfo.ordersVersion || 0;

        // Send users snapshot if needed
        if (localUsersVersion > remoteUsersVersion) {
          sendEfficientData(remoteId, usersSnap, "usersSnapshot", {
            fromAuth: true,
          });
        }

        // Send orders if hierarchy allows and version is newer
        const remoteHello = remoteInfo.hello || null;
        if (
          remoteHello?.auth &&
          isHierarchyAllowed(me, remoteHello.user) &&
          localOrdersVersion > remoteOrdersVersion
        ) {
          if (remoteHello.user?.role === "mantenedor") {
            // TODO: revisar envio de ordenes a mantenedores
            // Send only assigned orders to maintainers
            getOrdersSnapshotForUser(remoteHello.user.code)
              .then((ordersSnap) => {
                sendEfficientData(remoteId, ordersSnap, "ordersSnapshot", {
                  fromAuth: true,
                  userCode: remoteHello.user.code,
                });
              })
              .catch((err) => dlog("broadcastSync orders error", String(err)));
          } else {
            // Send all orders of speciality to supervisors/admins
            const specialityToSend =
              remoteHello.user?.speciality ?? me.speciality ?? null;
            getOrdersSnapshotForSpeciality(specialityToSend)
              .then((ordersSnap) => {
                sendEfficientData(remoteId, ordersSnap, "ordersSnapshot", {
                  fromAuth: true,
                  speciality: specialityToSend,
                });
              })
              .catch((err) => dlog("broadcastSync orders error", String(err)));
          }
        }
      });
    } catch (err) {
      dlog("broadcastSync error", String(err));
    }
  }, []);

  const requestUsersSnapshot = useCallback(() => {
    Object.keys(connectionsRef.current || {}).forEach((remoteId) => {
      const ok = sendJSON(remoteId, { type: "requestUsersSnapshot" });
      if (!ok) {
        dlog("request users snapshot fallo", remoteId);
      }
    });
  }, [dlog, sendJSON]);

  const cleanupConnection = useCallback(
    (remoteId, { requeue = true } = {}) => {
      const conn = connectionsRef.current[remoteId];
      if (!conn) return;
      try {
        conn.dc?.close?.();
      } catch {}
      try {
        conn.pc?.close?.();
      } catch {}
      if (conn.pingTimer) clearInterval(conn.pingTimer);
      if (conn.flushScheduled) {
        clearTimeout(conn.flushScheduled);
        conn.flushScheduled = null;
      }
      if (conn.dc && conn.bufferedLowHandler) {
        try {
          if (typeof conn.dc.removeEventListener === "function") {
            conn.dc.removeEventListener(
              "bufferedamountlow",
              conn.bufferedLowHandler
            );
          } else if (conn.dc.onbufferedamountlow === conn.bufferedLowHandler) {
            conn.dc.onbufferedamountlow = null;
          }
        } catch {}
      }
      delete connectionsRef.current[remoteId];
      setConnectedPeerIds((prev) => prev.filter((id) => id !== remoteId));
      setPeerRTT((prev) => {
        const { [remoteId]: _omit, ...rest } = prev;
        return rest;
      });
      delete remoteInfoRef.current[remoteId];
      delete accumulatingOrdersRef.current[`${remoteId}-1`];
      delete accumulatingOrdersRef.current[`${remoteId}-2`];
      Object.keys(accumulatingChunksRef.current).forEach((key) => {
        if (key.startsWith(`${remoteId}-`)) {
          delete accumulatingChunksRef.current[key];
        }
      });
      if (requeue) {
        enqueueReconnect(remoteId);
      }
    },
    [enqueueReconnect]
  );

  const setupDataChannel = useCallback(
    (remoteId, dc) => {
      const previous = connectionsRef.current[remoteId];
      if (previous?.dc && previous.bufferedLowHandler) {
        try {
          if (typeof previous.dc.removeEventListener === "function") {
            previous.dc.removeEventListener(
              "bufferedamountlow",
              previous.bufferedLowHandler
            );
          } else if (
            previous.dc.onbufferedamountlow === previous.bufferedLowHandler
          ) {
            previous.dc.onbufferedamountlow = null;
          }
        } catch {}
      }

      const conn = {
        ...(previous || {
          pc: null,
          dc: null,
          pingTimer: null,
          pendingCandidates: [],
          queue: [],
          bufferedLowHandler: null,
          flushScheduled: null,
        }),
        dc,
      };

      if (!Array.isArray(conn.queue)) {
        conn.queue = [];
      }

      connectionsRef.current[remoteId] = conn;

      const handler = conn.bufferedLowHandler || (() => flushQueue(remoteId));
      conn.bufferedLowHandler = handler;
      if (typeof dc.addEventListener === "function") {
        dc.addEventListener("bufferedamountlow", handler);
      } else {
        dc.onbufferedamountlow = handler;
      }
      if (typeof dc.bufferedAmountLowThreshold === "number") {
        dc.bufferedAmountLowThreshold = DC_BUFFER_LOW;
      }

      dc.onopen = () => {
        setConnectedPeerIds((prev) =>
          prev.includes(remoteId) ? prev : [...prev, remoteId]
        );
        attemptCountsRef.current[remoteId] = 0;
        sendHelloToPeer(remoteId).catch(() => {});
        if (connectionsRef.current[remoteId]) {
          if (connectionsRef.current[remoteId].pingTimer) {
            clearInterval(connectionsRef.current[remoteId].pingTimer);
          }
          connectionsRef.current[remoteId].pingTimer = setInterval(() => {
            if (dc.readyState !== "open") return;
            dc.send(JSON.stringify({ type: "ping", ts: performance.now() }));
          }, PING_INTERVAL_MS);
        }
        flushQueue(remoteId);
        if (authUserRef.current) {
          sendUsersSnapshotToPeer(remoteId).catch(() => {});
          // Removed broadcastSync to avoid sending all orders automatically
        } else {
          sendJSON(remoteId, { type: "requestUsersSnapshot" });
        }
      };

      dc.onclose = () => {
        cleanupConnection(remoteId);
      };

      dc.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ping") {
            dc.send(JSON.stringify({ type: "pong", ts: msg.ts }));
            return;
          }
          if (msg.type === "pong") {
            const rtt = Math.max(0, performance.now() - (msg.ts || 0));
            setPeerRTT((prev) => ({ ...prev, [remoteId]: Math.round(rtt) }));
            return;
          }
          if (msg.type === "hello") {
            remoteInfoRef.current = {
              ...remoteInfoRef.current,
              [remoteId]: {
                hello: msg,
                version: msg.version || 0,
                ordersVersion: msg.ordersVersion || 0,
              },
            };
            if (
              authUserRef.current &&
              msg?.auth &&
              !isHierarchyAllowed(authUserRef.current, msg.user)
            ) {
              dlog(
                "hierarchy bloqueada",
                remoteId,
                "roles:",
                authUserRef.current.role,
                "->",
                msg.user?.role
              );
              // Mark this peer as blocked to prevent reconnection attempts
              blockedPeersRef.current.add(remoteId);
              cleanupConnection(remoteId, { requeue: false });
              return;
            }

            // Version sync logic for authenticated peers
            if (
              authUserRef.current &&
              msg?.auth &&
              isHierarchyAllowed(authUserRef.current, msg.user)
            ) {
              // Compare orders versions and sync if needed
              getOrdersMeta()
                .then((localOrdersMeta) => {
                  const localOrdersVersion = localOrdersMeta?.version || 0;
                  const remoteOrdersVersion = msg.ordersVersion || 0;

                  dlog(
                    "Versiones órdenes",
                    remoteId,
                    "local:",
                    localOrdersVersion,
                    "remota:",
                    remoteOrdersVersion
                  );

                  if (remoteOrdersVersion > localOrdersVersion) {
                    // Remote has newer orders, request them
                    dlog("Solicitando órdenes más recientes de", remoteId);
                    const speciality =
                      msg.user?.speciality ??
                      authUserRef.current.speciality ??
                      null;
                    if (speciality != null) {
                      sendJSON(remoteId, {
                        type: "requestOrders",
                        speciality: speciality,
                      });
                    }
                  } else if (localOrdersVersion > remoteOrdersVersion) {
                    // Local has newer orders, send them
                    dlog("Enviando órdenes más recientes a", remoteId);
                    const specialityToSend =
                      msg.user?.speciality ??
                      authUserRef.current.speciality ??
                      null;
                    if (specialityToSend != null) {
                      sendOrdersSnapshotToPeer(
                        remoteId,
                        specialityToSend
                      ).catch((err) =>
                        dlog(
                          "Error enviando órdenes en sync",
                          remoteId,
                          String(err)
                        )
                      );
                    }
                  } else {
                    dlog("Versiones de órdenes sincronizadas con", remoteId);
                  }
                })
                .catch((err) =>
                  dlog("Error obteniendo meta órdenes local", String(err))
                );
            }

            return;
          }
          if (msg.type === "dataChunk") {
            // Handle efficient chunked data
            const payload = msg.payload || {};
            const metadata = payload.metadata || {};
            const chunkKey = buildChunkKey(
              remoteId,
              payload.originalType,
              metadata
            );
            const remoteHello =
              remoteInfoRef.current?.[remoteId]?.hello || null;
            const authorized = remoteHello?.auth || metadata.fromAuth;

            if (!authorized) {
              dlog("dataChunk rechazado", remoteId);
              return;
            }

            if (!accumulatingChunksRef.current[chunkKey]) {
              accumulatingChunksRef.current[chunkKey] = {
                chunks: [],
                total: payload.total,
                compressed: payload.compressed,
                originalType: payload.originalType,
                metadata,
              };
            }

            const accumulator = accumulatingChunksRef.current[chunkKey];
            accumulator.chunks[payload.index] = payload.compressed
              ? decodeBinaryChunk(payload.data)
              : payload.data;

            // Check if all chunks received
            if (
              accumulator.chunks.filter((c) => c !== undefined).length ===
              accumulator.total
            ) {
              try {
                const reassembled = reassembleChunks(accumulator.chunks);
                const finalData = decompressPayload(
                  reassembled,
                  accumulator.compressed
                );

                // Process based on original type
                if (accumulator.originalType === "usersSnapshot") {
                  applyUsersSnapshot(finalData)
                    .then((res) => {
                      dlog(
                        "applyUsersSnapshot efficient",
                        remoteId,
                        res?.applied ? "applied" : res?.reason
                      );
                    })
                    .catch((err) =>
                      dlog("applyUsersSnapshot efficient error", String(err))
                    );
                } else if (accumulator.originalType === "ordersSnapshot") {
                  applyOrdersSnapshot(finalData, accumulator.metadata || {})
                    .then((res) => {
                      dlog(
                        "applyOrdersSnapshot efficient",
                        remoteId,
                        res?.applied ? "applied" : res?.reason
                      );
                      if (res?.applied) {
                        remoteInfoRef.current[remoteId] = {
                          ...(remoteInfoRef.current[remoteId] || {}),
                          ordersVersion: finalData.meta?.version || 0,
                        };
                      }
                    })
                    .catch((err) =>
                      dlog("applyOrdersSnapshot efficient error", String(err))
                    );
                }

                delete accumulatingChunksRef.current[chunkKey];
              } catch (err) {
                dlog("chunk assembly error", remoteId, String(err));
                delete accumulatingChunksRef.current[chunkKey];
              }
            }
            return;
          }
          if (msg.type === "usersSnapshot") {
            const remoteHello =
              remoteInfoRef.current?.[remoteId]?.hello || null;
            const authorized = remoteHello?.auth || msg?.fromAuth;
            if (!authorized) {
              dlog("usersSnapshot rechazado", remoteId);
              return;
            }

            let payload = msg.payload;
            // Handle compressed single message
            if (payload?.compressed) {
              try {
                payload = decompressPayload(
                  decodeBinaryChunk(payload.data),
                  true
                );
              } catch (err) {
                dlog("decompress usersSnapshot error", String(err));
                return;
              }
            }

            applyUsersSnapshot(payload || {})
              .then((res) => {
                dlog(
                  "applyUsersSnapshot",
                  remoteId,
                  res?.applied ? "applied" : res?.reason
                );
              })
              .catch((err) => dlog("applyUsersSnapshot error", String(err)));
            return;
          }
          if (msg.type === "ordersChunk") {
            // Legacy chunking - keep for backward compatibility
            const remoteHello =
              remoteInfoRef.current?.[remoteId]?.hello || null;
            const authorized = remoteHello?.auth || msg?.fromAuth;
            if (!authorized) return;
            const scopeKey =
              msg?.userCode != null
                ? `user-${msg.userCode}`
                : msg?.speciality != null
                ? `spec-${msg.speciality}`
                : "all";
            const key = `${remoteId}-${scopeKey}`;
            const payload = msg.payload || {};
            if (!accumulatingOrdersRef.current[key]) {
              accumulatingOrdersRef.current[key] = {
                meta: payload.meta,
                orders: [],
                total: payload.total ?? 0,
                context: {
                  speciality: msg.speciality,
                  userCode: msg.userCode,
                },
              };
            }
            const bucket = accumulatingOrdersRef.current[key];
            const incomingOrders = payload.orders || [];
            bucket.orders.push(...incomingOrders);
            const expectedTotal =
              Number.isFinite(payload.total) && payload.total > 0
                ? payload.total
                : bucket.total || bucket.orders.length;
            bucket.total = expectedTotal;
            if (bucket.orders.length >= expectedTotal) {
              const assembled = {
                meta: bucket.meta,
                orders: bucket.orders,
              };
              applyOrdersSnapshot(assembled, bucket.context || {})
                .then((res) => {
                  dlog(
                    "applyOrdersSnapshot chunks",
                    remoteId,
                    res?.applied ? "applied" : res?.reason
                  );
                  if (res?.applied) {
                    remoteInfoRef.current[remoteId] = {
                      ...(remoteInfoRef.current[remoteId] || {}),
                      ordersVersion: assembled.meta?.version || 0,
                    };
                  }
                })
                .catch((err) =>
                  dlog("applyOrdersSnapshot chunk error", String(err))
                );
              delete accumulatingOrdersRef.current[key];
            }
            return;
          }
          if (msg.type === "ordersSnapshot") {
            const remoteHello =
              remoteInfoRef.current?.[remoteId]?.hello || null;
            const authorized = remoteHello?.auth || msg?.fromAuth;
            if (!authorized) return;

            let payload = msg.payload;
            // Handle compressed single message
            if (payload?.compressed) {
              try {
                payload = decompressPayload(
                  decodeBinaryChunk(payload.data),
                  true
                );
              } catch (err) {
                dlog("decompress ordersSnapshot error", String(err));
                return;
              }
            }

            applyOrdersSnapshot(payload || {}, {
              speciality: msg.speciality,
              userCode: msg.userCode,
            })
              .then((res) => {
                dlog(
                  "applyOrdersSnapshot direct",
                  remoteId,
                  res?.applied ? "applied" : res?.reason
                );
                if (res?.applied) {
                  remoteInfoRef.current[remoteId] = {
                    ...(remoteInfoRef.current[remoteId] || {}),
                    ordersVersion: payload?.meta?.version || 0,
                  };
                }
              })
              .catch((err) =>
                dlog("applyOrdersSnapshot direct error", String(err))
              );
            return;
          }
          if (msg.type === "requestUsersSnapshot") {
            if (authUserRef.current) {
              sendUsersSnapshotToPeer(remoteId).catch(() => {});
            } else {
              pendingUsersRequestsRef.current.add(remoteId);
            }
            return;
          }
          if (msg.type === "requestOrders") {
            const remoteHello =
              remoteInfoRef.current?.[remoteId]?.hello || null;
            if (msg.speciality != null && canSendOrdersTo(remoteHello)) {
              sendOrdersSnapshotToPeer(remoteId, msg.speciality).catch(
                () => {}
              );
            }
            return;
          }
        } catch (err) {
          dlog("Mensaje no procesado", remoteId, String(err));
        }
      };
    },
    [
      canSendOrdersTo,
      cleanupConnection,
      dlog,
      DC_BUFFER_LOW,
      PING_INTERVAL_MS,
      isHierarchyAllowed,
      flushQueue,
      sendHelloToPeer,
      sendJSON,
      sendOrdersSnapshotToPeer,
      sendUsersSnapshotToPeer,
    ]
  );

  const ensurePeerConnection = useCallback(
    (remoteId) => {
      const previous = connectionsRef.current[remoteId];
      if (previous?.pc) return previous;
      if (!ICE_SERVERS.length) {
        requestIceServers();
      }
      const iceServers = getIceServersForRemote(remoteId);
      const pc = new RTCPeerConnection({ iceServers });
      const conn = {
        pc,
        dc: previous?.dc ?? null,
        pingTimer: previous?.pingTimer ?? null,
        pendingCandidates: [],
        queue: Array.isArray(previous?.queue) ? previous.queue : [],
        bufferedLowHandler: previous?.bufferedLowHandler ?? null,
        flushScheduled: previous?.flushScheduled ?? null,
        iceMode:
          connectionIceModeRef.current.get(remoteId) === "turn-only"
            ? "turn-only"
            : "default",
      };
      connectionsRef.current[remoteId] = conn;

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const iceRef = push(ref(db, `signals/${remoteId}`));
        set(iceRef, { from: peerId, candidate: event.candidate.toJSON?.() })
          .then(() => dlog("ICE local", remoteId))
          .catch((err) => dlog("ICE local error", String(err)));
      };

      pc.onconnectionstatechange = () => {
        dlog("pc state", remoteId, pc.connectionState);
        if (pc.connectionState === "failed") {
          const changed = markRemoteForTurnOnly(remoteId, "connection-state");
          if (changed) {
            const prevMode = conn.iceMode || "default";
            conn.iceMode = "turn-only";
            dlog(
              "Reconectando peer con modo TURN",
              remoteId,
              prevMode,
              "-> turn-only"
            );
          }
        }
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          cleanupConnection(remoteId);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          const changed = markRemoteForTurnOnly(
            remoteId,
            "ice-connection-failed"
          );
          if (changed) {
            const prevMode = conn.iceMode || "default";
            conn.iceMode = "turn-only";
            dlog(
              "Fallo ICE, forzando TURN para peer",
              remoteId,
              prevMode,
              "-> turn-only"
            );
          }
        }
        if (pc.iceConnectionState === "disconnected") {
          setTimeout(() => {
            if (pc.iceConnectionState === "disconnected") {
              cleanupConnection(remoteId);
            }
          }, 3000);
        }
      };

      pc.ondatachannel = (event) => {
        if (event.channel?.label === "dataChannel") {
          setupDataChannel(remoteId, event.channel);
        }
      };

      const dc = pc.createDataChannel("dataChannel");
      setupDataChannel(remoteId, dc);
      return conn;
    },
    [
      cleanupConnection,
      dlog,
      getIceServersForRemote,
      ICE_SERVERS,
      markRemoteForTurnOnly,
      requestIceServers,
      peerId,
      setupDataChannel,
    ]
  );

  const connectToPeer = useCallback(
    async (remoteId) => {
      if (!peerId) return;
      if (!isOnlineRef.current) {
        pendingConnectSetRef.current.add(remoteId);
        return;
      }
      if (!ICE_SERVERS.length) {
        dlog("Sin ICE servers de Metered todavía, reintentando", remoteId);
        requestIceServers();
        pendingConnectSetRef.current.add(remoteId);
        return;
      }
      if (connectionsRef.current[remoteId]?.pc) return;

      // Check if this peer is blocked due to hierarchy rules
      if (blockedPeersRef.current.has(remoteId)) {
        dlog("Conexión bloqueada por jerarquía", remoteId);
        return;
      }

      attemptCountsRef.current[remoteId] =
        (attemptCountsRef.current[remoteId] || 0) + 1;
      const { pc } = ensurePeerConnection(remoteId);
      try {
        makingOfferRef.current[remoteId] = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const offerRef = push(ref(db, `signals/${remoteId}`));
        await set(offerRef, { from: peerId, sdp: offer });
        dlog("offer enviada", remoteId);
      } finally {
        makingOfferRef.current[remoteId] = false;
      }
    },
    [ICE_SERVERS, dlog, ensurePeerConnection, peerId, requestIceServers]
  );

  const connectToPeerRef = useRef();
  connectToPeerRef.current = connectToPeer;

  const scheduleConnect = useCallback(
    (remoteId) => {
      if (!remoteId) return;
      if (!isOnlineRef.current) {
        enqueueReconnect(remoteId);
        return;
      }
      if (connectTimersRef.current[remoteId]) return;
      if (connectionsRef.current[remoteId]) return;

      if (blockedPeersRef.current.has(remoteId)) {
        return;
      }

      pendingConnectSetRef.current.delete(remoteId);
      const delayMs = Math.floor(Math.random() * (BACKOFF_MAX + 1));
      connectTimersRef.current[remoteId] = setTimeout(() => {
        connectToPeerRef.current(remoteId);
        delete connectTimersRef.current[remoteId];
      }, delayMs);
    },
    [BACKOFF_MAX, enqueueReconnect]
  );

  scheduleConnectRef.current = scheduleConnect;

  const setAuthUserStable = useCallback(
    (nextUser) => {
      const prev = authUserRef.current;
      const same =
        !!prev === !!nextUser &&
        (!nextUser ||
          (prev &&
            prev.code === nextUser.code &&
            prev.role === nextUser.role &&
            prev.speciality === nextUser.speciality &&
            prev.name === nextUser.name));
      if (same) return;

      // TODO: cambiar guest por rol
      if (!same && prev?.role !== nextUser?.role) {
        dlog(
          "Usuario cambió de rol, limpiando peers bloqueados",
          prev?.role,
          "->",
          nextUser?.role
        );
        blockedPeersRef.current.clear();
      }

      authUserRef.current = nextUser || null;
      if (selfDbRefRef.current) {
        update(selfDbRefRef.current, {
          role: nextUser?.role ?? null,
          code: nextUser?.code ?? null,
          speciality: nextUser?.speciality ?? null,
          updatedAt: Date.now(),
        }).catch(() => {});
      }
      Object.keys(connectionsRef.current || {}).forEach((remoteId) => {
        sendHelloToPeer(remoteId).catch(() => {});
      });
      if (nextUser) {
        const pending = Array.from(pendingUsersRequestsRef.current);
        pendingUsersRequestsRef.current.clear();
        pending.forEach((remoteId) => {
          sendUsersSnapshotToPeer(remoteId).catch(() => {});
        });
      }
    },
    [sendHelloToPeer, sendUsersSnapshotToPeer, dlog]
  );

  useEffect(() => {
    let baseId = localStorage.getItem("peerBaseId");
    if (!baseId) {
      baseId = `guest-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      localStorage.setItem("peerBaseId", baseId);
    }
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
      baseId,
      status: "online",
      role: null,
      code: null,
      speciality: null,
      updatedAt: Date.now(),
    }).catch(() => {});
    try {
      onDisconnect(selfRef).remove();
    } catch {}

    const handleBeforeUnload = () => {
      remove(selfRef).catch(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const peersRef = ref(db, "peers");
    const unsub = onValue(peersRef, (snapshot) => {
      const data = snapshot.val() || {};
      const others = Object.keys(data).filter((key) => key !== id);
      setPeers(others);
      peersSetRef.current = new Set(others);
      others.forEach((remoteId) => previousPeersRef.current.add(remoteId));
    });

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      try {
        unsub();
      } catch {}
      remove(selfRef).catch(() => {});
    };
  }, []);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      Array.from(pendingConnectSetRef.current).forEach((remoteId) => {
        if (!connectionsRef.current[remoteId]) {
          scheduleConnect(remoteId);
        }
      });
      pendingConnectSetRef.current.clear();
    };
    const handleOffline = () => {
      setIsOnline(false);
      Object.values(connectTimersRef.current).forEach((timer) => {
        clearTimeout(timer);
      });
      connectTimersRef.current = {};
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [scheduleConnect]);

  useEffect(() => {
    if (!peerId) return;
    const signalsRef = ref(db, `signals/${peerId}`);
    const callback = onChildAdded(signalsRef, async (snapshot) => {
      const data = snapshot.val();
      const from = data?.from;
      if (!from || from === peerId) {
        await remove(snapshot.ref);
        return;
      }

      // Skip processing if peer is blocked
      if (blockedPeersRef.current.has(from)) {
        await remove(snapshot.ref);
        return;
      }

      const conn = ensurePeerConnection(from);
      const pc = conn.pc;
      try {
        if (data.sdp) {
          const { sdp } = data;
          if (sdp.type === "offer") {
            if (politeRef.current[from] == null) {
              politeRef.current[from] = peerId > from;
            }
            const polite = politeRef.current[from];
            const isMakingOffer = !!makingOfferRef.current[from];
            const isStable = pc.signalingState === "stable";
            const ignoreOffer = !polite && (isMakingOffer || !isStable);
            if (ignoreOffer) {
              await remove(snapshot.ref);
              return;
            }
            if (!isStable) {
              try {
                await pc.setLocalDescription({ type: "rollback" });
              } catch {}
            }
            let remoteSet = true;
            try {
              await pc.setRemoteDescription(sdp);
            } catch (err) {
              remoteSet = false;
              dlog("remote offer error", from, String(err));
            }
            if (!remoteSet) {
              return;
            }
            if (conn.pendingCandidates?.length) {
              const pending = [...conn.pendingCandidates];
              conn.pendingCandidates = [];
              for (const candidate of pending) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                  dlog("ICE diferido error", String(err));
                }
              }
            }
            const stateAfterOffer = pc.signalingState;
            if (stateAfterOffer !== "have-remote-offer") {
              dlog("omitir answer", from, "estado", stateAfterOffer);
              return;
            }
            let answer;
            try {
              answer = await pc.createAnswer();
            } catch (err) {
              dlog("createAnswer error", from, String(err));
              return;
            }
            try {
              await pc.setLocalDescription(answer);
            } catch (err) {
              dlog("setLocalDescription answer error", from, String(err));
              return;
            }
            const answerRef = push(ref(db, `signals/${from}`));
            await set(answerRef, { from: peerId, sdp: answer });
          } else if (sdp.type === "answer") {
            const stateBeforeAnswer = pc.signalingState;
            if (stateBeforeAnswer !== "have-local-offer") {
              dlog("ignorar answer", from, "estado", stateBeforeAnswer);
              await remove(snapshot.ref);
              return;
            }
            try {
              await pc.setRemoteDescription(sdp);
            } catch (err) {
              dlog("remote answer error", from, String(err));
              return;
            }
            if (conn.pendingCandidates?.length) {
              const pending = [...conn.pendingCandidates];
              conn.pendingCandidates = [];
              for (const candidate of pending) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                  dlog("ICE diferido error", String(err));
                }
              }
            }
          }
        } else if (data.candidate) {
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
              dlog("ICE candidate error", from, String(err));
            }
          } else {
            conn.pendingCandidates.push(data.candidate);
          }
        }
      } finally {
        await remove(snapshot.ref);
      }
    });
    signalsListenerRef.current = { ref: signalsRef, callback };
    return () => {
      if (signalsListenerRef.current) {
        const { ref: refToOff, callback: cb } = signalsListenerRef.current;
        off(refToOff, "child_added", cb);
      }
    };
  }, [peerId]); // Only depend on peerId to prevent re-creation

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || null;
      setAuthUserStable(detail);
    };
    window.addEventListener("auth:user-changed", handler);
    return () => {
      window.removeEventListener("auth:user-changed", handler);
    };
  }, [setAuthUserStable]);

  useEffect(() => {
    const handleUsersChanged = (event) => {
      const reason = event?.detail?.reason;
      if (!authUserRef.current || reason === "snapshot-applied") return;
      broadcastSync().catch(() => {});
    };
    window.addEventListener("users:changed", handleUsersChanged);
    let bc;
    try {
      if ("BroadcastChannel" in self) {
        bc = new BroadcastChannel("wt-users-changes");
        bc.onmessage = (evt) => {
          if (evt?.data?.type === "users:changed") {
            handleUsersChanged({ detail: { reason: evt.data.reason } });
          }
        };
      }
    } catch {}
    return () => {
      window.removeEventListener("users:changed", handleUsersChanged);
      if (bc) {
        bc.onmessage = null;
        bc.close();
      }
    };
  }, [broadcastSync]);

  useEffect(() => {
    const handleOrdersChanged = (event) => {
      const reason = event?.detail?.reason;
      if (!authUserRef.current || reason === "snapshot-applied") return;
      // Call broadcastSync to send orders to connected peers when local orders change
      broadcastSync().catch((err) =>
        dlog("broadcastSync on orders changed error", String(err))
      );
    };
    window.addEventListener("orders:changed", handleOrdersChanged);
    let bc;
    try {
      if ("BroadcastChannel" in self) {
        bc = new BroadcastChannel("wt-orders-changes");
        bc.onmessage = (evt) => {
          if (evt?.data?.type === "orders:changed") {
            handleOrdersChanged({ detail: { reason: evt.data.reason } });
          }
        };
      }
    } catch {}
    return () => {
      window.removeEventListener("orders:changed", handleOrdersChanged);
      if (bc) {
        bc.onmessage = null;
        bc.close();
      }
    };
  }, [broadcastSync, dlog]);

  useEffect(() => {
    // Only schedule connections for new peers
    const newPeers = peers.filter(
      (peerId) => !previousPeersRef.current.has(peerId)
    );
    newPeers.forEach((remoteId) => {
      if (!blockedPeersRef.current.has(remoteId)) {
        scheduleConnect(remoteId);
      }
    });
    // Update previous peers
    previousPeersRef.current = new Set(peers);
  }, [peers, scheduleConnect]); // Include scheduleConnect in dependencies

  const sendOrdersToUser = useCallback(
    async (userCode) => {
      if (!authUserRef.current) return false;
      const remoteIds = Object.keys(remoteInfoRef.current || {});
      for (const remoteId of remoteIds) {
        const remoteHello = remoteInfoRef.current[remoteId]?.hello;
        if (remoteHello?.user?.code === userCode) {
          try {
            const snap = await getOrdersSnapshotForUser(userCode);
            return sendEfficientData(remoteId, snap, "ordersSnapshot", {
              fromAuth: true,
              userCode,
            });
          } catch (err) {
            dlog("sendOrdersToUser error", String(err));
            return false;
          }
        }
      }
      dlog("No se encontró peer para usuario", userCode);
      return false;
    },
    [dlog, sendEfficientData]
  );

  const unblockPeer = useCallback(
    (remoteId) => {
      if (blockedPeersRef.current.has(remoteId)) {
        dlog("Desbloqueando peer", remoteId);
        blockedPeersRef.current.delete(remoteId);
        return true;
      }
      return false;
    },
    [dlog]
  );

  const clearBlockedPeers = useCallback(() => {
    const count = blockedPeersRef.current.size;
    dlog("Limpiando todos los peers bloqueados", count);
    blockedPeersRef.current.clear();
    return count;
  }, [dlog]);

  const refreshStoragePersistence = useCallback(
    async ({ force = true } = {}) => {
      try {
        const status = await ensurePersistentStorage({ force });
        if (mountedRef.current) {
          setStoragePersistence({ ...status });
        }
        return status;
      } catch (error) {
        const fallback = {
          supported: false,
          persisted: false,
          reason: "error",
          error,
        };
        if (mountedRef.current) {
          setStoragePersistence(fallback);
        }
        return fallback;
      }
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    refreshStoragePersistence({ force: false }).catch(() => {
      /* handled in refresh */
    });
    return () => {
      mountedRef.current = false;
    };
  }, [refreshStoragePersistence]);

  const value = useMemo(
    () => ({
      ICE_SERVERS,
      BACKOFF_MAX,
      PING_INTERVAL_MS,
      CHUNK_SIZE,
      CHUNK_DELAY_MS,
      peerId,
      isOnline,
      peers,
      connectedPeerIds,
      peerRTT,
      debugLog,
      debugOpen,
      connectToPeer,
      scheduleConnect,
      cleanupConnection,
      setDebugLog,
      openDebug: () => setDebugOpen(true),
      closeDebug: () => setDebugOpen(false),
      toggleDebug: () => setDebugOpen((prev) => !prev),
      setAuthUser: setAuthUserStable,
      broadcastSync,
      requestUsersSnapshot,
      sendOrdersToUser,
      unblockPeer,
      clearBlockedPeers,
      storagePersistence,
      refreshStoragePersistence,
      dlog, // Expose debug logger for manual debugging
    }),
    [
      ICE_SERVERS,
      BACKOFF_MAX,
      PING_INTERVAL_MS,
      CHUNK_SIZE,
      CHUNK_DELAY_MS,
      peerId,
      isOnline,
      peers,
      connectedPeerIds,
      peerRTT,
      debugLog,
      debugOpen,
      connectToPeer,
      scheduleConnect,
      cleanupConnection,
      setAuthUserStable,
      broadcastSync,
      requestUsersSnapshot,
      sendOrdersToUser,
      unblockPeer,
      clearBlockedPeers,
      storagePersistence,
      refreshStoragePersistence,
      dlog,
    ]
  );

  return <PeerContext.Provider value={value}>{children}</PeerContext.Provider>;
}

export function usePeer() {
  const context = useContext(PeerContext);
  if (!context) throw new Error("usePeer must be used within <PeerProvider>");
  return context;
}

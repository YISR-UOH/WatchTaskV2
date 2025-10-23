import { useCallback, useMemo, useRef, useState } from "react";

export function useIceServerManager({ apiUrl, apiKey, dlog, mountedRef }) {
  const iceServersHashRef = useRef("[]");
  const [iceServers, setIceServers] = useState([]);
  const fetchInFlightRef = useRef(false);

  const applyIceServers = useCallback(
    (servers) => {
      if (!mountedRef?.current) return false;
      const sanitized = Array.isArray(servers)
        ? servers
            .map((server) => {
              if (!server) return null;
              const urls = server.urls;
              if (!urls || (Array.isArray(urls) && urls.length === 0)) {
                return null;
              }
              const entry = { urls };
              if (server.username) entry.username = server.username;
              if (server.credential || server.password)
                entry.credential = server.credential || server.password;
              if (server.ttl) entry.ttl = server.ttl;
              return entry;
            })
            .filter(Boolean)
        : [];

      if (!sanitized.length) return false;

      const serialized = JSON.stringify(sanitized);
      if (serialized === iceServersHashRef.current) {
        return false;
      }

      iceServersHashRef.current = serialized;
      setIceServers(sanitized);
      return true;
    },
    [mountedRef]
  );

  const fetchIceServers = useCallback(async () => {
    if (!apiUrl) return [];
    if (typeof fetch !== "function") {
      dlog?.("fetch ICE servers no disponible en este entorno");
      return [];
    }
    try {
      const endpoint = new URL(apiUrl);
      if (apiKey && !endpoint.searchParams.has("apiKey")) {
        endpoint.searchParams.set("apiKey", apiKey);
      }
      const response = await fetch(endpoint.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const servers = Array.isArray(data)
        ? data
        : Array.isArray(data?.iceServers)
        ? data.iceServers
        : [];
      applyIceServers(servers);
      return servers;
    } catch (error) {
      dlog?.("fetch ICE servers error", String(error));
      return [];
    }
  }, [apiKey, apiUrl, applyIceServers, dlog]);

  const requestIceServers = useCallback(() => {
    if (!apiUrl) return;
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    fetchIceServers()
      .catch(() => {
        /* error already logged */
      })
      .finally(() => {
        fetchInFlightRef.current = false;
      });
  }, [apiUrl, fetchIceServers]);

  const turnOnlyServers = useMemo(() => {
    if (!iceServers.length) return [];
    const onlyTurn = iceServers.filter((entry) => {
      const urls = Array.isArray(entry.urls)
        ? entry.urls.join(" ").toLowerCase()
        : String(entry.urls || "").toLowerCase();
      return urls.includes("turn");
    });
    return onlyTurn.length ? onlyTurn : iceServers;
  }, [iceServers]);

  return {
    iceServers,
    turnOnlyServers,
    requestIceServers,
    fetchIceServers,
    applyIceServers,
  };
}

// src/components/PeerManager.jsx
import { useEffect, useRef, useState } from "react";
import { db } from "@/utils/firebaseConfig";
import { ref, set, onValue, remove, push } from "firebase/database";

export default function PeerManager() {
  const [peerId, setPeerId] = useState(null);
  const [peers, setPeers] = useState([]);
  const [peerConnections, setPeerConnections] = useState({});
  const connectionsRef = useRef({});
  const localConnection = useRef(null);

  useEffect(() => {
    const id = `guest-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setPeerId(id);

    // Registrar peer en Firebase
    const peerRef = ref(db, `peers/${id}`);
    set(peerRef, { id });

    // Limpiar cuando el usuario se desconecta
    window.addEventListener("beforeunload", () => remove(peerRef));

    // Escuchar nuevos peers
    const peersRef = ref(db, "peers");
    onValue(peersRef, (snapshot) => {
      const data = snapshot.val() || {};
      const others = Object.keys(data).filter((key) => key !== id);
      setPeers(others);
    });
  }, []);

  // Función para iniciar conexión con un peer
  const connectToPeer = async (remoteId) => {
    if (connectionsRef.current[remoteId]) return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // Manejar ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const iceRef = push(ref(db, `signals/${remoteId}`));
        set(iceRef, { from: peerId, candidate: event.candidate });
      }
    };

    // Data channel para enviar datos
    const dc = pc.createDataChannel("dataChannel");
    dc.onmessage = (msg) => console.log("Mensaje recibido:", msg.data);
    dc.onopen = () => console.log("Canal abierto con", remoteId);

    // Crear offer y enviarla por Firebase
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const offerRef = push(ref(db, `signals/${remoteId}`));
    set(offerRef, { from: peerId, sdp: offer });

    connectionsRef.current[remoteId] = pc;
  };

  // Conectar automáticamente a nuevos peers
  useEffect(() => {
    peers.forEach(connectToPeer);
    console.log("Conectando a peers:", peers);
    console.log("Peer ID:", peerId);
    console.log("Conexiones actuales:", connectionsRef);
  }, [peers]);

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Peer ID: {peerId}</h2>
      <h3 className="text-md font-medium mb-2">Peers:</h3>
      <ul className="list-disc list-inside">
        {peers.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

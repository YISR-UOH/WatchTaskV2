import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { ensurePersistentStorage } from "@/utils/APIdb";
import "@/style/style.css";
import App from "./App.jsx";

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true).catch((error) => {
      console.error(
        "No se pudo actualizar el Service Worker de WatchTask",
        error
      );
    });
  },
  onOfflineReady() {
    console.info("WatchTask está listo para funcionar sin conexión.");
  },
  onRegisterError(error) {
    console.error("Error al registrar el Service Worker de WatchTask", error);
  },
});

ensurePersistentStorage()
  .then(({ supported, persisted, reason }) => {
    if (!supported) {
      console.warn(
        "WatchTask: el navegador no soporta StorageManager.persist; se usará almacenamiento 'best-effort'."
      );
    } else if (persisted) {
      console.info(
        "WatchTask almacenará datos de IndexedDB como Persistent Storage."
      );
    } else {
      console.warn(
        `WatchTask: no se pudo obtener Persistent Storage (${reason}); el navegador podría purgar datos offline.`
      );
    }
  })
  .catch((error) => {
    console.error(
      "WatchTask: error al solicitar almacenamiento persistente.",
      error
    );
  });

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

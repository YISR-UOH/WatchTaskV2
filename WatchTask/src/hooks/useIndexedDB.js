// src/hooks/useIndexedDB.js
import { openDB } from "idb";

export async function initDB() {
  const db = await openDB("appDB", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("users")) {
        db.createObjectStore("users", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("privateData")) {
        db.createObjectStore("privateData", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    },
  });
  return db;
}

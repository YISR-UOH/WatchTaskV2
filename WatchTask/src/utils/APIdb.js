/**
 * @file APIdb.js
 * @description Dexie wrapper for IndexedDB.
 */
import Dexie from "dexie";
import {
  addChileDays,
  parseChileDateString,
  startOfChileDay,
} from "@/utils/timezone";

let persistentStoragePromise;
let persistentStorageStatus = {
  supported: false,
  persisted: false,
  reason: "unknown",
};

export function getPersistentStorageStatus() {
  return { ...persistentStorageStatus };
}

export async function ensurePersistentStorage({ force = false } = {}) {
  if (!force && persistentStorageStatus.persisted) {
    return { ...persistentStorageStatus };
  }
  if (!force && persistentStoragePromise) return persistentStoragePromise;

  const request = (async () => {
    if (typeof navigator === "undefined") {
      persistentStorageStatus = {
        supported: false,
        persisted: false,
        reason: "no-navigator",
      };
      return persistentStorageStatus;
    }

    const storage = navigator.storage;
    const hasPersist = typeof storage?.persist === "function";
    const hasPersisted = typeof storage?.persisted === "function";

    if (!storage || (!hasPersist && !hasPersisted)) {
      persistentStorageStatus = {
        supported: false,
        persisted: false,
        reason: "storage-api-missing",
      };
      return persistentStorageStatus;
    }

    try {
      const alreadyPersisted = hasPersisted ? await storage.persisted() : false;
      if (alreadyPersisted) {
        persistentStorageStatus = {
          supported: true,
          persisted: true,
          reason: "already-persisted",
        };
        return persistentStorageStatus;
      }

      if (!hasPersist) {
        persistentStorageStatus = {
          supported: true,
          persisted: false,
          reason: "persist-unsupported",
        };
        return persistentStorageStatus;
      }

      const granted = await storage.persist();
      persistentStorageStatus = {
        supported: true,
        persisted: granted === true,
        reason: granted ? "granted" : "denied",
      };
      if (!granted) {
        console.warn(
          "WatchTask: el navegador denegó la solicitud de almacenamiento persistente."
        );
      }
      return persistentStorageStatus;
    } catch (error) {
      console.warn(
        "WatchTask: no fue posible solicitar almacenamiento persistente.",
        error
      );
      persistentStorageStatus = {
        supported: hasPersist || hasPersisted,
        persisted: false,
        reason: "error",
        error,
      };
      return persistentStorageStatus;
    }
  })();

  persistentStoragePromise = request.finally(() => {
    if (!persistentStorageStatus.persisted || force) {
      persistentStoragePromise = null;
    }
  });

  return persistentStoragePromise;
}

// Singleton Dexie instance
export const db = new Dexie("WatchTaskDB");

// v1 and v2 existed previously with legacy stores. v3 consolidates to final spec
db.version(3)
  .stores({
    users: "&code, name, role, speciality, active",
    usersMeta: "&version",
    orders: "&code",
    ordersMeta: "&version",
    // drop legacy stores
    publicDB: null,
    publicDBMeta: null,
    publicUsersMeta: null,
    ordersByCode: null,
  })
  .upgrade(async (tx) => {
    // Ensure meta tables have an initial record
    if ((await tx.table("usersMeta").count()) === 0) {
      await tx.table("usersMeta").put({
        version: 1,
        changeLog: [`${new Date().toISOString()} - init users meta v1`],
      });
    }
    if ((await tx.table("ordersMeta").count()) === 0) {
      await tx.table("ordersMeta").put({
        version: 1,
        changeLog: [`${new Date().toISOString()} - init orders meta v1`],
      });
    }
    // Migrate existing orders (from legacy 'orders' or 'ordersByCode') to be keyed by 'code'
    try {
      const dest = tx.table("orders");
      const srcByCode = tx.table("ordersByCode");
      const srcLegacy = tx.table("orders"); // same name but previously &id; after schema bump, table persists
      let migrated = 0;
      if (await srcByCode?.count?.()) {
        const rows = await srcByCode.toArray();
        const putRows = rows
          .map((o) => (Number.isFinite(o.code) ? o : null))
          .filter(Boolean);
        if (putRows.length) await dest.bulkPut(putRows);
        migrated += putRows.length;
      } else if (await srcLegacy?.count?.()) {
        const rows = await srcLegacy.toArray();
        const putRows = rows
          .map((o) => {
            const vals = [
              o.code,
              o.id,
              o?.info?.["Numero orden"],
              o?.["Numero orden"],
              o?.Numero,
            ];
            for (const v of vals) {
              const n = Number.parseInt?.(String(v || "").trim(), 10);
              if (Number.isFinite(n)) return { ...o, code: n };
            }
            return null;
          })
          .filter(Boolean);
        if (putRows.length) await dest.bulkPut(putRows);
        migrated += putRows.length;
      }
      if (migrated > 0) {
        const meta = tx.table("ordersMeta");
        const latest = await meta.orderBy("version").last();
        const nextVer = latest ? latest.version + 1 : 1;
        const changeLog = latest?.changeLog ? [...latest.changeLog] : [];
        changeLog.push(
          `${new Date().toISOString()} - migrated orders to code PK (${migrated})`
        );
        await meta.put({ version: nextVer, changeLog });
      }
    } catch {}
  });

// Types and helpers
const toInt = (v) => {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : undefined;
};

const nowISO = () => new Date().toISOString();

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalizeUsersForSignature(users) {
  const sanitized = users
    .map((u) => {
      const { passwordHash: _ph, ...rest } = u;
      return rest;
    })
    .sort((a, b) => (a.code || 0) - (b.code || 0));
  return JSON.stringify(sanitized);
}

const calculateOrderStatus = (tasks) => {
  if (!Array.isArray(tasks)) return 0;
  const allCompleted = tasks.every((t) => Number(t.status) === 2);
  if (allCompleted) return 2;
  const hasInProgress = tasks.some(
    (t) => Number(t.status) === 1 || Number(t.status) === 2
  );
  if (hasInProgress) return 1;
  return 0;
};

const AUTO_EXPIRED_NOTE = "Anulada automaticamente por vencimiento";
const computeExpirationInfo = (orderInfo) => {
  if (!orderInfo) return null;
  const startRaw = orderInfo["F inicial"] ?? orderInfo["F_inicial"];
  const frequencyRaw = orderInfo["Frec. Dias"] ?? orderInfo["FrecDias"];

  const startDateRaw = parseChileDateString(startRaw);
  const frequencyDays = toInt(frequencyRaw);

  if (!startDateRaw || !Number.isFinite(frequencyDays)) return null;

  const startDate = startOfChileDay(startDateRaw);
  if (!startDate) return null;

  const dueDate = addChileDays(startDate, frequencyDays);
  if (!dueDate) return null;

  const expirationDate = addChileDays(startDate, frequencyDays + 2);
  if (!expirationDate) return null;

  return {
    startDate,
    frequencyDays,
    dueDate,
    expirationDate,
  };
};

export function getOrderExpirationDetails(order) {
  return computeExpirationInfo(order?.info || null);
}

export function isOrderExpired(order, referenceDate = new Date()) {
  const info = computeExpirationInfo(order?.info || null);
  if (!info) return false;
  const reference = startOfChileDay(referenceDate);
  if (!reference) return false;
  return reference > info.expirationDate;
}

/**
 * Initialize DB and ensure PublicDBMeta exists at least with version 1.
 */
export async function initAPIDB() {
  try {
    await ensurePersistentStorage();
  } catch {}
  await db.open();
  if ((await db.usersMeta.count()) === 0) {
    await db.usersMeta.put({
      version: 1,
      changeLog: [`${nowISO()} - init users meta v1`],
    });
  }
  if ((await db.ordersMeta.count()) === 0) {
    await db.ordersMeta.put({
      version: 1,
      changeLog: [`${nowISO()} - init orders meta v1`],
    });
  }
  return db;
}

// --- Local change notifications (same-tab + cross-tab) ---
// We notify on local mutations so the P2P layer can auto-broadcast users DB.
// Important: DO NOT notify on applyUsersSnapshot to avoid feedback loops.
const USERS_BC_NAME = "wt-users-changes";
let usersBC = null;
function getUsersBC() {
  try {
    if (!usersBC && "BroadcastChannel" in self) {
      usersBC = new BroadcastChannel(USERS_BC_NAME);
    }
  } catch {}
  return usersBC;
}

function notifyUsersChanged(reason = "users-updated") {
  try {
    // Same-tab listeners
    const evt = new CustomEvent("users:changed", {
      detail: { reason, ts: Date.now() },
    });
    window.dispatchEvent(evt);
  } catch {}
  try {
    // Cross-tab listeners
    const bc = getUsersBC();
    bc?.postMessage?.({ type: "users:changed", reason, ts: Date.now() });
  } catch {}
}

// Orders notifications
const ORDERS_BC_NAME = "wt-orders-changes";
let ordersBC = null;
function getOrdersBC() {
  try {
    if (!ordersBC && "BroadcastChannel" in self) {
      ordersBC = new BroadcastChannel(ORDERS_BC_NAME);
    }
  } catch {}
  return ordersBC;
}

function notifyOrdersChanged(reason = "orders-updated") {
  try {
    // Same-tab listeners
    const evt = new CustomEvent("orders:changed", {
      detail: { reason, ts: Date.now() },
    });
    window.dispatchEvent(evt);
  } catch {}
  try {
    // Cross-tab listeners
    const bc = getOrdersBC();
    bc?.postMessage?.({ type: "orders:changed", reason, ts: Date.now() });
  } catch {}
}

/**
 * Increment PublicDBMeta version and append to changeLog.
 * @param {string} reason - short description of the change
 */
async function bumpUsersVersion(reason) {
  const latest = await db.usersMeta.orderBy("version").last();
  const nextVer = latest ? latest.version + 1 : 1;
  const changeLog = latest?.changeLog ? [...latest.changeLog] : [];
  changeLog.push(`${nowISO()} - ${reason}`);
  await db.usersMeta.put({ version: nextVer, changeLog });
  return nextVer;
}

async function bumpOrdersVersion(reason) {
  const latest = await db.ordersMeta.orderBy("version").last();
  const nextVer = latest ? latest.version + 1 : 1;
  const changeLog = latest?.changeLog ? [...latest.changeLog] : [];
  changeLog.push(`${nowISO()} - ${reason}`);
  await db.ordersMeta.put({ version: nextVer, changeLog });
  return nextVer;
}

/**
 * Seed root admin from env if not present.
 * Env: VITE_ADMIN_NAME, VITE_ADMIN_PASSWORD, VITE_ADMIN_CODE
 */
export async function seedRootAdminFromEnv() {
  await initAPIDB();
  const name = String(import.meta.env.VITE_ADMIN_NAME || "").trim();
  const password = String(import.meta.env.VITE_ADMIN_PASSWORD || "").trim();
  const code = toInt(import.meta.env.VITE_ADMIN_CODE || "");
  if (!name || !password || !Number.isFinite(code)) return false;

  const exists = await db.users.get(code);
  if (exists) return false;

  const adminUser = {
    code,
    name,
    role: "admin",
    speciality: null,
    active: true,
    // For root admin we keep a simple password hash placeholder (not for production)
    passwordHash: simpleHash(password),
    createdAt: nowISO(),
  };

  await db.transaction("rw", db.users, db.usersMeta, async () => {
    await db.users.put(adminUser);
    await bumpUsersVersion("seed root admin from env");
  });
  // Notify local changes so P2P can propagate users DB
  try {
    notifyUsersChanged("seed-root-admin");
  } catch {}
  return true;
}

// Extremely naive hash to avoid storing raw password in plain text locally.
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// Users CRUD
export async function listUsers() {
  await initAPIDB();
  return db.users.orderBy("code").toArray();
}

export async function getUser(code) {
  await initAPIDB();
  return db.users.get(toInt(code));
}

export async function addUser({
  code,
  name,
  role,
  speciality = null,
  active = true,
  password,
}) {
  await initAPIDB();
  const c = toInt(code);
  if (!Number.isFinite(c)) throw new Error("code must be an integer");
  if (!name || !role) throw new Error("name and role are required");
  const passwordHash =
    typeof password === "string" && password.length
      ? simpleHash(password)
      : undefined;
  await db.transaction("rw", db.users, db.usersMeta, async () => {
    await db.users.put({
      code: c,
      name: String(name).trim(),
      role,
      speciality: speciality ?? null,
      active: !!active,
      ...(passwordHash ? { passwordHash } : {}),
    });
    await bumpUsersVersion(`add user ${c}`);
  });
  try {
    notifyUsersChanged("add-user");
  } catch {}
}

export async function updateUser(code, patch) {
  await initAPIDB();
  const c = toInt(code);
  const prev = await db.users.get(c);
  if (!prev) throw new Error("user not found");
  const next = { ...prev, ...patch };
  await db.transaction("rw", db.users, db.usersMeta, async () => {
    await db.users.put(next);
    await bumpUsersVersion(`update user ${c}`);
  });
  try {
    notifyUsersChanged("update-user");
  } catch {}
}

export async function deleteUser(code) {
  await initAPIDB();
  const c = toInt(code);
  await db.transaction("rw", db.users, db.usersMeta, async () => {
    await db.users.delete(c);
    await bumpUsersVersion(`delete user ${c}`);
  });
  try {
    notifyUsersChanged("delete-user");
  } catch {}
}

// Orders
export async function bulkUpsertOrders(orders) {
  await initAPIDB();
  if (!Array.isArray(orders)) return 0;
  const canon = orders
    .map((o) => {
      const vals = [
        o.code,
        o?.info?.["Numero orden"],
        o?.["Numero orden"],
        o?.Numero,
        o.id,
      ];
      for (const v of vals) {
        const n = Number.parseInt?.(String(v || "").trim(), 10);
        if (Number.isFinite(n)) {
          const normalized = { ...o, code: n };
          if (normalized.tasks?.data) {
            normalized.info = {
              ...(normalized.info || {}),
              status: calculateOrderStatus(normalized.tasks.data),
            };
          }
          return normalized;
        }
      }
      return null;
    })
    .filter(Boolean);
  if (canon.length) await db.orders.bulkPut(canon);
  await bumpOrdersVersion(`bulk upsert orders (${orders.length})`);
  try {
    notifyOrdersChanged("bulk-upsert");
  } catch {}
  return orders.length;
}

export async function listOrders() {
  await initAPIDB();
  return db.orders.toArray();
}

export async function fetchOrdersBySpeciality(specialityId) {
  await initAPIDB();
  const all = await db.orders.toArray();
  const sid = toInt(specialityId);
  if (!Number.isFinite(sid)) return all;
  return all.filter((o) => {
    const sp = o?.info?.["Especialidad_id"];
    return Number.isFinite(sp) && Number(sp) === sid;
  });
}

export async function fetchOrdersByAssignedUser(userCode) {
  await initAPIDB();
  const all = await db.orders.toArray();
  const uid = toInt(userCode);
  if (!Number.isFinite(uid)) return [];

  return all
    .filter((o) => {
      const assignedCode = o?.info?.asignado_a_code;
      return Number.isFinite(assignedCode) && Number(assignedCode) === uid;
    })
    .filter((o) => {
      const status = Number(
        o?.info?.status ?? calculateOrderStatus(o?.tasks?.data)
      );
      return status !== 2 && status !== 3 && status !== 4;
    });
}

export async function markOrdersExpired(orderCodes) {
  await initAPIDB();

  const codesSet = new Set(
    Array.isArray(orderCodes)
      ? orderCodes
          .map((code) => toInt(code))
          .filter((code) => Number.isFinite(code))
      : []
  );

  const allOrders = await db.orders.toArray();
  if (!allOrders.length) return { expiredMarked: 0, restored: 0 };

  const today = startOfChileDay(new Date());
  if (!today) return { expiredMarked: 0, restored: 0 };

  const updates = [];
  let expiredMarked = 0;
  let restored = 0;

  for (const order of allOrders) {
    const code = toInt(order?.code);
    if (!Number.isFinite(code)) continue;

    const status = Number(order?.info?.status);
    const shouldEvaluate = codesSet.has(code) || status === 4;
    if (!shouldEvaluate) continue;

    const expirationInfo = computeExpirationInfo(order?.info || null);
    const expired = expirationInfo
      ? today > expirationInfo.expirationDate
      : false;

    if (expired) {
      if (status !== 4) {
        const nextInfo = {
          ...(order.info || {}),
          status: 4,
        };
        if (!nextInfo.obs_anulada) {
          nextInfo.obs_anulada = AUTO_EXPIRED_NOTE;
        }
        updates.push({
          ...order,
          info: nextInfo,
        });
        expiredMarked += 1;
      }
    } else if (status === 4) {
      const nextStatus = calculateOrderStatus(order?.tasks?.data);
      const nextInfo = {
        ...(order.info || {}),
        status: nextStatus,
      };
      if (nextInfo.obs_anulada === AUTO_EXPIRED_NOTE) {
        delete nextInfo.obs_anulada;
      }
      updates.push({
        ...order,
        info: nextInfo,
      });
      restored += 1;
    }
  }

  if (!updates.length) {
    return { expiredMarked, restored };
  }

  await db.transaction("rw", db.orders, db.ordersMeta, async () => {
    await db.orders.bulkPut(updates);
    await bumpOrdersVersion(
      `revalidate expired orders (marked ${expiredMarked}, restored ${restored})`
    );
  });

  try {
    notifyOrdersChanged("orders-expired");
  } catch {}

  return { expiredMarked, restored };
}

export async function cancelOrder(orderCode, reason, detail) {
  await initAPIDB();
  const code = toInt(orderCode);
  if (!Number.isFinite(code)) throw new Error("order code must be numeric");

  const order = await db.orders.get(code);
  if (!order) throw new Error("order not found");

  const sanitizedReason = typeof reason === "string" ? reason.trim() : "";
  const sanitizedDetail = typeof detail === "string" ? detail.trim() : "";
  if (!sanitizedReason) throw new Error("cancellation reason required");
  if (!sanitizedDetail) throw new Error("cancellation detail required");
  const obsAnulada = [sanitizedReason, sanitizedDetail];

  const updatedOrder = {
    ...order,
    info: {
      ...(order.info || {}),
      status: 3,
      obs_anulada: obsAnulada,
    },
  };

  await db.transaction("rw", db.orders, db.ordersMeta, async () => {
    await db.orders.put(updatedOrder);
    await bumpOrdersVersion(`cancel order ${code}`);
  });

  try {
    notifyOrdersChanged("order-cancelled");
  } catch {}

  return updatedOrder;
}

export async function getOrderByCode(orderCode) {
  await initAPIDB();
  const code = toInt(orderCode);
  if (!Number.isFinite(code)) return null;
  return db.orders.get(code);
}

export async function startOrderTask(orderCode, taskIndex) {
  await initAPIDB();
  const code = toInt(orderCode);
  const idx = Number.parseInt(taskIndex, 10);
  if (!Number.isFinite(code)) throw new Error("order code must be numeric");
  if (!Number.isInteger(idx) || idx < 0)
    throw new Error("task index must be a non-negative integer");

  const order = await db.orders.get(code);
  if (!order) throw new Error("order not found");
  const taskList = Array.isArray(order?.tasks?.data) ? order.tasks.data : null;
  if (!taskList || !taskList[idx]) throw new Error("task not found");

  const prevTask = taskList[idx];
  const startAt = prevTask?.init_task || new Date().toISOString();
  const nextTask = {
    ...prevTask,
    init_task: startAt,
    status:
      typeof prevTask?.status === "number" && prevTask.status > 0
        ? prevTask.status
        : 1,
  };

  const updatedTasks = taskList.map((task, i) =>
    i === idx ? nextTask : { ...task }
  );

  const updatedOrder = {
    ...order,
    tasks: {
      ...(order.tasks || {}),
      data: updatedTasks,
    },
  };

  updatedOrder.info = {
    ...(updatedOrder.info || {}),
    status: calculateOrderStatus(updatedTasks),
  };

  await db.transaction("rw", db.orders, db.ordersMeta, async () => {
    await db.orders.put(updatedOrder);
    await bumpOrdersVersion(`start task ${idx + 1} order ${code}`);
  });

  try {
    notifyOrdersChanged("task-started");
  } catch {}

  return {
    order: updatedOrder,
    task: nextTask,
    index: idx,
  };
}

export async function completeOrderTask(orderCode, taskIndex, updates = {}) {
  await initAPIDB();
  const code = toInt(orderCode);
  const idx = Number.parseInt(taskIndex, 10);
  if (!Number.isFinite(code)) throw new Error("order code must be numeric");
  if (!Number.isInteger(idx) || idx < 0)
    throw new Error("task index must be a non-negative integer");

  const order = await db.orders.get(code);
  if (!order) throw new Error("order not found");
  const taskList = Array.isArray(order?.tasks?.data) ? order.tasks.data : null;
  if (!taskList || !taskList[idx]) throw new Error("task not found");

  const prevTask = taskList[idx];
  const timestamp = new Date().toISOString();

  const nextTask = {
    ...prevTask,
    status: 2,
    completed_at: prevTask?.completed_at ?? timestamp,
    accepted_protocol: updates.accepted ?? true,
    accepted_at: prevTask?.accepted_at ?? timestamp,
  };

  if (typeof updates.obs === "string") {
    nextTask.obs_assigned_to = updates.obs;
  }

  if (typeof updates.medicion !== "undefined") {
    nextTask.medicion_result = updates.medicion;
  }

  if (typeof updates.rangoDesde !== "undefined") {
    nextTask.medicion_range_from = updates.rangoDesde;
  }

  if (typeof updates.rangoHasta !== "undefined") {
    nextTask.medicion_range_to = updates.rangoHasta;
  }

  if (!nextTask.init_task) {
    nextTask.init_task = timestamp;
  }

  const updatedTasks = taskList.map((task, i) =>
    i === idx ? nextTask : { ...task }
  );

  const updatedOrder = {
    ...order,
    tasks: {
      ...(order.tasks || {}),
      data: updatedTasks,
    },
  };

  updatedOrder.info = {
    ...(updatedOrder.info || {}),
    status: calculateOrderStatus(updatedTasks),
  };

  await db.transaction("rw", db.orders, db.ordersMeta, async () => {
    await db.orders.put(updatedOrder);
    await bumpOrdersVersion(`complete task ${idx + 1} order ${code}`);
  });

  try {
    notifyOrdersChanged("task-completed");
  } catch {}

  return {
    order: updatedOrder,
    task: nextTask,
    index: idx,
  };
}

export async function saveOrderChecklist(orderCode, checklistData) {
  await initAPIDB();
  const code = toInt(orderCode);
  if (!Number.isFinite(code)) throw new Error("order code must be numeric");

  const order = await db.orders.get(code);
  if (!order) throw new Error("order not found");

  const nextInfo = {
    ...(order.info || {}),
    checkListDict: checklistData,
  };

  const updatedOrder = {
    ...order,
    info: nextInfo,
  };

  await db.transaction("rw", db.orders, db.ordersMeta, async () => {
    await db.orders.put(updatedOrder);
    await bumpOrdersVersion(`save checklist order ${code}`);
  });

  try {
    notifyOrdersChanged("order-checklist-updated");
  } catch {}

  return updatedOrder;
}

// Auth helpers
export async function verifyRootAdmin(code, password) {
  await initAPIDB();
  const c = toInt(code);
  if (!Number.isFinite(c)) return false;
  const user = await db.users.get(c);
  if (!user || user.role !== "admin" || user.active !== true) return false;
  const expected = simpleHash(
    String(import.meta.env.VITE_ADMIN_PASSWORD || "").trim()
  );
  return (
    user.passwordHash &&
    user.passwordHash === expected &&
    simpleHash(String(password || "").trim()) === expected
  );
}

export async function verifyUser(code, password) {
  await initAPIDB();
  const c = toInt(code);
  if (!Number.isFinite(c)) return null;
  const user = await db.users.get(c);
  if (!user || user.active !== true) return null;
  if (!password) return null;
  let expected;
  if (user.role === "admin") {
    expected = simpleHash(
      String(import.meta.env.VITE_ADMIN_PASSWORD || "").trim()
    );
  } else {
    expected = simpleHash(String(password).trim());
  }
  if (user.passwordHash === expected) return user;
  return null;
}

export async function getUsersMeta() {
  await initAPIDB();
  return db.usersMeta.orderBy("version").last();
}

export async function getOrdersMeta() {
  await initAPIDB();
  return db.ordersMeta.orderBy("version").last();
}

// Snapshots (Users)
export async function getUsersSnapshot() {
  await initAPIDB();
  const users = await db.users.orderBy("code").toArray();
  const meta = await getUsersMeta();
  let sig;
  try {
    sig = await sha256Hex(
      canonicalizeUsersForSignature(users) + `#v${meta?.version || 0}`
    );
  } catch {}
  return {
    meta,
    users: users.map((u) => ({ ...u })),
    sig,
  };
}

export async function applyUsersSnapshot({ meta, users, sig }) {
  await initAPIDB();
  const localMeta = await getUsersMeta();
  const localVer = localMeta?.version || 0;
  const incomingVer = meta?.version || 0;
  // Compute and log signature check (best-effort)
  try {
    const calc = await sha256Hex(
      canonicalizeUsersForSignature(users || []) + `#v${incomingVer}`
    );
    if (sig && calc !== sig) {
      // signature mismatch - we still can choose to reject; for now, log only
      console.warn("Users snapshot signature mismatch");
    }
  } catch {}
  if (incomingVer <= localVer)
    return { applied: false, reason: "stale-version" };
  await db.transaction("rw", db.users, db.usersMeta, async () => {
    await db.users.clear();
    if (Array.isArray(users) && users.length) {
      await db.users.bulkPut(
        users.map((u) => ({
          ...u,
          code: toInt(u.code),
        }))
      );
    }
    await db.usersMeta.put({
      version: incomingVer,
      changeLog: meta?.changeLog || [],
    });
  });
  // Do not call notifyUsersChanged here to prevent echo/broadcast loops.
  try {
    notifyUsersChanged("snapshot-applied");
  } catch {}
  return { applied: true };
}

// Snapshots (Orders)
export async function getOrdersSnapshotForSpeciality(specialityId) {
  await initAPIDB();
  const orders = await fetchOrdersBySpeciality(specialityId);
  const meta = await getOrdersMeta();
  return { meta, orders };
}

export async function getOrdersSnapshotForUser(userCode) {
  await initAPIDB();
  const allOrders = await db.orders.toArray();
  const orders = allOrders.filter((o) => o?.info?.asignado_a_code === userCode);
  const meta = await getOrdersMeta();
  return { meta, orders };
}

export async function applyOrdersSnapshot({ meta, orders }) {
  await initAPIDB();
  const localMeta = await getOrdersMeta();
  const localVer = localMeta?.version || 0;
  const incomingVer = meta?.version || 0;
  if (incomingVer <= localVer)
    return { applied: false, reason: "stale-version" };
  await db.transaction("rw", db.orders, db.ordersMeta, async () => {
    if (Array.isArray(orders) && orders.length) {
      await db.orders.bulkPut(
        orders
          .map((o) => {
            const vals = [
              o.code,
              o?.info?.["Numero orden"],
              o?.["Numero orden"],
              o?.Numero,
              o.id,
            ];
            for (const v of vals) {
              const n = Number.parseInt?.(String(v || "").trim(), 10);
              if (Number.isFinite(n)) return { ...o, code: n };
            }
            return null;
          })
          .filter(Boolean)
      );
    }
    await db.ordersMeta.put({
      version: incomingVer,
      changeLog: meta?.changeLog || [],
    });
  });
  try {
    notifyOrdersChanged("snapshot-applied");
  } catch {}
  return { applied: true };
}

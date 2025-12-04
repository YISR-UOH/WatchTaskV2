/**
 * @file APIdb.js
 * @description Dexie wrapper for IndexedDB.
 */
import Dexie from "dexie";
import {
  CHILE_TIME_ZONE,
  addChileDays,
  getTimeZoneOffsetMinutes,
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
          "SIGEM: el navegador denegó la solicitud de almacenamiento persistente."
        );
      }
      return persistentStorageStatus;
    } catch (error) {
      console.warn(
        "SIGEM: no fue posible solicitar almacenamiento persistente.",
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
export const db = new Dexie("WatchTaskDB");

db.version(3)
  .stores({
    users: "&code, name, role, speciality, active",
    usersMeta: "&version",
    orders: "&code",
    ordersMeta: "&version",
    publicDB: null,
    publicDBMeta: null,
    publicUsersMeta: null,
    ordersByCode: null,
  })
  .upgrade(async (tx) => {
    if ((await tx.table("usersMeta").count()) === 0) {
      await tx.table("usersMeta").put({
        version: 1,
        changeLog: [`${nowISO()} - init users meta v1`],
      });
    }
    if ((await tx.table("ordersMeta").count()) === 0) {
      await tx.table("ordersMeta").put({
        version: 1,
        changeLog: [`${nowISO()} - init orders meta v1`],
      });
    }
    try {
      const dest = tx.table("orders");
      const srcByCode = tx.table("ordersByCode");
      const srcLegacy = tx.table("orders");
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
          `${nowISO()} - migrated orders to code PK (${migrated})`
        );
        await meta.put({ version: nextVer, changeLog });
      }
    } catch {}
  });

const toInt = (v) => {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : undefined;
};

const padNumber = (value, size = 2) => String(value ?? "").padStart(size, "0");

const sanitizeLegacyOffsetString = (value) => {
  if (typeof value !== "string") return value;
  if (!/[+-]\d{2}:[0-9]+\./.test(value)) return value;
  return value.replace(
    /([+-]\d{2}):([0-9]+)(\.[0-9]+)/g,
    (_, hourPart, minutePart, fractional) => {
      const minutesFloat = Number(`${minutePart}${fractional}`);
      const normalizedMinutes = Number.isFinite(minutesFloat)
        ? Math.max(0, Math.min(59, Math.trunc(minutesFloat)))
        : Math.max(0, Math.min(59, Number.parseInt(minutePart, 10) || 0));
      return `${hourPart}:${padNumber(normalizedMinutes, 2)}`;
    }
  );
};

const formatChileDateTimeISO = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date?.getTime?.())) return "";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHILE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }
  const rawOffsetMinutes = getTimeZoneOffsetMinutes(CHILE_TIME_ZONE, date) || 0;
  const roundedOffsetMinutes = Number.isFinite(rawOffsetMinutes)
    ? Math.round(rawOffsetMinutes)
    : 0;
  const sign = roundedOffsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(roundedOffsetMinutes);
  const offset = `${sign}${padNumber(Math.floor(absMinutes / 60), 2)}:${padNumber(
    absMinutes % 60,
    2
  )}`;
  const millis = padNumber(date.getMilliseconds(), 3);
  return `${map.year || "0000"}-${map.month || "01"}-${
    map.day || "01"
  }T${map.hour || "00"}:${map.minute || "00"}:${map.second || "00"}.${millis}${offset}`;
};

const nowISO = () => formatChileDateTimeISO();

const parseFlexibleDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const dateFromNumber = new Date(value);
    if (!Number.isNaN(dateFromNumber.getTime())) return dateFromNumber;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      const sanitized = sanitizeLegacyOffsetString(trimmed);
      const attempts = [trimmed];
      if (sanitized !== trimmed) attempts.push(sanitized);
      for (const candidate of attempts) {
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
    }
  }
  const maybeDate = parseChileDateString(
    typeof value === "string" ? sanitizeLegacyOffsetString(value) : value
  );
  if (maybeDate && !Number.isNaN(maybeDate.getTime())) return maybeDate;
  return null;
};

const toISOOrNow = (value) => {
  const parsed = parseFlexibleDate(value);
  return parsed ? formatChileDateTimeISO(parsed) : nowISO();
};

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

const BACKUP_SIGNATURE = "WatchTaskBackup";
const BACKUP_VERSION = 1;
const BACKUP_SCOPES = new Set(["all", "users", "orders"]);
const normalizeBackupScope = (scope) => {
  const normalized = String(scope || "").toLowerCase();
  if (BACKUP_SCOPES.has(normalized)) return normalized;
  return "all";
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

  const expirationDate = addChileDays(startDate, frequencyDays + 4);
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
  try {
    await markOrdersExpired(undefined, { skipInit: true });
  } catch (error) {
    console.warn("SIGEM: no fue posible validar expiración de ordenes", error);
  }
  return db;
}
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
    const evt = new CustomEvent("users:changed", {
      detail: { reason, ts: Date.now() },
    });
    window.dispatchEvent(evt);
  } catch {}
  try {
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
    const evt = new CustomEvent("orders:changed", {
      detail: { reason, ts: Date.now() },
    });
    window.dispatchEvent(evt);
  } catch {}
  try {
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
    passwordHash: simpleHash(password),
    createdAt: nowISO(),
  };

  await db.transaction("rw", db.users, db.usersMeta, async () => {
    await db.users.put(adminUser);
    await bumpUsersVersion("seed root admin from env");
  });
  try {
    notifyUsersChanged("seed-root-admin");
  } catch {}
  return true;
}

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
  signature = null,
}) {
  await initAPIDB();

  const numericCode = toInt(code);
  if (!Number.isFinite(numericCode)) {
    throw new Error("El código debe ser un número entero válido.");
  }

  const trimmedName = String(name ?? "").trim();
  if (!trimmedName) {
    throw new Error("El nombre es obligatorio.");
  }

  const normalizedRole = String(role ?? "").trim();
  if (!normalizedRole) {
    throw new Error("El rol es obligatorio.");
  }

  const requiresSpeciality =
    normalizedRole === "supervisor" || normalizedRole === "mantenedor";
  const specialityValue = toInt(speciality);
  if (requiresSpeciality && !Number.isFinite(specialityValue)) {
    throw new Error("Selecciona una especialidad válida.");
  }

  const passwordHash =
    typeof password === "string" && password.length
      ? simpleHash(password)
      : undefined;

  await db.transaction("rw", db.users, db.usersMeta, async () => {
    const exists = await db.users.get(numericCode);
    if (exists) {
      throw new Error("Ya existe un usuario con ese código.");
    }

    const timestamp = nowISO();
    await db.users.add({
      code: numericCode,
      name: trimmedName,
      role: normalizedRole,
      speciality:
        requiresSpeciality && Number.isFinite(specialityValue)
          ? specialityValue
          : null,
      active: !!active,
      signature: signature ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(passwordHash ? { passwordHash } : {}),
    });
    await bumpUsersVersion(`add user ${numericCode}`);
  });
  try {
    notifyUsersChanged("add-user");
  } catch {}
}

export async function updateUser(code, patch = {}) {
  await initAPIDB();
  const numericCode = toInt(code);
  if (!Number.isFinite(numericCode)) {
    throw new Error("El código debe ser un número entero válido.");
  }

  const existing = await db.users.get(numericCode);
  if (!existing) {
    throw new Error("El usuario especificado no existe.");
  }

  const next = { ...existing };

  const nameValue = Object.prototype.hasOwnProperty.call(patch, "name")
    ? String(patch.name ?? "").trim()
    : String(existing.name ?? "").trim();
  if (!nameValue) {
    throw new Error("El nombre es obligatorio.");
  }
  next.name = nameValue;

  const roleValue = Object.prototype.hasOwnProperty.call(patch, "role")
    ? String(patch.role ?? "").trim()
    : String(existing.role ?? "").trim();
  if (!roleValue) {
    throw new Error("El rol es obligatorio.");
  }
  next.role = roleValue;

  const requiresSpeciality =
    roleValue === "supervisor" || roleValue === "mantenedor";

  if (Object.prototype.hasOwnProperty.call(patch, "speciality")) {
    const parsedSpeciality = toInt(patch.speciality);
    if (requiresSpeciality) {
      if (!Number.isFinite(parsedSpeciality)) {
        throw new Error("Selecciona una especialidad válida.");
      }
      next.speciality = parsedSpeciality;
    } else {
      next.speciality = Number.isFinite(parsedSpeciality)
        ? parsedSpeciality
        : null;
    }
  } else if (requiresSpeciality) {
    const currentSpeciality = toInt(next.speciality);
    if (!Number.isFinite(currentSpeciality)) {
      throw new Error("Selecciona una especialidad válida.");
    }
    next.speciality = currentSpeciality;
  } else {
    next.speciality = null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "active")) {
    next.active = !!patch.active;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "signature")) {
    next.signature = patch.signature ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "password")) {
    const passwordValue =
      typeof patch.password === "string" ? patch.password.trim() : "";
    if (passwordValue) {
      next.passwordHash = simpleHash(passwordValue);
    }
  }

  next.updatedAt = patch?.updatedAt ?? nowISO();

  await db.transaction("rw", db.users, db.usersMeta, async () => {
    await db.users.put(next);
    await bumpUsersVersion(`update user ${numericCode}`);
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

export async function markOrdersExpired(orderCodes, { skipInit = false } = {}) {
  if (!skipInit) {
    await initAPIDB();
  } else if (!db.isOpen()) {
    await db.open();
  }

  const codesSet = new Set(
    Array.isArray(orderCodes)
      ? orderCodes
          .map((code) => toInt(code))
          .filter((code) => Number.isFinite(code))
      : []
  );
  const evaluateAll = codesSet.size === 0;

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
    if (status === 2) continue; // completed orders stay untouched
    const shouldEvaluate = evaluateAll || codesSet.has(code) || status === 4;
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

export async function exportDatabaseBackup(scope = "all") {
  const normalizedScope = normalizeBackupScope(scope);
  await initAPIDB();

  const includeUsers = normalizedScope === "all" || normalizedScope === "users";
  const includeOrders = normalizedScope === "all" || normalizedScope === "orders";

  const payload = {
    type: BACKUP_SIGNATURE,
    version: BACKUP_VERSION,
    exportedAt: nowISO(),
    scope: normalizedScope,
    data: {},
  };

  if (includeUsers) {
    payload.data.users = await db.users.orderBy("code").toArray();
    payload.data.usersMeta = await db.usersMeta.orderBy("version").toArray();
  }

  if (includeOrders) {
    payload.data.orders = await db.orders.toArray();
    payload.data.ordersMeta = await db.ordersMeta.orderBy("version").toArray();
  }

  return payload;
}

const parseBackupPayload = (rawBackup) => {
  if (!rawBackup) return null;
  if (typeof rawBackup === "string") {
    try {
      return JSON.parse(rawBackup);
    } catch (error) {
      throw new Error("El archivo de backup no es un JSON válido.");
    }
  }
  if (typeof rawBackup === "object") return rawBackup;
  return null;
};

const normalizeMetaEntries = (entries) =>
  Array.isArray(entries)
    ? entries
        .map((meta) => {
          const version = toInt(meta?.version);
          if (!Number.isFinite(version)) return null;
          return { ...meta, version };
        })
        .filter(Boolean)
    : [];

export async function importDatabaseBackup(rawBackup) {
  await initAPIDB();
  const backup = parseBackupPayload(rawBackup);
  if (!backup || typeof backup !== "object") {
    throw new Error("Backup inválido.");
  }
  if (backup.type !== BACKUP_SIGNATURE) {
    throw new Error("El archivo seleccionado no corresponde a un backup del sistema.");
  }
  if (backup.version !== BACKUP_VERSION) {
    throw new Error(
      `Versión de backup incompatible (recibida ${backup.version}, esperada ${BACKUP_VERSION}).`
    );
  }

  const data = backup.data;
  if (!data || typeof data !== "object") {
    throw new Error("El backup no contiene datos para restaurar.");
  }

  const normalizedScope = normalizeBackupScope(backup.scope);
  const restoreUsers =
    normalizedScope !== "orders" &&
    (Array.isArray(data.users) || Array.isArray(data.usersMeta));
  const restoreOrders =
    normalizedScope !== "users" &&
    (Array.isArray(data.orders) || Array.isArray(data.ordersMeta));

  if (!restoreUsers && !restoreOrders) {
    throw new Error("El backup no contiene información de usuarios u órdenes para restaurar.");
  }

  const normalizedUsers = restoreUsers
    ? (Array.isArray(data.users) ? data.users : [])
        .map((user) => {
          const code = toInt(user?.code);
          if (!Number.isFinite(code)) return null;
          return { ...user, code };
        })
        .filter(Boolean)
    : [];

  const normalizedOrders = restoreOrders
    ? (Array.isArray(data.orders) ? data.orders : [])
        .map((order) => {
          const code = toInt(order?.code);
          if (!Number.isFinite(code)) return null;
          return { ...order, code };
        })
        .filter(Boolean)
    : [];

  const usersMetaEntries = restoreUsers
    ? normalizeMetaEntries(data.usersMeta)
    : [];
  const ordersMetaEntries = restoreOrders
    ? normalizeMetaEntries(data.ordersMeta)
    : [];

  const tables = [];
  if (restoreUsers) tables.push(db.users, db.usersMeta);
  if (restoreOrders) tables.push(db.orders, db.ordersMeta);

  await db.transaction("rw", tables, async () => {
    if (restoreUsers) {
      await db.users.clear();
      if (normalizedUsers.length) {
        await db.users.bulkPut(normalizedUsers);
      }
      await db.usersMeta.clear();
      if (usersMetaEntries.length) {
        await db.usersMeta.bulkPut(usersMetaEntries);
      } else {
        await db.usersMeta.put({
          version: 1,
          changeLog: [`${nowISO()} - users meta restaurada sin historial`],
        });
      }
    }

    if (restoreOrders) {
      await db.orders.clear();
      if (normalizedOrders.length) {
        await db.orders.bulkPut(normalizedOrders);
      }
      await db.ordersMeta.clear();
      if (ordersMetaEntries.length) {
        await db.ordersMeta.bulkPut(ordersMetaEntries);
      } else {
        await db.ordersMeta.put({
          version: 1,
          changeLog: [`${nowISO()} - orders meta restaurada sin historial`],
        });
      }
    }
  });

  if (restoreUsers) {
    try {
      notifyUsersChanged("backup-import-users");
    } catch {}
  }

  if (restoreOrders) {
    try {
      notifyOrdersChanged("backup-import-orders");
    } catch {}
    try {
      await markOrdersExpired(undefined, { skipInit: true });
    } catch {}
  }

  return {
    scope: normalizedScope,
    restored: {
      users: normalizedUsers.length,
      orders: normalizedOrders.length,
    },
  };
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
  const startAt = prevTask?.init_task || nowISO();
  const nextTask = {
    ...prevTask,
    init_task: toISOOrNow(startAt),
    accepted_at: prevTask?.accepted_at
      ? toISOOrNow(prevTask.accepted_at)
      : toISOOrNow(startAt),
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
    fecha_inicio: order.info?.fecha_inicio
      ? toISOOrNow(order.info.fecha_inicio)
      : nextTask.init_task,
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
  const timestamp = nowISO();

  const nextTask = {
    ...prevTask,
    status: 2,
    end_task: timestamp,
    
    completed_by: updates.completed_by ?? prevTask?.completed_by ?? order?.info?.asignado_a_code ?? null,
    completed_at: timestamp,
    // calcular duration_seconds
    duration_seconds: (() => {
      const start =
        parseFlexibleDate(prevTask?.init_task) ||
        parseFlexibleDate(order.info?.fecha_inicio) ||
        new Date(timestamp);
      const end = parseFlexibleDate(timestamp) || new Date();
      const diffMs = end.getTime() - start.getTime();
      return Math.max(0, Math.floor(diffMs / 1000));
    })(),
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
    // TODO: revisar, zona horaria, formato y consistencia
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
    fecha_fin: timestamp,
    // TODO: hs_reales = delta entre fecha_inicio y fecha_fin en horas
    hs_reales: (() => {
      const startCandidates = [
        updatedOrder.info?.fecha_inicio,
        order.info?.fecha_inicio,
        prevTask?.init_task,
        order.tasks?.data?.find((task) => task?.init_task)?.init_task,
      ];
      const endCandidates = [timestamp, order.info?.fecha_fin];

      const startDate = startCandidates
        .map((candidate) => parseFlexibleDate(candidate))
        .find((parsed) => parsed);
      const endDate = endCandidates
        .map((candidate) => parseFlexibleDate(candidate))
        .find((parsed) => parsed);
      if (!startDate || !endDate) return 0;
      const diffMs = endDate.getTime() - startDate.getTime();
      if (!Number.isFinite(diffMs) || diffMs <= 0) return 0;
      return Number((diffMs / (1000 * 60 * 60)).toFixed(2));
    })(),
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
    if (user.name === String(import.meta.env.VITE_ADMIN_NAME || "").trim()) {
      expected = simpleHash(
        String(import.meta.env.VITE_ADMIN_PASSWORD || "").trim()
      );
    } else {
      expected = simpleHash(String(password).trim());
    }
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
  try {
    const calc = await sha256Hex(
      canonicalizeUsersForSignature(users || []) + `#v${incomingVer}`
    );
    if (sig && calc !== sig) {
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

export async function applyOrdersSnapshot({ meta, orders }, context = {}) {
  await initAPIDB();
  const localMeta = await getOrdersMeta();
  const localVer = localMeta?.version || 0;
  const incomingVer = meta?.version || 0;
  if (incomingVer <= localVer)
    return { applied: false, reason: "stale-version" };
  const normalized = Array.isArray(orders)
    ? orders
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
    : [];
  const keepCodes = new Set(
    normalized
      .map((order) => toInt(order?.code))
      .filter((code) => Number.isFinite(code))
  );

  await db.transaction("rw", db.orders, db.ordersMeta, async () => {
    const scopedRemoval = async () => {
      if (context?.userCode != null) {
        const targetUser = toInt(context.userCode);
        if (!Number.isFinite(targetUser)) return;
        const existing = await db.orders
          .filter(
            (order) => Number(order?.info?.asignado_a_code) === targetUser
          )
          .toArray();
        const toRemove = existing
          .map((order) => toInt(order?.code))
          .filter((code) => Number.isFinite(code) && !keepCodes.has(code));
        if (toRemove.length) {
          await db.orders.bulkDelete(Array.from(new Set(toRemove)));
        }
        return;
      }

      if (context?.speciality != null) {
        const targetSpeciality = toInt(context.speciality);
        if (!Number.isFinite(targetSpeciality)) return;
        const existing = await db.orders
          .filter(
            (order) =>
              Number(order?.info?.["Especialidad_id"]) === targetSpeciality
          )
          .toArray();
        const toRemove = existing
          .map((order) => toInt(order?.code))
          .filter((code) => Number.isFinite(code) && !keepCodes.has(code));
        if (toRemove.length) {
          await db.orders.bulkDelete(Array.from(new Set(toRemove)));
        }
      }
    };

    await scopedRemoval();

    if (normalized.length) {
      await db.orders.bulkPut(normalized);
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

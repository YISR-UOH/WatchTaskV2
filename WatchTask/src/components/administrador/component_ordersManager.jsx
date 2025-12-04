import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  listOrders,
  listUsers,
  markOrdersExpired,
  isOrderExpired,
} from "@/utils/APIdb";
import { parseChileDateString, startOfChileDay } from "@/utils/timezone";

const ALLOWED_STATUSES = new Set([2, 3, 4]);

const STATUS_LABELS = {
  2: "Completada",
  3: "Anulada",
  4: "Vencida",
};

const STATUS_ORDER = [2, 3, 4];

const SPECIALITY_LABELS = {
  1: "Electrico",
  2: "Mecanico",
};

const STATUS_STYLES = {
  2: {
    border: "border-emerald-200",
    bg: "bg-emerald-50",
    headerBorder: "border-emerald-200",
    title: "text-emerald-800",
    countBg: "bg-emerald-100",
    countText: "text-emerald-800",
    listText: "text-emerald-800",
    metaText: "text-emerald-600",
    badgeBg: "bg-emerald-200",
    badgeText: "text-emerald-900",
  },
  3: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    headerBorder: "border-amber-200",
    title: "text-amber-800",
    countBg: "bg-amber-100",
    countText: "text-amber-800",
    listText: "text-amber-800",
    metaText: "text-amber-600",
    badgeBg: "bg-amber-200",
    badgeText: "text-amber-900",
  },
  4: {
    border: "border-rose-200",
    bg: "bg-rose-50",
    headerBorder: "border-rose-200",
    title: "text-rose-800",
    countBg: "bg-rose-100",
    countText: "text-rose-800",
    listText: "text-rose-800",
    metaText: "text-rose-600",
    badgeBg: "bg-rose-200",
    badgeText: "text-rose-900",
  },
  default: {
    border: "border-slate-200",
    bg: "bg-slate-50",
    headerBorder: "border-slate-200",
    title: "text-slate-800",
    countBg: "bg-white",
    countText: "text-slate-600",
    listText: "text-slate-700",
    metaText: "text-slate-500",
    badgeBg: "bg-slate-200",
    badgeText: "text-slate-700",
  },
};

const regexMachine = /^(?<code>\w+)\s(?<name>[\w-]+)(\s-\s(?<desc>.+))?$/;

function parseMachineCode(value) {
  if (typeof value !== "string") {
    return { machineCode: "", machineName: "", machineDesc: "" };
  }
  const match = value.match(regexMachine);
  if (match?.groups) {
    return {
      machineCode: match.groups.code || "",
      machineName: match.groups.name || "",
      machineDesc: match.groups.desc || "",
    };
  }
  return { machineCode: "", machineName: "", machineDesc: "" };
}

const MACHINES = {
  KBA: "KBA",
  COR: "CORRUGADORA",
  ISW: "ISOWA",
  ET: "ETERNA",
  LAM: "LAMINADORA",
  NT: "MARTIN",
  W1: "WARD",
};

const SERVICES = {
  SC: "SERVICIOS",
  GRS: "GRUAS",
  DP: "PLANTA",
  EXP: "EXPEDICION",
  TM: "TALLER",
  EDI: "EDIFICIO",
};

function normalizeValue(value) {
  return String(value ?? "").trim();
}
function getSpecialityLabel(id) {
  if (Number.isFinite(id) && SPECIALITY_LABELS[id])
    return SPECIALITY_LABELS[id];
  return "Sin especialidad";
}

function getStatusLabel(id) {
  return STATUS_LABELS[id] || "Sin estado";
}

function hasCompleteSupervisorChecklist(order) {
  const supervisor = order?.info?.checkListDict?.supervisor;
  if (!supervisor) return false;
  const nombre =
    typeof supervisor.nombre === "string" ? supervisor.nombre.trim() : "";
  const fecha =
    typeof supervisor.fecha === "string" ? supervisor.fecha.trim() : "";
  const firma =
    typeof supervisor.firma === "string" ? supervisor.firma.trim() : "";
  return Boolean(nombre && fecha && firma);
}

export default function OrdersManager() {
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedMaintainerBuckets, setExpandedMaintainerBuckets] = useState(
    () => new Set()
  );
  const [expandedUnassignedCards, setExpandedUnassignedCards] = useState(
    () => new Set()
  );
  const [selectMachine, setSelectMachine] = useState("");
  const [selectService, setSelectService] = useState("");
  const [startDateFrom, setStartDateFrom] = useState("");
  const [startDateTo, setStartDateTo] = useState("");
  const [frequencyMin, setFrequencyMin] = useState("");
  const [frequencyMax, setFrequencyMax] = useState("");
  const [kitSearch, setKitSearch] = useState("");
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        selectMachine ||
          selectService ||
          startDateFrom ||
          startDateTo ||
          frequencyMin ||
          frequencyMax ||
          kitSearch
      ),
    [
      frequencyMax,
      frequencyMin,
      selectMachine,
      selectService,
      startDateFrom,
      startDateTo,
    ]
  );

  const handleMachineChange = (event) => {
    setSelectService("");
    setSelectMachine(event.target.value);
  };

  const handleServiceChange = (event) => {
    setSelectMachine("");
    setSelectService(event.target.value);
  };

  const handleClearFilters = () => {
    setSelectMachine("");
    setSelectService("");
    setStartDateFrom("");
    setStartDateTo("");
    setFrequencyMin("");
    setFrequencyMax("");
    setKitSearch("");
  };

  const filteredOrders = useMemo(() => {
    if (!orders.length) return [];

    const fromDate = startDateFrom
      ? startOfChileDay(new Date(`${startDateFrom}T00:00:00`))
      : null;
    const toDate = startDateTo
      ? startOfChileDay(new Date(`${startDateTo}T00:00:00`))
      : null;
    const minFreq =
      frequencyMin !== "" ? Number.parseInt(frequencyMin, 10) : null;
    const maxFreq =
      frequencyMax !== "" ? Number.parseInt(frequencyMax, 10) : null;
    const kitTerm = normalizeValue(kitSearch).toLowerCase();

    return orders.filter((order) => {
      const info = order?.info || {};
      const status = Number(info.status);
      if (!ALLOWED_STATUSES.has(status)) return false;
      if (status === 2 && !hasCompleteSupervisorChecklist(order)) return false;

      const unidad = info?.["N Unidad"] || "";
      const { machineName, machineDesc } = parseMachineCode(unidad);
      const machineNameUpper = (machineName || "").toUpperCase();
      const machineDescUpper = (machineDesc || "").toUpperCase();

      if (selectMachine) {
        const machineFilterUpper = selectMachine.toUpperCase();
        const machineLabelUpper = (MACHINES[selectMachine] || "").toUpperCase();
        if (machineNameUpper === "FL") {
          const matchesDesc = machineDescUpper.includes(machineFilterUpper);
          const matchesLabel = machineLabelUpper
            ? machineDescUpper.includes(machineLabelUpper)
            : false;
          if (!matchesDesc && !matchesLabel) {
            return false;
          }
        } else if (machineNameUpper !== machineFilterUpper) {
          const matchesDesc = machineDescUpper.includes(machineFilterUpper);
          const matchesLabel = machineLabelUpper
            ? machineDescUpper.includes(machineLabelUpper)
            : false;
          if (matchesDesc || matchesLabel) return true;

          return false;
        }
      }

      if (selectService) {
        const serviceUpper = selectService.toUpperCase();
        if (machineNameUpper !== serviceUpper) {
          return false;
        }
      }

      if (kitTerm) {
        const kitValue = normalizeValue(info?.["Kit de Tareas"]).toLowerCase();
        if (!kitValue.includes(kitTerm)) {
          return false;
        }
      }

      const startRaw =
        info?.["F inicial"] ??
        info?.F_inicial ??
        info?.["Fecha Inicio"] ??
        info?.["Fecha inicio"];
      const startDate = parseChileDateString(startRaw);
      const normalizedStartDate = startDate ? startOfChileDay(startDate) : null;

      if (fromDate) {
        if (!normalizedStartDate || normalizedStartDate < fromDate) {
          return false;
        }
      }

      if (toDate) {
        if (!normalizedStartDate || normalizedStartDate > toDate) {
          return false;
        }
      }

      const frequencyRaw =
        info?.["Frec. Dias"] ??
        info?.FrecDias ??
        info?.["FrecDias"] ??
        info?.frecDias;
      const frequencyValue = Number.parseInt(
        String(frequencyRaw ?? "").trim(),
        10
      );

      if (minFreq !== null) {
        if (!Number.isFinite(frequencyValue) || frequencyValue < minFreq) {
          return false;
        }
      }

      if (maxFreq !== null) {
        if (!Number.isFinite(frequencyValue) || frequencyValue > maxFreq) {
          return false;
        }
      }

      return true;
    });
  }, [
    frequencyMax,
    frequencyMin,
    orders,
    selectMachine,
    selectService,
    startDateFrom,
    startDateTo,
    kitSearch,
  ]);

  const loadOrdersData = useCallback(async () => {
    if (!isMountedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const [ordersList, usersList] = await Promise.all([
        listOrders(),
        listUsers(),
      ]);

      if (!isMountedRef.current) return;

      const ordersArray = Array.isArray(ordersList) ? ordersList : [];
      const usersArray = Array.isArray(usersList) ? usersList : [];
      let finalOrders = ordersArray;

      const expiredUnassignedCodes = ordersArray
        .filter((order) => {
          const info = order?.info || {};
          const assignedCode = info.asignado_a_code;
          const assignedCodeStr =
            assignedCode == null ? "" : String(assignedCode).trim();
          const isAssigned = assignedCodeStr && assignedCodeStr !== "0";
          if (isAssigned) return false;
          if (Number(info.status) === 4) return false;
          return isOrderExpired(order);
        })
        .map((order) => Number(order.code))
        .filter((code) => Number.isFinite(code));

      if (expiredUnassignedCodes.length) {
        try {
          const result = await markOrdersExpired(expiredUnassignedCodes);
          if (isMountedRef.current) {
            if (result?.expiredMarked > 0 || result?.restored > 0) {
              const refreshed = await listOrders();
              if (isMountedRef.current) {
                finalOrders = Array.isArray(refreshed)
                  ? refreshed
                  : ordersArray;
              }
            }
          }
        } catch (markError) {
          console.error(
            "No se pudieron actualizar ordenes expiradas sin asignar",
            markError
          );
        }
      }

      if (!isMountedRef.current) return;
      setOrders(finalOrders);
      setUsers(usersArray);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(
        err?.message || "No se pudieron cargar las ordenes disponibles."
      );
    } finally {
      if (!isMountedRef.current) return;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrdersData();
  }, [loadOrdersData]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handler = () => {
      loadOrdersData();
    };
    window.addEventListener("orders:changed", handler);
    return () => {
      window.removeEventListener("orders:changed", handler);
    };
  }, [loadOrdersData]);

  const toggleMaintainerBucket = (bucketKey) => {
    setExpandedMaintainerBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucketKey)) {
        next.delete(bucketKey);
      } else {
        next.add(bucketKey);
      }
      return next;
    });
  };

  const toggleUnassignedCard = (cardKey) => {
    setExpandedUnassignedCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardKey)) {
        next.delete(cardKey);
      } else {
        next.add(cardKey);
      }
      return next;
    });
  };

  const maintainerCards = useMemo(() => {
    if (!filteredOrders.length) return [];

    const maintainers = users.filter((u) => u.role === "mantenedor");
    const maintainerMap = new Map();

    for (const maint of maintainers) {
      const maintCode = Number(maint.code);
      if (!Number.isFinite(maintCode)) continue;
      maintainerMap.set(maintCode, {
        maintainer: maint,
        statuses: new Map(),
        total: 0,
      });
    }

    for (const order of filteredOrders) {
      const info = order?.info || {};
      const rawAssigned = info.asignado_a_code;
      const assignedCodeStr =
        rawAssigned == null ? "" : String(rawAssigned).trim();
      if (!assignedCodeStr || assignedCodeStr === "0") {
        continue;
      }

      const assignedCode = Number(assignedCodeStr);
      if (!Number.isFinite(assignedCode)) continue;

      if (!maintainerMap.has(assignedCode)) {
        maintainerMap.set(assignedCode, {
          maintainer: {
            code: assignedCode,
            name: info.asignado_a_name || `Mantenedor #${assignedCode}`,
            role: "mantenedor",
            speciality: Number(info["Especialidad_id"]),
          },
          statuses: new Map(),
          total: 0,
        });
      }

      const entry = maintainerMap.get(assignedCode);
      const statusKey = Number(info.status);
      const bucket = entry.statuses.get(statusKey) || [];
      bucket.push(order);
      entry.statuses.set(statusKey, bucket);
      entry.total += 1;
    }

    return Array.from(maintainerMap.values())
      .filter((item) => item.total > 0)
      .sort((a, b) => {
        const nameA = String(a.maintainer?.name || "").toLowerCase();
        const nameB = String(b.maintainer?.name || "").toLowerCase();
        return nameA.localeCompare(nameB, "es");
      });
  }, [filteredOrders, users]);

  /**
   * filtros por MACHINES, fecha de inicio ("F inicial"), SERVICES y frecuencia de dias ("Frec. Dias")
   */

  const unassignedCards = useMemo(() => {
    const result = new Map();
    for (const order of filteredOrders) {
      const info = order?.info || {};
      const rawAssigned = info.asignado_a_code;
      const assignedCodeStr =
        rawAssigned == null ? "" : String(rawAssigned).trim();
      if (assignedCodeStr && assignedCodeStr !== "0") {
        continue;
      }
      const specialityId = Number(info["Especialidad_id"]);
      const key = Number.isFinite(specialityId) ? specialityId : "otros";
      const bucket = result.get(key) || [];
      bucket.push(order);
      result.set(key, bucket);
    }
    return Array.from(result.entries())
      .map(([key, ordersForSpeciality]) => ({
        specialityId: key,
        label: Number.isFinite(key)
          ? getSpecialityLabel(key)
          : "Sin especialidad definida",
        orders: ordersForSpeciality,
      }))
      .sort((a, b) => String(a.label).localeCompare(b.label, "es"));
  }, [filteredOrders]);

  if (loading) {
    return <div className="card p-4">Cargando ordenes...</div>;
  }

  if (error) {
    return (
      <div className="card border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-4">
        <header>
          <h2 className="text-lg font-semibold text-slate-900">
            Filtros de ordenes
          </h2>
          <p className="text-sm text-slate-600">
            Ajusta los filtros para revisar ordenes completadas, anuladas o
            vencidas.
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="orders-filter-machine"
            >
              Maquina
            </label>
            <select
              id="orders-filter-machine"
              className="input w-full"
              value={selectMachine}
              onChange={handleMachineChange}
            >
              <option value="">Todas</option>
              {Object.entries(MACHINES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="orders-filter-service"
            >
              Servicio
            </label>
            <select
              id="orders-filter-service"
              className="input w-full"
              value={selectService}
              onChange={handleServiceChange}
            >
              <option value="">Todos</option>
              {Object.entries(SERVICES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="orders-filter-start-from"
            >
              F. inicio desde
            </label>
            <input
              id="orders-filter-start-from"
              type="date"
              className="input w-full"
              value={startDateFrom}
              onChange={(event) => setStartDateFrom(event.target.value)}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="orders-filter-start-to"
            >
              F. inicio hasta
            </label>
            <input
              id="orders-filter-start-to"
              type="date"
              className="input w-full"
              value={startDateTo}
              onChange={(event) => setStartDateTo(event.target.value)}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="orders-filter-frequency-min"
            >
              Frec. minima (dias)
            </label>
            <input
              id="orders-filter-frequency-min"
              type="number"
              min="0"
              className="input w-full"
              value={frequencyMin}
              onChange={(event) => setFrequencyMin(event.target.value)}
              placeholder="Ej: 7"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="orders-filter-frequency-max"
            >
              Frec. maxima (dias)
            </label>
            <input
              id="orders-filter-frequency-max"
              type="number"
              min="0"
              className="input w-full"
              value={frequencyMax}
              onChange={(event) => setFrequencyMax(event.target.value)}
              placeholder="Ej: 30"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="orders-filter-kit"
            >
              Kit de Tareas
            </label>
            <input
              id="orders-filter-kit"
              type="text"
              className="input w-full"
              value={kitSearch}
              onChange={(event) => setKitSearch(event.target.value)}
              placeholder="Buscar por kit de tareas"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          {hasActiveFilters ? (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleClearFilters}
            >
              Limpiar filtros
            </button>
          ) : null}
        </div>
      </section>
      <section className="space-y-4">
        <header>
          <h2 className="text-xl font-semibold text-slate-900">
            Ordenes por mantenedor
          </h2>
          <p className="text-sm text-slate-600">
            Agrupadas por estado para cada mantenedor con ordenes asignadas.
          </p>
        </header>

        {maintainerCards.length === 0 ? (
          <div className="card p-4 text-sm text-slate-600">
            {hasActiveFilters
              ? "No hay ordenes asignadas que coincidan con los filtros."
              : "No hay ordenes asignadas a mantenedores en este momento."}
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 ">
            {maintainerCards.map(({ maintainer, statuses, total }) => (
              <article
                key={maintainer.code}
                className="card h-full p-4 space-y-4"
              >
                <header className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {maintainer.name || `#${maintainer.code}`}
                    </h3>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Codigo #{maintainer.code}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Especialidad{" "}
                      {getSpecialityLabel(Number(maintainer.speciality))}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {total} orden(es)
                  </span>
                </header>

                <div className="space-y-3">
                  {STATUS_ORDER.filter((statusKey) =>
                    statuses.has(statusKey)
                  ).map((statusKey) => {
                    const ordersForStatus = statuses.get(statusKey) || [];
                    const statusLabel = getStatusLabel(statusKey);
                    const bucketKey = `${maintainer.code}:${statusKey}`;
                    const expanded = expandedMaintainerBuckets.has(bucketKey);
                    const style =
                      STATUS_STYLES[statusKey] || STATUS_STYLES.default;
                    return (
                      <div
                        key={statusKey}
                        className={`rounded border ${style.border} ${style.bg}`}
                      >
                        <button
                          type="button"
                          className={`flex w-full items-center justify-between border-b px-3 py-2 text-left ${style.headerBorder}`}
                          onClick={() => toggleMaintainerBucket(bucketKey)}
                          aria-expanded={expanded}
                        >
                          <h4
                            className={`text-sm font-semibold ${style.title}`}
                          >
                            {statusLabel}
                          </h4>
                          <span
                            className={`flex items-center gap-2 text-xs font-semibold ${style.countText}`}
                          >
                            <span
                              className={`inline-flex rounded px-2 py-0.5 ${style.countBg} ${style.countText}`}
                            >
                              {ordersForStatus.length} orden(es)
                            </span>
                            <span
                              className={`text-base leading-none ${style.countText}`}
                            >
                              {expanded ? "-" : "+"}
                            </span>
                          </span>
                        </button>
                        {expanded && (
                          <ul className="divide-y divide-slate-200">
                            {ordersForStatus.map((order) => {
                              const cancelReasons = Array.isArray(
                                order?.info?.obs_anulada
                              )
                                ? order.info.obs_anulada
                                    .map((item) => String(item || "").trim())
                                    .filter(Boolean)
                                : [];
                              return (
                                <li
                                  key={order.code}
                                  className={`px-3 py-2 text-sm ${style.listText} ${style.bg}`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-xs text-slate-500">
                                      #{order.code}
                                    </span>
                                    <span className="font-mono text-xs text-slate-500">
                                      Frec. Dias {order.info["Frec. Dias"]}
                                    </span>
                                    <span className="truncate text-right text-xs text-slate-500">
                                      {order.info?.["N Unidad"] ||
                                        "Unidad sin dato"}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-sm">
                                    {order.info?.Descripcion ||
                                      "Sin descripcion"}
                                  </p>
                                  <p className="mt-1 text-sm">
                                    Kit de Tareas{" "}
                                    {order.info["Kit de Tareas"] || " "}
                                  </p>

                                  {statusKey === 3 && cancelReasons.length ? (
                                    <p
                                      className={`mt-1 text-xs ${style.metaText}`}
                                    >
                                      Motivo anulacion:{" "}
                                      {cancelReasons.join("; ")}
                                    </p>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <header>
          <h2 className="text-xl font-semibold text-slate-900">
            Ordenes no asignadas
          </h2>
          <p className="text-sm text-slate-600">
            Agrupadas por especialidad para facilitar la asignacion pendiente.
          </p>
        </header>

        {unassignedCards.length === 0 ? (
          <div className="card p-4 text-sm text-slate-600">
            {hasActiveFilters
              ? "No hay ordenes sin asignar que coincidan con los filtros."
              : "Todas las ordenes tienen mantenedor asignado."}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {unassignedCards.map(
              ({ specialityId, label, orders: ordersForSpeciality }) => (
                <article
                  key={specialityId}
                  className="card h-full p-4 space-y-3"
                >
                  <header className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">
                        {label}
                      </h3>
                    </div>
                    <button
                      type="button"
                      className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800"
                      onClick={() => toggleUnassignedCard(String(specialityId))}
                      aria-expanded={expandedUnassignedCards.has(
                        String(specialityId)
                      )}
                    >
                      {ordersForSpeciality.length} orden(es){" "}
                      {expandedUnassignedCards.has(String(specialityId))
                        ? "-"
                        : "+"}
                    </button>
                  </header>
                  {expandedUnassignedCards.has(String(specialityId)) && (
                    <ul className="divide-y divide-slate-200">
                      {ordersForSpeciality.map((order) => {
                        const status = Number(order.info?.status);
                        const statusLabel = getStatusLabel(status);
                        const style =
                          STATUS_STYLES[status] || STATUS_STYLES.default;
                        const cancelReasons = Array.isArray(
                          order?.info?.obs_anulada
                        )
                          ? order.info.obs_anulada
                              .map((item) => String(item || "").trim())
                              .filter(Boolean)
                          : [];
                        return (
                          <li
                            key={order.code}
                            className={`px-3 py-2 text-sm ${style.listText} ${style.bg}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs text-slate-500">
                                #{order.code}
                              </span>
                              <span className="truncate text-xs text-slate-500">
                                {order.info?.["N Unidad"] || "Unidad sin dato"}
                              </span>
                            </div>
                            <p className="mt-1 text-sm">
                              {order.info?.Descripcion || "Sin descripcion"}
                            </p>
                            <p className="mt-1 text-sm">
                              Frec. Dias {order.info["Frec. Dias"] || " "}
                            </p>
                            <p className="mt-1 text-sm">
                              Kit de Tareas {order.info["Kit de Tareas"] || " "}
                            </p>
                            <p className={`text-xs ${style.metaText}`}>
                              Estado:{" "}
                              <span
                                className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${style.badgeBg} ${style.badgeText}`}
                              >
                                {statusLabel}
                              </span>
                            </p>
                            {status === 3 && cancelReasons.length ? (
                              <p className={`mt-1 text-xs ${style.metaText}`}>
                                Motivo anulacion: {cancelReasons.join("; ")}
                              </p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </article>
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}

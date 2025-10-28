/**
 * Modulo del supervisor que permite ver las ordenes asignadas y reasignarlas a otros usuarios.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import {
  bulkUpsertOrders,
  fetchOrdersBySpeciality,
  getOrderExpirationDetails,
  listUsers,
  cancelOrder,
} from "@/utils/APIdb";
import { usePeer } from "@/p2p/PeerContext";
import { formatChileDate, startOfChileDay } from "@/utils/timezone";

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

const PAGE_SIZE = 20;

const TASK_STATUS_LABEL = {
  0: "Pendiente",
  1: "En progreso",
  2: "Completada",
  3: "Anulada",
};

const ORDER_CANCELLED = {
  0: "NO MANTENCION",
  1: "FALTA REPUESTO",
  2: "OTRO",
};
const regexMachine = /^(?<code>\w+)\s(?<name>[\w-]+)(\s-\s(?<desc>.+))?$/;

const parseMachineCode = (value) => {
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
};

export default function ReassignOrder() {
  const { user } = useAuth();
  const { broadcastSync, sendOrdersToUser } = usePeer() ?? {};

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [maintainers, setMaintainers] = useState([]);
  const [maintainersError, setMaintainersError] = useState(null);

  const [selectedMaintainer, setSelectedMaintainer] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState(null);

  const [selectedOrders, setSelectedOrders] = useState([]);
  const [expandedOrderCode, setExpandedOrderCode] = useState(null);

  const [cancelModal, setCancelModal] = useState({
    open: false,
    orderCodes: [],
  });
  const [canceling, setCanceling] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectMachine, setSelectMachine] = useState("");
  const [selectService, setSelectService] = useState("");
  const [currentPage, setCurrentPage] = useState(0);

  const loadOrders = useCallback(async () => {
    if (!user?.speciality) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchOrdersBySpeciality(user.speciality);
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setOrders([]);
      setError(err?.message || "No se pudieron obtener las órdenes asignadas.");
    } finally {
      setLoading(false);
    }
  }, [user?.speciality]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handler = () => loadOrders();
    window.addEventListener("orders:changed", handler);
    return () => {
      window.removeEventListener("orders:changed", handler);
    };
  }, [loadOrders]);

  useEffect(() => {
    if (!user) {
      setMaintainers([]);
      setMaintainersError(null);
      return;
    }

    let cancelled = false;
    setMaintainersError(null);

    listUsers()
      .then((users) => {
        if (cancelled) return;
        const supervisorSpeciality = user.speciality;
        const hasSpeciality =
          supervisorSpeciality !== undefined &&
          supervisorSpeciality !== null &&
          supervisorSpeciality !== "";

        if (!hasSpeciality) {
          setMaintainers([]);
          setMaintainersError(
            "Configura tu especialidad para listar mantenedores disponibles."
          );
          return;
        }

        const maintList = users.filter((candidate) => {
          if (candidate.role !== "mantenedor" || candidate.active === false) {
            return false;
          }
          const speciality = candidate.speciality;
          if (
            speciality === undefined ||
            speciality === null ||
            speciality === ""
          ) {
            return false;
          }
          return String(speciality) === String(supervisorSpeciality);
        });

        setMaintainers(maintList);
        setMaintainersError(
          maintList.length === 0
            ? "No hay mantenedores activos con tu especialidad."
            : null
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setMaintainersError(
          err?.message || "No se pudo cargar la lista de mantenedores."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!selectedMaintainer) return;
    const exists = maintainers.some(
      (maint) => Number(maint.code) === Number(selectedMaintainer.code)
    );
    if (!exists) {
      setSelectedMaintainer(null);
    }
  }, [maintainers, selectedMaintainer]);

  useEffect(() => {
    if (assignError && selectedMaintainer) {
      setAssignError(null);
    }
  }, [assignError, selectedMaintainer]);

  useEffect(() => {
    setCurrentPage(0);
    setSelectedOrders([]);
  }, [selectMachine, selectService, searchTerm]);

  useEffect(() => {
    setSearchTerm("");
    setSelectMachine("");
    setSelectService("");
    setSelectedOrders([]);
  }, [user?.code]);

  const filterAndDecorateOrders = useMemo(() => {
    const supervisorCode = Number(user?.code);
    const today = startOfChileDay(new Date());
    const todayMs = today ? today.getTime() : Date.now();
    const msPerDay = 86400000;

    return orders
      .filter((order) => {
        const info = order?.info || {};
        const status = Number(info.status);
        if (status === 2 || status === 3 || status === 4) {
          return false;
        }
        const assignedCode = Number(info.asignado_a_code);
        if (!Number.isFinite(assignedCode)) {
          return false;
        }
        if (Number.isFinite(supervisorCode)) {
          const assignedBy = Number(info.asignado_por_code);
          if (assignedBy !== supervisorCode) {
            return false;
          }
        }
        return true;
      })
      .filter((order) => {
        if (!selectMachine) return true;
        const unidad = order?.info?.["N Unidad"] || "";
        const { machineName, machineDesc } = parseMachineCode(unidad);
        if (machineName === "FL") {
          return (
            machineDesc.includes(selectMachine) ||
            machineDesc.includes(MACHINES[selectMachine])
          );
        }
        return machineName === selectMachine;
      })
      .filter((order) => {
        if (!selectService) return true;
        const unidad = order?.info?.["N Unidad"] || "";
        const { machineName } = parseMachineCode(unidad);
        return machineName === selectService;
      })
      .filter((order) => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return true;
        const unidad = String(order?.info?.["N Unidad"] ?? "").toLowerCase();
        const code = String(order?.code ?? "").toLowerCase();
        const descripcion = String(
          order?.info?.Descripcion ?? ""
        ).toLowerCase();
        return (
          unidad.includes(term) ||
          code.includes(term) ||
          descripcion.includes(term)
        );
      })
      .map((order) => {
        const expirationDetails = getOrderExpirationDetails(order);
        const dueDate = expirationDetails?.dueDate || null;
        const expirationDate = expirationDetails?.expirationDate || null;

        const computeDays = (date) =>
          date instanceof Date
            ? Math.ceil((date.getTime() - todayMs) / msPerDay)
            : null;

        const daysToDue = computeDays(dueDate);
        const daysToExpiration = computeDays(expirationDate);
        const nearDue = Number.isFinite(daysToExpiration)
          ? daysToExpiration <= 3
          : false;

        return {
          order,
          expirationDetails,
          daysToDue,
          daysToExpiration,
          isNearDue: nearDue,
        };
      })
      .sort((a, b) => {
        if (a.isNearDue !== b.isNearDue) {
          return a.isNearDue ? -1 : 1;
        }
        const expDiff =
          (Number.isFinite(a.daysToExpiration)
            ? a.daysToExpiration
            : Number.POSITIVE_INFINITY) -
          (Number.isFinite(b.daysToExpiration)
            ? b.daysToExpiration
            : Number.POSITIVE_INFINITY);
        if (expDiff !== 0) return expDiff;

        const priorityA = Number(a.order?.info?.prioridad ?? Infinity);
        const priorityB = Number(b.order?.info?.prioridad ?? Infinity);
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        return String(a.order?.code ?? "").localeCompare(
          String(b.order?.code ?? "")
        );
      });
  }, [orders, selectMachine, selectService, searchTerm, user?.code]);

  useEffect(() => {
    if (!selectedOrders.length) return;
    const keepCodes = new Set(
      filterAndDecorateOrders.map((item) => Number(item.order?.code))
    );
    const filteredSelection = selectedOrders.filter((code) =>
      keepCodes.has(Number(code))
    );
    if (filteredSelection.length !== selectedOrders.length) {
      setSelectedOrders(filteredSelection);
    }
  }, [filterAndDecorateOrders, selectedOrders]);

  useEffect(() => {
    if (expandedOrderCode === null) return;
    const exists = filterAndDecorateOrders.some(
      (item) => Number(item.order?.code) === Number(expandedOrderCode)
    );
    if (!exists) {
      setExpandedOrderCode(null);
    }
  }, [expandedOrderCode, filterAndDecorateOrders]);

  const totalPages = Math.ceil(filterAndDecorateOrders.length / PAGE_SIZE) || 0;

  useEffect(() => {
    if (!totalPages) {
      if (currentPage !== 0) setCurrentPage(0);
      return;
    }
    if (currentPage > totalPages - 1) {
      setCurrentPage(totalPages - 1);
    }
  }, [currentPage, totalPages]);

  const paginatedOrders = useMemo(() => {
    if (!filterAndDecorateOrders.length) return [];
    const start = currentPage * PAGE_SIZE;
    return filterAndDecorateOrders.slice(start, start + PAGE_SIZE);
  }, [filterAndDecorateOrders, currentPage]);

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
  };

  const handleMachineChange = (event) => {
    setSelectService("");
    setSelectMachine(event.target.value);
  };

  const handleServiceChange = (event) => {
    setSelectMachine("");
    setSelectService(event.target.value);
  };

  const handleMaintainerChange = (event) => {
    const code = Number(event.target.value);
    if (!Number.isFinite(code)) {
      setSelectedMaintainer(null);
      return;
    }
    const maint = maintainers.find((m) => Number(m.code) === code) || null;
    setSelectedMaintainer(maint);
  };

  const toggleOrderSelection = (orderCode) => {
    const numericCode = Number(orderCode);
    if (!Number.isFinite(numericCode)) return;
    setSelectedOrders((prev) => {
      if (prev.includes(numericCode)) {
        return prev.filter((code) => code !== numericCode);
      }
      return [...prev, numericCode];
    });
  };

  const handlePreviousPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    if (!totalPages) return;
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  const openCancelModal = useCallback((orderCodes) => {
    const numericCodes = Array.from(
      new Set(
        (orderCodes || [])
          .map((code) => Number(code))
          .filter((code) => Number.isFinite(code))
      )
    );
    if (!numericCodes.length) return;
    setCancelModal({ open: true, orderCodes: numericCodes });
  }, []);

  const closeCancelModal = useCallback(() => {
    setCancelModal({ open: false, orderCodes: [] });
  }, []);

  const handleCancelSelected = () => {
    openCancelModal(selectedOrders);
  };

  const assignOrders = useCallback(
    async (orderCodes) => {
      if (!selectedMaintainer) {
        setAssignError("Selecciona un mantenedor destino antes de reasignar.");
        return;
      }

      const codesSet = new Set(
        (orderCodes || [])
          .map((code) => Number(code))
          .filter((code) => Number.isFinite(code))
      );

      if (!codesSet.size) return;

      const maint = selectedMaintainer;
      const maintCode = Number(maint.code);

      setAssigning(true);
      setAssignError(null);

      try {
        const previousMaintainers = new Set();

        const updates = orders
          .filter((order) => codesSet.has(Number(order?.code)))
          .map((order) => {
            const info = order?.info || {};
            const currentAssigned = Number.parseInt(
              String(info.asignado_a_code ?? "").trim(),
              10
            );

            if (Number.isFinite(currentAssigned)) {
              if (currentAssigned === maintCode) {
                return null;
              }
              previousMaintainers.add(currentAssigned);
            }
            return {
              ...order,
              info: {
                ...info,
                asignado_a_code: maintCode,
                asignado_a_name: maint.name,
                asignado_por_code: user?.code ?? null,
                asignado_por_name: user?.name ?? null,
              },
            };
          })
          .filter(Boolean);

        if (!updates.length) {
          setAssignError(
            "Las órdenes seleccionadas ya están asignadas a ese mantenedor."
          );
          return;
        }

        await bulkUpsertOrders(updates);

        if (typeof broadcastSync === "function") {
          await broadcastSync();
        }

        if (typeof sendOrdersToUser === "function") {
          if (Number.isFinite(maintCode)) {
            await sendOrdersToUser(maintCode);
          }
          const previousTargets = Array.from(previousMaintainers).filter(
            (code) => Number.isFinite(code) && code !== maintCode
          );
          for (const targetCode of previousTargets) {
            await sendOrdersToUser(targetCode);
          }
        }

        const updatesMap = new Map(
          updates.map((order) => [Number(order.code), order])
        );

        setOrders((prev) =>
          prev.map((order) => {
            const numeric = Number(order?.code);
            if (!updatesMap.has(numeric)) {
              return order;
            }
            return updatesMap.get(numeric);
          })
        );

        setSelectedOrders((prev) =>
          prev.filter((code) => !codesSet.has(Number(code)))
        );
        setExpandedOrderCode((prev) =>
          prev !== null && codesSet.has(Number(prev)) ? null : prev
        );
      } catch (err) {
        setAssignError(
          err?.message || "No se pudieron reasignar las órdenes seleccionadas."
        );
      } finally {
        setAssigning(false);
      }
    },
    [broadcastSync, orders, selectedMaintainer, sendOrdersToUser, user]
  );

  const handleReassignSelected = () => {
    assignOrders(selectedOrders);
  };

  const handleReassignSingle = (orderCode) => {
    assignOrders([orderCode]);
  };

  const handleConfirmCancellation = useCallback(
    async ({ reasonKey, comment, orderCodes }) => {
      const reasonLabel = ORDER_CANCELLED[reasonKey];
      if (!reasonLabel) {
        throw new Error("Selecciona un motivo de anulación.");
      }

      const trimmedComment = comment.trim();
      if (!trimmedComment) {
        throw new Error("Agrega un comentario para anular la orden.");
      }

      const numericCodes = Array.from(
        new Set(
          (orderCodes || [])
            .map((code) => Number(code))
            .filter((code) => Number.isFinite(code))
        )
      );

      if (!numericCodes.length) {
        throw new Error("No hay órdenes seleccionadas para anular.");
      }

      const affectedMaintainers = new Set();
      const updatedOrders = new Map();
      const codesSet = new Set(numericCodes);

      setCanceling(true);

      try {
        for (const numeric of numericCodes) {
          const current = orders.find(
            (order) => Number(order?.code) === Number(numeric)
          );
          if (current) {
            const assigned = Number(current?.info?.asignado_a_code);
            if (Number.isFinite(assigned)) {
              affectedMaintainers.add(assigned);
            }
          }

          const updated = await cancelOrder(
            numeric,
            reasonLabel,
            trimmedComment
          );
          if (updated) {
            updatedOrders.set(Number(updated.code), updated);
          }
        }

        if (typeof broadcastSync === "function") {
          await broadcastSync();
        }

        if (typeof sendOrdersToUser === "function") {
          const targets = Array.from(affectedMaintainers).filter((code) =>
            Number.isFinite(code)
          );
          for (const code of targets) {
            await sendOrdersToUser(code);
          }
        }

        setOrders((prev) =>
          prev.map((order) => {
            const numeric = Number(order?.code);
            if (!updatedOrders.has(numeric)) return order;
            return updatedOrders.get(numeric);
          })
        );

        setSelectedOrders((prev) =>
          prev.filter((code) => !codesSet.has(Number(code)))
        );
        setExpandedOrderCode((prev) =>
          prev !== null && codesSet.has(Number(prev)) ? null : prev
        );

        await loadOrders();
        return true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "No se pudieron anular las órdenes seleccionadas.";
        throw new Error(message);
      } finally {
        setCanceling(false);
      }
    },
    [broadcastSync, loadOrders, orders, sendOrdersToUser]
  );

  const toggleTasksVisibility = (orderCode) => {
    const numeric = Number(orderCode);
    if (!Number.isFinite(numeric)) return;
    setExpandedOrderCode((prev) => (Number(prev) === numeric ? null : numeric));
  };

  const getTaskStatusLabel = (status) => {
    const numeric = Number(status);
    return TASK_STATUS_LABEL[numeric] ?? "Sin estado";
  };

  if (!user) {
    return (
      <div className="card p-4 text-sm text-slate-600">
        Debes iniciar sesión como supervisor para reasignar órdenes.
      </div>
    );
  }

  if (loading) {
    return <div className="card p-4">Cargando órdenes asignadas...</div>;
  }

  if (error) {
    return (
      <div className="card p-4 text-sm text-red-700">
        Error al cargar órdenes: {error}
      </div>
    );
  }

  if (!orders.length) {
    return (
      <div className="card p-4 text-sm text-slate-600">
        No hay órdenes asignadas en tu especialidad.
      </div>
    );
  }

  const hasOrders = filterAndDecorateOrders.length > 0;

  return (
    <div className="space-y-5">
      <section className="card p-4 space-y-4">
        <header className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="sr-only" htmlFor="reassign-orders-search">
              Buscar órdenes
            </label>
            <div className="relative">
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 24 24"
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                id="reassign-orders-search"
                type="text"
                placeholder="Buscar por código o unidad"
                className="input w-full pl-9"
                value={searchTerm}
                onChange={handleSearchChange}
              />
            </div>
          </div>
          <div className="min-w-[200px]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Máquina
            </label>
            <select
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
          <div className="min-w-[200px]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Servicio
            </label>
            <select
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
        </header>

        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Reasignar órdenes seleccionadas
            </h3>
            <p className="text-sm text-slate-600">
              Elige un mantenedor destino y reasigna una o varias órdenes a la
              vez.
            </p>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center sticky top-100 md:top-40">
            <select
              className="input"
              value={selectedMaintainer?.code || ""}
              onChange={handleMaintainerChange}
            >
              <option value="">Seleccionar mantenedor</option>
              {maintainers.map((maint) => (
                <option key={maint.code} value={maint.code}>
                  #{maint.code} - {maint.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleReassignSelected}
              disabled={
                assigning || selectedOrders.length === 0 || !selectedMaintainer
              }
            >
              {assigning
                ? "Reasignando..."
                : `Reasignar (${selectedOrders.length})`}
            </button>
            <button
              type="button"
              className="btn btn-outline text-red-600 border-red-500 hover:bg-red-50"
              onClick={handleCancelSelected}
              disabled={canceling || selectedOrders.length === 0}
            >
              {canceling ? "Anulando..." : `Anular (${selectedOrders.length})`}
            </button>
          </div>
        </div>

        {assignError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {assignError}
          </div>
        ) : null}

        {maintainersError ? (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            {maintainersError}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        {!hasOrders ? (
          <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No se encontraron órdenes que coincidan con los filtros actuales.
            <button
              type="button"
              className="btn btn-outline text-red-600 border-red-500 hover:bg-red-50"
              onClick={handleCancelSelected}
              disabled={canceling || selectedOrders.length === 0}
            >
              {canceling ? "Anulando..." : `Anular (${selectedOrders.length})`}
            </button>
          </div>
        ) : (
          paginatedOrders.map((item) => {
            const {
              order,
              expirationDetails,
              daysToDue,
              daysToExpiration,
              isNearDue,
            } = item;
            const numericCode = Number(order?.code);
            const isSelected = selectedOrders.includes(numericCode);
            const isExpanded = Number(expandedOrderCode) === numericCode;
            const hasTasks =
              Array.isArray(order?.tasks?.data) && order.tasks.data.length > 0;

            const dueLabel = expirationDetails?.dueDate
              ? formatChileDate(expirationDetails.dueDate)
              : "N/D";
            const expirationLabel = expirationDetails?.expirationDate
              ? formatChileDate(expirationDetails.expirationDate)
              : "N/D";
            const expirationSummary = Number.isFinite(daysToExpiration)
              ? daysToExpiration < 0
                ? `Expiró hace ${Math.abs(daysToExpiration)} día(s)`
                : daysToExpiration === 0
                ? "Expira hoy"
                : `Expira en ${daysToExpiration} día(s)`
              : "Sin fecha de expiración";

            return (
              <article
                key={order?.code}
                className={`overflow-hidden rounded-lg border ${
                  isNearDue
                    ? "border-orange-400 ring-1 ring-orange-200"
                    : isSelected
                    ? "border-blue-500 ring-1 ring-blue-200"
                    : "border-slate-200"
                } bg-white transition-shadow`}
              >
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isSelected}
                      onChange={() => toggleOrderSelection(order?.code)}
                    />
                    <span className="rounded bg-slate-100 px-2 py-1 font-mono text-sm font-semibold text-slate-800">
                      #{order?.code}
                    </span>
                    {isNearDue ? (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                          className="size-6 inline-block mr-1 h-4 w-4 text-orange-600"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                          />
                        </svg>
                        proximo vencimiento
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-start gap-1 text-xs text-slate-500 md:items-end">
                    <span>
                      Mantenedor actual: {order?.info?.asignado_a_name || "N/A"}
                    </span>
                    <span>
                      Asignado por: {order?.info?.asignado_por_name || "N/A"}
                    </span>
                    <span>
                      Frecuencia: {order?.info?.["Frec. Dias"] ?? "N/D"} días
                    </span>
                  </div>
                </header>

                <div className="space-y-3 px-4 py-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">
                    Descripción: {order?.info?.Descripcion || "Sin descripción"}
                  </p>
                  <p>Unidad: {order?.info?.["N Unidad"] || "Sin unidad"}</p>
                  <div className="grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                    <span>Fecha inicio: {order?.info?.["F inicial"]}</span>
                    <span>Fecha objetivo: {dueLabel}</span>
                    <span>Expira: {expirationLabel}</span>

                    <span>{expirationSummary}</span>
                  </div>
                </div>

                {isExpanded && hasTasks ? (
                  <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
                    <ul className="space-y-2 text-sm text-slate-700">
                      {order.tasks.data.map((task, index) => {
                        const maintObs = task?.obs_assigned_to?.trim();
                        return (
                          <li
                            key={`${order?.code}-task-${index}`}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                          >
                            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                              <div>
                                <p className="font-medium text-slate-900">
                                  Tarea {index + 1}:{" "}
                                  {task?.Descripcion || "Sin descripción"}
                                </p>
                                <p className="text-xs text-slate-500">
                                  Taller: {task?.Taller || "N/A"}
                                </p>
                              </div>
                              <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                                {getTaskStatusLabel(task?.status)}
                              </span>
                            </div>
                            {maintObs ? (
                              <p className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600">
                                Observación: {maintObs}
                              </p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    Tareas: {order?.tasks?.data?.length ?? 0} | Protocolos:{" "}
                    {order?.protocolos?.length ?? 0}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm border-red-500 text-red-600 hover:bg-red-50"
                      onClick={() => openCancelModal([order?.code])}
                    >
                      Anular orden
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => toggleTasksVisibility(order?.code)}
                      disabled={!hasTasks}
                    >
                      {isExpanded ? "Ocultar tareas" : "Ver tareas"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => handleReassignSingle(order?.code)}
                      disabled={assigning || !selectedMaintainer}
                    >
                      {assigning ? "Reasignando..." : "Reasignar"}
                    </button>
                  </div>
                </footer>
              </article>
            );
          })
        )}
      </section>

      {hasOrders ? (
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            className="btn btn-outline"
            onClick={handlePreviousPage}
            disabled={currentPage === 0}
          >
            Anterior
          </button>
          <span className="text-sm text-slate-600">
            Página {filterAndDecorateOrders.length === 0 ? 0 : currentPage + 1}{" "}
            de {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleNextPage}
            disabled={!totalPages || currentPage >= totalPages - 1}
          >
            Siguiente
          </button>
        </div>
      ) : null}

      <CancelOrdersModal
        open={cancelModal.open}
        orderCodes={cancelModal.orderCodes}
        busy={canceling}
        onClose={closeCancelModal}
        onConfirm={handleConfirmCancellation}
      />
    </div>
  );
}

function CancelOrdersModal({ open, orderCodes, busy, onClose, onConfirm }) {
  const [reasonKey, setReasonKey] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setReasonKey("");
      setComment("");
      setError(null);
    }
  }, [open, orderCodes]);

  if (!open) return null;

  const handleReasonChange = (event) => {
    setReasonKey(event.target.value);
    if (error) {
      setError(null);
    }
  };

  const handleCommentChange = (event) => {
    setComment(event.target.value);
    if (error) {
      setError(null);
    }
  };

  const handleConfirm = async () => {
    if (!Object.prototype.hasOwnProperty.call(ORDER_CANCELLED, reasonKey)) {
      setError("Selecciona un motivo de anulación.");
      return;
    }

    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      setError("Agrega un comentario para anular la orden.");
      return;
    }

    try {
      await onConfirm({
        reasonKey,
        comment: trimmedComment,
        orderCodes,
      });
      onClose();
    } catch (err) {
      setError(
        err?.message || "No se pudieron anular las órdenes seleccionadas."
      );
    }
  };

  const modalTitle =
    orderCodes.length > 1
      ? `Anular ${orderCodes.length} órdenes`
      : `Anular orden #${orderCodes[0] ?? ""}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <header className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-slate-900">{modalTitle}</h2>
          <p className="mt-1 text-sm text-slate-600">
            Esta acción marcará las órdenes como anuladas con el motivo
            seleccionado.
          </p>
        </header>
        <div className="space-y-4 px-4 py-4">
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="reassign-cancel-reason"
            >
              Motivo de anulación
            </label>
            <select
              id="reassign-cancel-reason"
              className="input w-full"
              value={reasonKey}
              onChange={handleReasonChange}
              disabled={busy}
            >
              <option value="">Seleccionar motivo</option>
              {Object.entries(ORDER_CANCELLED).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="reassign-cancel-comment"
            >
              Comentario
            </label>
            <textarea
              id="reassign-cancel-comment"
              className="input w-full resize-y"
              rows={3}
              placeholder="Describe brevemente la razón de la anulación"
              value={comment}
              onChange={handleCommentChange}
              disabled={busy}
            />
          </div>
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">
              Órdenes seleccionadas:
            </span>
            <span className="ml-1 font-mono">
              {orderCodes.map((code) => `#${code}`).join(", ")}
            </span>
          </div>
        </div>
        <footer className="flex justify-end gap-3 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            disabled={busy}
          >
            Cerrar
          </button>
          <button
            type="button"
            className="btn bg-red-600 text-white hover:bg-red-700"
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? "Anulando..." : "Confirmar anulación"}
          </button>
        </footer>
      </div>
    </div>
  );
}

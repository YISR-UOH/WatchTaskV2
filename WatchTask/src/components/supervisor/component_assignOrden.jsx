/**
 * Muestra las ordenes sin asignar y las que no estan vencidas
 * ordenadas por prioridad y frecuencia
 * orden.info.status != 2 (completada), 3 (anulada), 4 (vencida)
 *
 * Permite filtrar por maquina, esta dado por orden.info["N Unidad"], ej:
 * orden.info["N Unidad"] = "ALI000997 KBA - ALIMENTADOR"
 * Function parseMachineCode (orden.info["N Unidad"]) = extrae el codigo de maquina "ALI000997", la maquina "KBA" y la descripcion "ALIMENTADOR"
 * return { machineCode: "ALI000997", machineName: "KBA", machineDesc: "ALIMENTADOR" }
 * usar regex para filtrar por codigo de maquina o nombre de maquina
 *
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import {
  bulkUpsertOrders,
  fetchOrdersBySpeciality,
  listUsers,
  cancelOrder,
} from "@/utils/APIdb";
import { usePeer } from "@/p2p/PeerContext";
import { unstable_Activity, Activity as ActivityStable } from "react";
let Activity = ActivityStable ?? unstable_Activity;
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
const ORDER_CANCELLED = {
  0: "NO MANTENCION",
  1: "FALTA REPUESTO",
  2: "OTRO",
};
const N_viewOrders = 20;

export default function AssignOrden() {
  const { user } = useAuth();
  const { broadcastSync, sendOrdersToUser } = usePeer() ?? {};
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectMachine, setSelectMachine] = useState("");
  const [selectServices, setSelectServices] = useState("");
  const [hiddenTasks, setHiddenTasks] = useState(false);
  const [actualOrder, setActualOrder] = useState(null);
  const [taskActionError, setTaskActionError] = useState(null);
  const [hiddenProtocolos, setHiddenProtocolos] = useState(false);
  const [selectedProtocolIndex, setSelectedProtocolIndex] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [maintainers, setMaintainers] = useState([]);
  const [maintainersError, setMaintainersError] = useState(null);
  const [selectedMaintainer, setSelectedMaintainer] = useState(null);
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState(null);
  const [cancelModal, setCancelModal] = useState({
    open: false,
    orderCodes: [],
  });
  const [canceling, setCanceling] = useState(false);

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
      setCurrentPage(0);
    } catch (err) {
      setError(
        err?.message || "No se pudieron obtener las Ordenes disponibles."
      );
    } finally {
      setLoading(false);
    }
  }, [user?.speciality]);
  const selectTask = (orderCode) => {
    if (actualOrder == orderCode) {
      setHiddenTasks(!hiddenTasks);
      setHiddenProtocolos(false);
      setTaskActionError(null);
      return;
    }
    setActualOrder(orderCode);
    setHiddenTasks(true);
    setHiddenProtocolos(false);
    setTaskActionError(null);
  };
  const selectProtocol = (orderCode) => {
    setSelectedProtocolIndex(0);
    if (actualOrder == orderCode) {
      setHiddenProtocolos(!hiddenProtocolos);
      setHiddenTasks(false);
      setTaskActionError(null);
      return;
    }
    setActualOrder(orderCode);
    setHiddenProtocolos(true);
    setHiddenTasks(false);
  };
  const handleChangeServices = (e) => {
    setSelectMachine("");
    setSelectServices(e.target.value);
  };
  const handleChangeMachine = (e) => {
    setSelectServices("");
    setSelectMachine(e.target.value);
  };
  useEffect(() => {
    setCurrentPage(0);
  }, [selectMachine, selectServices, searchTerm]);
  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!user) {
      setMaintainers([]);
      setMaintainersError(null);
      return;
    }

    let cancelled = false;
    listUsers()
      .then((users) => {
        if (cancelled) return;
        const supervisorSpeciality = user.speciality;
        const hasSupervisorSpeciality =
          supervisorSpeciality !== undefined &&
          supervisorSpeciality !== null &&
          supervisorSpeciality !== "";

        if (!hasSupervisorSpeciality) {
          setMaintainers([]);
          setMaintainersError(
            "Configura la especialidad del supervisor para listar mantenedores."
          );
          return;
        }

        const maint = users.filter((u) => {
          if (u.role !== "mantenedor" || u.active === false) return false;
          const maintSpeciality = u.speciality;
          if (
            maintSpeciality === undefined ||
            maintSpeciality === null ||
            maintSpeciality === ""
          )
            return false;
          return String(maintSpeciality) === String(supervisorSpeciality);
        });

        setMaintainers(maint);
        setMaintainersError(
          maint.length === 0
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
    const stillExists = maintainers.some(
      (m) => Number(m.code) === Number(selectedMaintainer.code)
    );
    if (!stillExists) {
      setSelectedMaintainer(null);
    }
  }, [maintainers, selectedMaintainer]);

  useEffect(() => {
    if (assignError && selectedMaintainer) {
      setAssignError(null);
    }
  }, [assignError, selectedMaintainer]);

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

  const handleCancelSingle = (orderCode) => {
    openCancelModal([orderCode]);
  };

  /**
   * Calcular las ordenes que no estan completadas, anuladas o vencidas
   * status != 2 (completada), 3 (anulada), 4 (vencida)
   * y ordenarlas por prioridad y frecuencia
   */

  const filterStatus = (orders) => {
    const filtered = orders.filter((o) => {
      const status = Number(o?.info?.status);
      return status !== 2 && status !== 3 && status !== 4;
    });
    return filtered.sort((a, b) => {
      const priorityA = a?.info?.prioridad ?? 0;
      const priorityB = b?.info?.prioridad ?? 0;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      const freqA = a?.info["Frec. Dias"] ?? 0;
      const freqB = b?.info["Frec. Dias"] ?? 0;
      return freqA - freqB;
    });
  };
  const regexMachine = /^(?<code>\w+)\s(?<name>[\w-]+)(\s-\s(?<desc>.+))?$/;
  const parseMachineCode = (nUnidad) => {
    const match = nUnidad.match(regexMachine);
    if (match && match.groups) {
      return {
        machineCode: match.groups.code,
        machineName: match.groups.name,
        machineDesc: match.groups.desc || "",
      };
    }
    return { machineCode: "", machineName: "", machineDesc: "" };
  };
  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value.toLowerCase());
  };

  const filteredOrders = useMemo(() => {
    const base = filterStatus(orders).filter((o) => {
      const assigned = o?.info?.asignado_a_code;
      return assigned === undefined || assigned === null || assigned === "";
    });
    return base
      .filter((o) => {
        if (selectMachine !== "") {
          const nUnidad = o?.info?.["N Unidad"] || "";
          const { machineName: name, machineDesc: desc } =
            parseMachineCode(nUnidad);
          if (
            name === "FL" &&
            (desc.includes(selectMachine) ||
              desc.includes(MACHINES[selectMachine]))
          )
            return true;
          return name === selectMachine;
        }
        if (selectServices !== "") {
          const nUnidad = o?.info?.["N Unidad"] || "";
          const { machineName: name } = parseMachineCode(nUnidad);
          return name === selectServices;
        }
        return true;
      })
      .filter((o) => {
        if (searchTerm === "") return true;
        const nUnidad = String(o?.info["N Unidad"] ?? "").toLowerCase();
        const orderId = String(o?.id ?? "").toLowerCase();
        const orderCode = String(o?.code ?? "").toLowerCase();
        const descripcion = String(o?.info?.Descripcion ?? "").toLowerCase();
        return (
          nUnidad.includes(searchTerm) ||
          orderId.includes(searchTerm) ||
          orderCode.includes(searchTerm) ||
          descripcion.includes(searchTerm)
        );
      });
  }, [orders, selectMachine, selectServices, searchTerm]);

  const totalPages = Math.ceil(filteredOrders.length / N_viewOrders);

  useEffect(() => {
    if (totalPages === 0) {
      if (currentPage !== 0) setCurrentPage(0);
      return;
    }
    if (currentPage > totalPages - 1) {
      setCurrentPage(totalPages - 1);
    }
  }, [currentPage, totalPages]);

  const paginatedOrders = useMemo(() => {
    const start = currentPage * N_viewOrders;
    return filteredOrders.slice(start, start + N_viewOrders);
  }, [filteredOrders, currentPage]);

  useEffect(() => {
    setSelectedOrders((prev) => {
      if (!prev.length) return prev;
      const keep = prev.filter((code) =>
        filteredOrders.some((order) => Number(order.code) === Number(code))
      );
      return keep.length === prev.length ? prev : keep;
    });
  }, [filteredOrders]);

  const handlePreviousPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
    setHiddenTasks(false);
    setHiddenProtocolos(false);
    setActualOrder(null);
  };

  const handleNextPage = () => {
    if (totalPages === 0) return;
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
    setHiddenTasks(false);
    setHiddenProtocolos(false);
    setActualOrder(null);
  };

  const handleMaintainerChange = (e) => {
    const code = Number(e.target.value);
    if (!Number.isFinite(code)) {
      setSelectedMaintainer(null);
      return;
    }
    const maint = maintainers.find((m) => Number(m.code) === code) || null;
    setSelectedMaintainer(maint);
  };

  const handleOrderToggle = (orderCode) => {
    const numericCode = Number(orderCode);
    if (!Number.isFinite(numericCode)) return;
    setSelectedOrders((prev) => {
      if (prev.includes(numericCode)) {
        return prev.filter((code) => code !== numericCode);
      }
      return [...prev, numericCode];
    });
  };

  const assignOrders = useCallback(
    async (orderCodes) => {
      if (!selectedMaintainer) {
        setAssignError("Selecciona un mantenedor antes de asignar.");
        return;
      }
      const codesSet = new Set(
        (orderCodes || [])
          .map((code) => Number(code))
          .filter((code) => Number.isFinite(code))
      );
      if (codesSet.size === 0) return;
      setAssigning(true);
      setAssignError(null);
      try {
        const maint = selectedMaintainer;
        const maintCode = Number(maint.code);
        const updates = orders
          .filter((order) => codesSet.has(Number(order.code)))
          .map((order) => ({
            ...order,
            info: {
              ...(order.info || {}),
              asignado_a_code: maintCode,
              asignado_a_name: maint.name,
              asignado_por_code: user?.code ?? null,
              asignado_por_name: user?.name ?? null,
            },
          }));

        if (!updates.length) {
          throw new Error(
            "No se encontraron Ordenes seleccionadas para asignar."
          );
        }

        await bulkUpsertOrders(updates);

        if (typeof broadcastSync === "function") {
          await broadcastSync();
        }
        if (
          typeof sendOrdersToUser === "function" &&
          Number.isFinite(maintCode)
        ) {
          await sendOrdersToUser(maintCode);
        }

        setOrders((prev) =>
          prev.map((order) => {
            if (!codesSet.has(Number(order.code))) return order;
            const updated = updates.find(
              (candidate) => Number(candidate.code) === Number(order.code)
            );
            return updated || order;
          })
        );
        setSelectedOrders((prev) =>
          prev.filter((code) => !codesSet.has(Number(code)))
        );
        setHiddenTasks(false);
        setHiddenProtocolos(false);
        setActualOrder(null);
      } catch (err) {
        setAssignError(
          err?.message || "No se pudo asignar las Ordenes seleccionadas."
        );
      } finally {
        setAssigning(false);
      }
    },
    [broadcastSync, orders, selectedMaintainer, sendOrdersToUser, user]
  );

  const handleAssignSelected = () => {
    assignOrders(selectedOrders);
  };

  const handleAssignSingle = (orderCode) => {
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
        throw new Error("No hay Ordenes seleccionadas para anular.");
      }

      const codesSet = new Set(numericCodes);
      const affectedMaintainers = new Set();

      setCanceling(true);

      try {
        for (const order of orders) {
          const numericCode = Number(order?.code);
          if (!codesSet.has(numericCode)) continue;
          const assigned = Number(order?.info?.asignado_a_code);
          if (Number.isFinite(assigned)) {
            affectedMaintainers.add(assigned);
          }
        }

        for (const numeric of numericCodes) {
          await cancelOrder(numeric, reasonLabel, trimmedComment);
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
          prev.filter((order) => !codesSet.has(Number(order?.code)))
        );
        setSelectedOrders((prev) =>
          prev.filter((code) => !codesSet.has(Number(code)))
        );
        setHiddenTasks(false);
        setHiddenProtocolos(false);
        setActualOrder(null);
        setTaskActionError(null);

        await loadOrders();
        return true;
      } finally {
        setCanceling(false);
      }
    },
    [broadcastSync, loadOrders, orders, sendOrdersToUser]
  );

  if (loading) return <div>Cargando ordenes...</div>;
  if (error) return <div>Error al cargar ordenes: {error}</div>;
  if (orders.length === 0) return <div>No hay ordenes para asignar.</div>;

  return (
    <div>
      <div>
        <div className="card mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="sr-only" htmlFor="assign-orders-search">
                Buscar Ordenes
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
                  id="assign-orders-search"
                  type="text"
                  placeholder="Buscar por código o unidad"
                  className="input w-full pl-9"
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
                onChange={handleChangeMachine}
              >
                <option value="">Todas</option>
                {Object.entries(MACHINES).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
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
                value={selectServices}
                onChange={handleChangeServices}
              >
                <option value="">Todos</option>
                {Object.entries(SERVICES).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="card mb-4 space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold">
                Asignar Ordenes seleccionadas
              </h3>
              <p className="text-sm text-gray-600">
                Selecciona un mantenedor y elige las Ordenes para asignarlas de
                manera masiva.
              </p>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <select
                className="input"
                value={selectedMaintainer?.code || ""}
                onChange={handleMaintainerChange}
              >
                <option value="">Seleccionar mantenedor</option>
                {maintainers.map((maint) => (
                  <option key={maint.code} value={maint.code}>
                    #{maint.code} - {maint.name}
                    {maint.speciality ? ` (${maint.speciality})` : ""}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary"
                disabled={
                  assigning ||
                  selectedOrders.length === 0 ||
                  !selectedMaintainer
                }
                onClick={handleAssignSelected}
              >
                {assigning
                  ? "Asignando..."
                  : `Asignar (${selectedOrders.length})`}
              </button>
              <button
                type="button"
                className="btn btn-outline text-red-600 border-red-500 hover:bg-red-50"
                onClick={handleCancelSelected}
                disabled={canceling || selectedOrders.length === 0}
              >
                {canceling
                  ? "Anulando..."
                  : `Anular (${selectedOrders.length})`}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
            <span>Ordenes disponibles: {filteredOrders.length}</span>
            <span>Ordenes seleccionadas: {selectedOrders.length}</span>
            {selectedMaintainer ? (
              <span>
                Mantenedor: #{selectedMaintainer.code} -{" "}
                {selectedMaintainer.name}
              </span>
            ) : null}
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
        </div>
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-4">Ordenes para Asignar:</h2>
        {paginatedOrders.length === 0 ? (
          <div>No hay ordenes que coincidan con los filtros aplicados.</div>
        ) : (
          paginatedOrders.map((order) => {
            const numericCode = Number(order.code);
            const isSelected = selectedOrders.includes(numericCode);
            const dueDateDisplay = order?.info?.["Proximo Venc."] || "Sin fecha";
            const rawFrequency = order?.info?.["Frec. Dias"];
            const frequencyDisplay =
              rawFrequency === undefined || rawFrequency === null || rawFrequency === ""
                ? "No definido"
                : `${rawFrequency} días`;
            return (
              <div
                key={order.code}
                className={`border mb-2 rounded-lg shadow ${
                  order.isNearDue
                    ? "border-red-500 ring-1 ring-red-300"
                    : "border-gray-200"
                } ${
                  !order.isNearDue && isSelected
                    ? "border-blue-500 ring-1 ring-blue-200"
                    : ""
                }`}
              >
                <div className="flex justify-between items-center gap-2 px-2 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isSelected}
                      onChange={() => handleOrderToggle(order.code)}
                    />
                    <span className="border rounded-tl-md rounded-br-md px-2 py-1 text-sm font-mono font-semibold">
                      {order.code}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="border rounded-tr-md rounded-bl-md px-2 py-1 text-sm font-mono font-semibold">
                      {order.tasks.data.filter((task) => task.status === 2)
                        .length +
                        "/" +
                        order.tasks.Tasks_N}
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm border-red-500 text-red-600 hover:bg-red-50"
                      onClick={() => handleCancelSingle(order.code)}
                      disabled={canceling}
                    >
                      {canceling ? "Anulando..." : "Anular"}
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleAssignSingle(order.code)}
                      disabled={assigning || !selectedMaintainer}
                    >
                      {assigning ? "Asignando..." : "Asignar"}
                    </button>
                  </div>
                </div>
                <div className="flex justify-between flex-col">
                  <span className="mb-2 px-2 font-semibold text-lg text-gray-700">
                    Descripción: {order.info.Descripcion}
                  </span>
                  <span className="mb-2 px-2 font-semibold text-lg text-gray-700">
                    Unidad: {order.info["N Unidad"]}
                  </span>
                  <div className="mb-2 px-2 text-sm text-gray-600 space-y-1">
                    <p>
                      <span className="font-semibold">Vence:</span> {dueDateDisplay}
                    </p>
                    <p>
                      <span className="font-semibold">Frecuencia:</span> {frequencyDisplay}
                    </p>
                  </div>
                </div>
                <div className="relative flex justify-between items-center border-b border-gray-500 rounded-b-md">
                  <button
                    className="m-0 px-2 py-2 bg-blue-600 text-white  hover:bg-blue-700 cursor-pointer rounded-tr-md rounded-bl-md"
                    onClick={() => selectTask(order.code)}
                  >
                    Tareas |{" "}
                    {order.tasks.data.length > 0
                      ? [
                          ...new Set(
                            order.tasks.data
                              .map((task) => task.Taller)
                              .filter((taller) => taller)
                          ),
                        ].join("- ")
                      : "N/A"}
                  </button>

                  <button
                    className="m-0 px-2 py-2 bg-blue-600 text-white  hover:bg-blue-700 cursor-pointer rounded-tl-md rounded-br-md"
                    onClick={() => selectProtocol(order.code)}
                  >
                    Anexos: {order.protocolos.length}
                  </button>
                </div>
                <Activity
                  mode={
                    hiddenTasks && actualOrder == order.code
                      ? "visible"
                      : "hidden"
                  }
                >
                  <div>
                    {taskActionError &&
                    actualOrder == order.code &&
                    hiddenTasks ? (
                      <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-1 text-sm text-red-700">
                        {taskActionError}
                      </div>
                    ) : null}
                    <ul className="px-2 list-inside">
                      {order.tasks.data.map((task, index) => (
                        <li
                          key={index}
                          className="flex justify-between border-b border-gray-300 py-1"
                        >
                          <span>{task.Descripcion}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Activity>
                <Activity
                  mode={
                    hiddenProtocolos && actualOrder == order.code
                      ? "visible"
                      : "hidden"
                  }
                >
                  <div>
                    {order.protocolos.length > 1 ? (
                      <select
                        name=""
                        id=""
                        className="m-2 p-2 border rounded w-1/2 justify-center text-center align-middle relative left-1/2 -translate-x-1/2"
                        value={selectedProtocolIndex}
                        onChange={(e) =>
                          setSelectedProtocolIndex(Number(e.target.value))
                        }
                      >
                        {order.protocolos.map((protocolo, index) => (
                          <option key={index} value={index}>
                            Anexo {index + 1}
                          </option>
                        ))}
                      </select>
                    ) : null}

                    <div className="bg-gray-50 p-4 rounded-md mt-2 border ">
                      <pre className="whitespace-pre-wrap text-sm font-mono text-gray-800">
                        {order.protocolos.length > 0
                          ? order.protocolos[selectedProtocolIndex]
                          : "No hay protocolos de seguridad definidos para esta orden."}
                      </pre>
                    </div>
                  </div>
                </Activity>
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-center gap-4 mt-6">
        <button
          className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
          onClick={handlePreviousPage}
          disabled={currentPage === 0}
        >
          Anterior
        </button>
        <span className="text-sm text-gray-600">
          Página {filteredOrders.length === 0 ? 0 : currentPage + 1} de{" "}
          {filteredOrders.length === 0 ? 0 : totalPages}
        </span>
        <button
          className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
          onClick={handleNextPage}
          disabled={totalPages === 0 || currentPage >= totalPages - 1}
        >
          Siguiente
        </button>
      </div>
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
        err?.message || "No se pudieron anular las Ordenes seleccionadas."
      );
    }
  };

  const modalTitle =
    orderCodes.length > 1
      ? `Anular ${orderCodes.length} Ordenes`
      : `Anular orden #${orderCodes[0]}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <header className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-slate-900">{modalTitle}</h2>
          <p className="mt-1 text-sm text-slate-600">
            Esta acción marcará las Ordenes como anuladas con el motivo
            seleccionado.
          </p>
        </header>
        <div className="space-y-4 px-4 py-4">
          <div>
            <label
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
              htmlFor="assign-cancel-reason"
            >
              Motivo de anulación
            </label>
            <select
              id="assign-cancel-reason"
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
              htmlFor="assign-cancel-comment"
            >
              Comentario
            </label>
            <textarea
              id="assign-cancel-comment"
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
              Ordenes seleccionadas:
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

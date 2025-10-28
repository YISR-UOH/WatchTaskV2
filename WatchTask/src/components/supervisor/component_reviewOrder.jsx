import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/Context/AuthContext";
import {
  fetchOrdersBySpeciality,
  markOrdersExpired,
  saveOrderChecklist,
} from "@/utils/APIdb";
import { usePeer } from "@/p2p/PeerContext";
import OrderCompletionChecklist from "@/components/OrderCompletionChecklist";

const TASK_STATUS_LABEL = {
  0: "Pendiente",
  1: "En progreso",
  2: "Completada",
  3: "Anulada",
};

const getTaskStatusLabel = (status) => {
  const numeric = Number(status);
  return TASK_STATUS_LABEL[numeric] ?? "Sin estado";
};

const areAllTasksCompleted = (order) => {
  const tasks = Array.isArray(order?.tasks?.data) ? order.tasks.data : [];
  return tasks.length > 0 && tasks.every((task) => Number(task?.status) === 2);
};

const hasCompletedChecklist = (checklist) => {
  if (!checklist) return false;
  const answers = Array.isArray(checklist.answers) ? checklist.answers : [];
  if (answers.length === 0) return false;
  return answers.every((answer) => {
    const value = typeof answer?.estado === "string" ? answer.estado : "";
    return value.trim().length > 0;
  });
};

const hasSupervisorSignature = (checklist) => {
  if (!checklist?.supervisor) return false;
  const firma = checklist.supervisor?.firma;
  return typeof firma === "string" && firma.trim().length > 0;
};

export default function ReviewOrder() {
  const { user } = useAuth();
  const { broadcastSync } = usePeer() ?? {};
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCode, setSelectedCode] = useState(null);
  const [showChecklist, setShowChecklist] = useState(false);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [checklistError, setChecklistError] = useState(null);
  const hasAutoselectedRef = useRef(false);

  const loadOrders = useCallback(async () => {
    if (!user) {
      setOrders([]);
      return;
    }

    setLoading(true);
    setError(null);

    const fetchAndMaybeRevalidate = async (shouldRevalidate = true) => {
      const data = await fetchOrdersBySpeciality(user.speciality);
      setOrders(data);

      if (!shouldRevalidate) return;

      const statusFourCodes = data
        .filter((order) => Number(order?.info?.status) === 4)
        .map((order) => order.code)
        .filter((code) => Number.isFinite(Number(code)));
      if (statusFourCodes.length === 0) return;

      try {
        const result = await markOrdersExpired(statusFourCodes);
        if (result?.expiredMarked > 0 || result?.restored > 0) {
          await fetchAndMaybeRevalidate(false);
        }
      } catch (validationError) {
        console.error(
          "No se pudo revalidar el estado de las órdenes vencidas",
          validationError
        );
      }
    };

    try {
      await fetchAndMaybeRevalidate(true);
    } catch (err) {
      setError(
        err?.message || "No se pudieron obtener las órdenes para revisión."
      );
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleOrdersChanged = () => {
      loadOrders();
    };
    window.addEventListener("orders:changed", handleOrdersChanged);
    return () => {
      window.removeEventListener("orders:changed", handleOrdersChanged);
    };
  }, [loadOrders]);

  const supervisorOrders = useMemo(() => {
    if (!user) return [];
    const supervisorCode = Number(user.code);
    return orders.filter((order) => {
      const assignedBy = Number(order?.info?.asignado_por_code);
      return Number.isFinite(supervisorCode) && assignedBy === supervisorCode;
    });
  }, [orders, user]);

  const pendingOrders = useMemo(
    () =>
      supervisorOrders.filter((order) => {
        const status = Number(order?.info?.status);
        const checklist = order?.info?.checkListDict;
        return (
          status === 2 &&
          areAllTasksCompleted(order) &&
          hasCompletedChecklist(checklist) &&
          !hasSupervisorSignature(checklist)
        );
      }),
    [supervisorOrders]
  );

  const annulledOrders = useMemo(
    () => supervisorOrders.filter((order) => Number(order?.info?.status) === 3),
    [supervisorOrders]
  );

  const expiredOrders = useMemo(
    () => supervisorOrders.filter((order) => Number(order?.info?.status) === 4),
    [supervisorOrders]
  );

  const selectedOrder = useMemo(() => {
    if (!pendingOrders.length) return null;
    if (selectedCode === null) return null;
    return (
      pendingOrders.find(
        (order) => Number(order.code) === Number(selectedCode)
      ) || null
    );
  }, [pendingOrders, selectedCode]);

  useEffect(() => {
    if (!pendingOrders.length) {
      setSelectedCode(null);
      hasAutoselectedRef.current = false;
      return;
    }
    setSelectedCode((prev) => {
      const exists =
        prev !== null &&
        pendingOrders.some((order) => Number(order.code) === Number(prev));

      if (exists) return prev;

      if (prev === null) {
        if (!hasAutoselectedRef.current) {
          hasAutoselectedRef.current = true;
          return pendingOrders[0].code;
        }
        return null;
      }

      hasAutoselectedRef.current = true;
      return pendingOrders[0].code;
    });
  }, [pendingOrders]);

  useEffect(() => {
    if (!selectedOrder) {
      setShowChecklist(false);
      setChecklistError(null);
    }
  }, [selectedOrder]);

  const handleSelectOrder = (orderCode) => {
    setSelectedCode((prev) => {
      const current = Number(prev);
      const next = Number(orderCode);
      if (Number.isFinite(current) && current === next) {
        return null;
      }
      return orderCode;
    });
  };

  const checklistStats = useMemo(() => {
    const checklist = selectedOrder?.info?.checkListDict;
    const answers = Array.isArray(checklist?.answers) ? checklist.answers : [];
    if (!answers.length) return null;
    return answers.reduce(
      (acc, answer) => {
        const state = String(answer?.estado || "").toUpperCase();
        if (state === "SI") acc.si += 1;
        else if (state === "NO") acc.no += 1;
        else if (state === "NA" || state === "N/A") acc.na += 1;
        return acc;
      },
      { si: 0, no: 0, na: 0 }
    );
  }, [selectedOrder]);

  const handleChecklistReview = () => {
    if (!selectedOrder) return;
    setChecklistError(null);
    setShowChecklist(true);
  };

  const handleChecklistClose = () => {
    setShowChecklist(false);
    setChecklistError(null);
  };

  const handleChecklistSave = async (payload) => {
    if (!selectedOrder) return;
    try {
      setSavingChecklist(true);
      setChecklistError(null);
      const updatedOrder = await saveOrderChecklist(
        selectedOrder.code,
        payload
      );
      setOrders((prev) =>
        prev.map((order) =>
          Number(order.code) === Number(updatedOrder.code)
            ? updatedOrder
            : order
        )
      );
      if (typeof broadcastSync === "function") {
        await broadcastSync();
      }
      setShowChecklist(false);
    } catch (err) {
      setChecklistError(
        err?.message || "No se pudo guardar el checklist de la orden."
      );
    } finally {
      setSavingChecklist(false);
    }
  };

  if (!user) {
    return (
      <div className="card p-4 text-sm text-slate-600">
        Debes iniciar sesión como supervisor para revisar órdenes.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">
            Revisión de órdenes completadas
          </h2>
          <p className="text-sm text-slate-600">
            Revisa las órdenes finalizadas por tu equipo y registra la
            aprobación en el checklist.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline"
          onClick={loadOrders}
          disabled={loading}
        >
          {loading ? "Actualizando..." : "Refrescar"}
        </button>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">
            Pendientes de revisión
          </h3>
          <span className="text-sm text-slate-500">{pendingOrders.length}</span>
        </div>
        {pendingOrders.length === 0 ? (
          <p className="text-sm text-slate-600">
            No hay órdenes listas para revisión.
          </p>
        ) : (
          <ul className="space-y-3">
            {pendingOrders.map((order) => {
              const isSelected =
                selectedOrder &&
                Number(order.code) === Number(selectedOrder.code);
              return (
                <li
                  key={order.code}
                  className={`overflow-hidden rounded-lg border ${
                    isSelected ? "border-blue-500" : "border-slate-200"
                  } bg-white transition`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectOrder(order.code)}
                    className={`flex w-full flex-col gap-2 px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-200 ${
                      isSelected ? "bg-blue-50" : "hover:bg-blue-100"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-900">
                        Orden #{order.code}
                      </span>
                      <span className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                        Lista para revisión
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 line-clamp-2">
                      {order?.info?.Descripcion || "Sin descripción"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>Unidad: {order?.info?.["N Unidad"] || "N/A"}</span>
                      <span>
                        Mantenedor: {order?.info?.asignado_a_name || "N/A"}
                      </span>
                    </div>
                  </button>

                  {isSelected && selectedOrder ? (
                    <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <h4 className="text-base font-semibold text-slate-900">
                            Detalles de la orden
                          </h4>
                          <p className="text-sm text-slate-600">
                            {selectedOrder?.info?.Descripcion ||
                              "Sin descripción"}
                          </p>
                        </div>
                        <div className="flex flex-col items-start gap-1 text-xs text-slate-500 md:items-end">
                          <span>
                            Unidad: {selectedOrder?.info?.["N Unidad"] || "N/A"}
                          </span>
                          <span>
                            Mantenedor asignado:{" "}
                            {selectedOrder?.info?.asignado_a_name || "N/A"}
                          </span>
                          <span>
                            Checklist:{" "}
                            {hasSupervisorSignature(
                              selectedOrder?.info?.checkListDict
                            )
                              ? "Firmado"
                              : "Sin firma"}
                          </span>
                        </div>
                      </div>

                      {checklistStats ? (
                        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                          <span className="font-semibold text-blue-900">
                            Resumen del checklist:
                          </span>
                          <span className="ml-2">Sí: {checklistStats.si}</span>
                          <span className="ml-2">No: {checklistStats.no}</span>
                          <span className="ml-2">N/A: {checklistStats.na}</span>
                        </div>
                      ) : null}

                      <section className="mt-4 space-y-2">
                        <h5 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                          Detalles de tareas
                        </h5>
                        <div className="space-y-2">
                          {Array.isArray(selectedOrder?.tasks?.data) ? (
                            selectedOrder.tasks.data.map((task, index) => {
                              const taller = task?.Taller || "Sin taller";
                              const maintObs = task?.obs_assigned_to?.trim();
                              return (
                                <div
                                  key={`${selectedOrder.code}-task-${index}`}
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                                >
                                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                                    <div>
                                      <p className="text-sm font-medium text-slate-900">
                                        Tarea {index + 1}:{" "}
                                        {task?.Descripcion || "Sin descripción"}
                                      </p>
                                      <p className="text-xs text-slate-500">
                                        Taller: {taller}
                                      </p>
                                    </div>
                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                                      {getTaskStatusLabel(task?.status)}
                                    </span>
                                  </div>
                                  {maintObs ? (
                                    <p className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600">
                                      Observación del mantenedor: {maintObs}
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-sm text-slate-600">
                              No se encontraron tareas en esta orden.
                            </p>
                          )}
                        </div>
                      </section>

                      <section className="mt-4 space-y-2">
                        <h5 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                          Observaciones generales
                        </h5>
                        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                          {selectedOrder?.info?.checkListDict?.otrasObservaciones?.trim() ||
                            "Sin observaciones registradas."}
                        </div>
                      </section>

                      {checklistError ? (
                        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          {checklistError}
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleChecklistReview}
                        >
                          Revisar checklist completo
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={loadOrders}
                          disabled={loading}
                        >
                          Volver a consultar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">
            Órdenes anuladas
          </h3>
          <span className="text-sm text-slate-500">
            {annulledOrders.length}
          </span>
        </div>
        {annulledOrders.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            No hay órdenes anuladas asignadas por ti en esta especialidad.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {annulledOrders.map((order) => (
              <li
                key={`annulled-${order.code}`}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600"
              >
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <span className="font-semibold text-slate-900">
                    Orden #{order.code}
                  </span>
                  <span className="text-xs uppercase tracking-wide text-red-600">
                    Anulada
                  </span>
                </div>
                <p className="text-sm">
                  {order?.info?.Descripcion || "Sin descripción"}
                </p>
                {Array.isArray(order?.info?.obs_anulada) ? (
                  <p className="text-xs text-slate-500">
                    Motivo: {order.info.obs_anulada.join(" - ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">
          {
            // TODO: implementar gestión de órdenes anuladas.
          }
          Próximamente podrás gestionar las órdenes anuladas desde esta vista.
        </p>
      </section>

      <section className="card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">
            Órdenes vencidas
          </h3>
          <span className="text-sm text-slate-500">{expiredOrders.length}</span>
        </div>
        {expiredOrders.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            No hay órdenes vencidas asignadas por ti en esta especialidad.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {expiredOrders.map((order) => (
              <li
                key={`expired-${order.code}`}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600"
              >
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <span className="font-semibold text-slate-900">
                    Orden #{order.code}
                  </span>
                  <span className="text-xs uppercase tracking-wide text-orange-600">
                    Vencida
                  </span>
                </div>
                <p className="text-sm">
                  {order?.info?.Descripcion || "Sin descripción"}
                </p>
                {order?.info?.obs_anulada ? (
                  <p className="text-xs text-slate-500">
                    Motivo:{" "}
                    {Array.isArray(order.info.obs_anulada)
                      ? order.info.obs_anulada.join(" - ")
                      : String(order.info.obs_anulada)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">
          {
            // TODO: implementar reprogramación y reasignación de órdenes vencidas.
          }
          Estas órdenes expiraron sin aprobación. Podrás reprogramarlas o
          reasignarlas en próximas iteraciones.
        </p>
      </section>

      <OrderCompletionChecklist
        isOpen={showChecklist}
        order={selectedOrder}
        task={null}
        taskIndex={null}
        user={user}
        initialData={selectedOrder?.info?.checkListDict}
        onCancel={handleChecklistClose}
        onSubmit={handleChecklistSave}
        saving={savingChecklist}
        submitError={checklistError}
      />
    </div>
  );
}

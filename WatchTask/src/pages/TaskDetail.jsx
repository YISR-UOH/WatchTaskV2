import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { unstable_Activity, Activity as ActivityStable } from "react";
import {
  completeOrderTask,
  getOrderByCode,
  saveOrderChecklist,
} from "@/utils/APIdb";
import { useAuth } from "@/Context/AuthContext";
import OrderCompletionChecklist from "@/components/OrderCompletionChecklist";

const Activity = ActivityStable ?? unstable_Activity;

const TASK_STATUS_LABEL = {
  0: "Pendiente",
  1: "En progreso",
  2: "Completada",
  3: "Anulada",
};

const normalizeValue = (value, fallback = "N/A") => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && value.trim().length === 0) return fallback;
  return value;
};

const areAllTasksCompleted = (order) => {
  const data = Array.isArray(order?.tasks?.data) ? order.tasks.data : [];
  if (!data.length) return false;
  return data.every((item) => Number(item?.status) === 2);
};

export default function TaskDetail() {
  const { code: codeParam, taskIndex: taskIndexParam } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const taskIndex = useMemo(() => {
    const parsed = Number.parseInt(taskIndexParam ?? "", 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [taskIndexParam]);

  const initialOrder = location.state?.order ?? null;
  const [order, setOrder] = useState(initialOrder);
  const [loading, setLoading] = useState(!initialOrder);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    checkbox: false,
    obs: "",
    medicion: "0",
    rangoDesde: "",
    rangoHasta: "",
  });
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState(null);
  const [finalizeSuccess, setFinalizeSuccess] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [isSavingChecklist, setIsSavingChecklist] = useState(false);
  const [checklistError, setChecklistError] = useState(null);
  const [checklistSuccess, setChecklistSuccess] = useState(false);

  useEffect(() => {
    let canceled = false;

    async function loadOrder() {
      if (!codeParam) {
        setError("Código de orden inválido");
        setLoading(false);
        return;
      }
      if (taskIndex === null || taskIndex < 0) {
        setError("Índice de tarea inválido");
        setLoading(false);
        return;
      }
      if (order) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const fetched = await getOrderByCode(codeParam);
        if (canceled) return;
        if (!fetched) {
          setError("No se encontró la orden solicitada.");
        } else {
          setOrder(fetched);
        }
      } catch {
        if (!canceled) setError("No se pudo cargar la orden.");
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    loadOrder();

    return () => {
      canceled = true;
    };
  }, [codeParam, taskIndex, order]);

  const task = useMemo(() => {
    if (!order || taskIndex === null) return null;
    const data = Array.isArray(order?.tasks?.data) ? order.tasks.data : [];
    return data[taskIndex] ?? null;
  }, [order, taskIndex]);

  const annex = useMemo(() => {
    if (!order || taskIndex === null) return null;
    return Array.isArray(order.protocolos) ? order.protocolos[taskIndex] : null;
  }, [order, taskIndex]);

  useEffect(() => {
    if (!task) return;
    setForm((prev) => ({
      checkbox:
        typeof task.accepted_protocol === "boolean"
          ? task.accepted_protocol
          : Number(task?.status) === 2
          ? true
          : prev.checkbox,
      obs:
        typeof task.obs_assigned_to === "string"
          ? task.obs_assigned_to
          : prev.obs ?? "",
      medicion:
        task.medicion_result !== undefined && task.medicion_result !== null
          ? String(task.medicion_result)
          : prev.medicion ?? "0",
      rangoDesde:
        typeof task.medicion_range_from === "string"
          ? task.medicion_range_from
          : prev.rangoDesde ?? "",
      rangoHasta:
        typeof task.medicion_range_to === "string"
          ? task.medicion_range_to
          : prev.rangoHasta ?? "",
    }));
  }, [task]);

  useEffect(() => {
    if (!finalizeSuccess) return;
    const timeout = setTimeout(() => setFinalizeSuccess(false), 3000);
    return () => clearTimeout(timeout);
  }, [finalizeSuccess]);

  useEffect(() => {
    if (!checklistSuccess) return;
    const timeout = setTimeout(() => setChecklistSuccess(false), 3000);
    return () => clearTimeout(timeout);
  }, [checklistSuccess]);

  useEffect(() => {
    setShowChecklist(false);
  }, [order?.code, taskIndex]);

  const statusLabel = useMemo(() => {
    if (!task) return "N/A";
    const key = Number(task.status);
    return TASK_STATUS_LABEL[key] ?? normalizeValue(task.status, "N/A");
  }, [task]);

  const isTaskCompleted = useMemo(() => Number(task?.status) === 2, [task]);
  const canFinalize =
    form.checkbox &&
    form.medicion !== "0" &&
    !isFinalizing &&
    !loading &&
    !error;

  const handleBack = () => {
    navigate(`/mantenedor/orden/${codeParam}`, {
      state: order ? { order } : undefined,
    });
  };

  const handleCheckboxChange = (checked) => {
    setForm((prev) => ({
      ...prev,
      checkbox: checked,
    }));
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleFinalizar = async () => {
    if (!order || taskIndex === null || !task) return;
    const orderCode = order?.code ?? codeParam;
    if (orderCode === null || orderCode === undefined) return;
    if (!canFinalize) return;

    try {
      setIsFinalizing(true);
      setFinalizeError(null);
      setFinalizeSuccess(false);
      const payload = {
        accepted: true,
        obs: form.obs?.trim?.() ?? "",
        medicion: form.medicion,
        rangoDesde: form.rangoDesde?.trim?.() ?? "",
        rangoHasta: form.rangoHasta?.trim?.() ?? "",
      };
      const { order: persistedOrder } = await completeOrderTask(
        orderCode,
        taskIndex,
        payload
      );

      let nextOrderSnapshot = persistedOrder;

      if (!nextOrderSnapshot) {
        try {
          nextOrderSnapshot = await getOrderByCode(orderCode);
        } catch {}
      }

      if (nextOrderSnapshot) {
        const normalizedTasks = Array.isArray(nextOrderSnapshot?.tasks?.data)
          ? nextOrderSnapshot.tasks.data.map((taskItem, index) => {
              if (index === taskIndex) {
                return {
                  ...taskItem,
                  status: 2,
                };
              }

              if (typeof taskItem?.status === "number") {
                return taskItem;
              }

              const numericStatus = Number(taskItem?.status);

              return Number.isFinite(numericStatus)
                ? { ...taskItem, status: numericStatus }
                : { ...taskItem };
            })
          : [];

        const mergedOrder = {
          ...nextOrderSnapshot,
          tasks: {
            ...(nextOrderSnapshot.tasks || {}),
            data: normalizedTasks,
          },
        };

        setOrder(mergedOrder);
        setFinalizeSuccess(true);

        if (areAllTasksCompleted(mergedOrder)) {
          setShowChecklist(true);
        }
      } else {
        setFinalizeSuccess(true);
      }
    } catch (err) {
      console.error("Failed to complete task", err);
      setFinalizeError("No se pudo finalizar la tarea. Intenta nuevamente.");
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleChecklistSave = async (payload) => {
    if (!order) return;
    const orderCode = order?.code ?? codeParam;
    if (orderCode === null || orderCode === undefined) return;
    try {
      setChecklistError(null);
      setIsSavingChecklist(true);
      const updatedOrder = await saveOrderChecklist(orderCode, payload);
      setOrder(updatedOrder);
      setChecklistSuccess(true);
      setShowChecklist(false);
    } catch (err) {
      console.error("Failed to save checklist", err);
      setChecklistError(
        "No se pudo guardar el checklist. Inténtalo nuevamente."
      );
    } finally {
      setIsSavingChecklist(false);
    }
  };

  const handleChecklistCancel = () => {
    setChecklistError(null);
    setShowChecklist(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <Activity mode={loading ? "visible" : "hidden"}>
        <div className="bg-white border rounded-lg p-6 shadow">
          <p className="text-slate-600">Cargando tarea...</p>
        </div>
      </Activity>
      <Activity mode={!loading && error ? "visible" : "hidden"}>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 shadow">
          <p className="text-red-700">{error}</p>
        </div>
      </Activity>
      <Activity mode={!loading && !error && task ? "visible" : "hidden"}>
        <div className="space-y-4 bg-white border rounded-lg p-6 shadow">
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleBack}
            >
              Volver a la orden
            </button>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Orden #{normalizeValue(order?.code, "N/A")} · Tarea #
                {(taskIndex ?? 0) + 1}
              </h1>
              <p className="text-sm text-slate-600">
                {normalizeValue(task?.Descripcion)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                Taller: {normalizeValue(task?.Taller)}
              </span>
              <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                Hs estimadas: {normalizeValue(task?.["Hs Estim"])}
              </span>
              <span className="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
                Estado: {statusLabel}
              </span>
            </div>
          </div>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 text-sm text-slate-800">
              <div className="flex justify-between">
                <span className="font-semibold text-slate-600">
                  Tarea Standard:
                </span>
                <span className="text-slate-900">
                  {normalizeValue(task?.["Tarea Standard"])}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-600">
                  Nº Sec. Oper.:
                </span>
                <span className="text-slate-900">
                  {normalizeValue(task?.["Numero sec oper"])}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-slate-600">
                  Valor esperado:
                </span>
                <span className="text-slate-900">
                  {normalizeValue(task?.["Valor esperado"])}
                </span>
              </div>
            </div>
            <div className="space-y-2 text-sm text-slate-800">
              <div>
                <h2 className="text-sm font-semibold text-slate-600">
                  Observaciones del supervisor
                </h2>
                <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-900">
                  {normalizeValue(task?.obs_assigned_by, "Sin observaciones")}
                </p>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-600">
                  Observaciones del mantenedor
                </h2>
                <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-900">
                  {normalizeValue(task?.obs_assigned_to, "Sin observaciones")}
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">Anexo</h2>
            <div className="max-h-[50vh] overflow-auto rounded-md border border-slate-200 bg-slate-50 p-4">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                {normalizeValue(
                  annex,
                  "No hay anexos disponibles para esta tarea."
                )}
              </pre>
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-base font-semibold text-slate-900">
              Confirmación y cierre de la tarea
            </h2>
            {finalizeError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {finalizeError}
              </div>
            )}
            {finalizeSuccess && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Tarea finalizada correctamente.
              </div>
            )}
            {checklistError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {checklistError}
              </div>
            )}
            {checklistSuccess && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Checklist guardado correctamente.
              </div>
            )}
            <div>
              <label className="flex items-start gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={form.checkbox}
                  onChange={(event) =>
                    handleCheckboxChange(event.target.checked)
                  }
                  disabled={isFinalizing}
                />
                <span>He leído el protocolo y la tarea</span>
              </label>
            </div>
            {form.checkbox && (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="SaveObs"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Observaciones
                  </label>
                  <textarea
                    id="SaveObs"
                    value={form.obs}
                    onChange={(event) =>
                      handleChange("obs", event.target.value)
                    }
                    placeholder="Escriba su observación aquí..."
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100"
                    rows={4}
                    disabled={isFinalizing}
                  />
                </div>
                <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-4">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
                    <span aria-hidden="true">✅</span>
                    Protocolo y tarea aceptados
                  </span>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="md:col-span-2 flex flex-col gap-1">
                      <span className="text-sm font-semibold text-slate-700">
                        Medición encontrada
                      </span>
                      <select
                        name="medicion"
                        id="medicion"
                        value={form.medicion}
                        onChange={(event) =>
                          handleChange("medicion", event.target.value)
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100"
                        disabled={isFinalizing}
                      >
                        <option value="0">Seleccionar</option>
                        <option value="1">Sí</option>
                        <option value="2">No</option>
                        <option value="3">No aplica</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-slate-700">
                        Rango desde
                      </label>
                      <input
                        type="text"
                        value={form.rangoDesde}
                        onChange={(event) =>
                          handleChange("rangoDesde", event.target.value)
                        }
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100"
                        disabled={isFinalizing}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-slate-700">
                        Rango hasta
                      </label>
                      <input
                        type="text"
                        value={form.rangoHasta}
                        onChange={(event) =>
                          handleChange("rangoHasta", event.target.value)
                        }
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100"
                        disabled={isFinalizing}
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleFinalizar}
                    disabled={!canFinalize}
                  >
                    {isFinalizing
                      ? "Guardando..."
                      : isTaskCompleted
                      ? "Actualizar tarea"
                      : "Finalizar tarea"}
                  </button>
                </div>
              </div>
            )}
            {isTaskCompleted && !isFinalizing ? (
              <p className="text-sm text-slate-600">
                Esta tarea ya está completada. Puedes ajustar la información y
                guardar nuevamente si es necesario.
              </p>
            ) : null}
            {order?.info?.checkListDict && !showChecklist && (
              <div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowChecklist(true)}
                  disabled={isSavingChecklist}
                >
                  Ver checklist de término
                </button>
              </div>
            )}
          </section>
        </div>
      </Activity>
      <OrderCompletionChecklist
        isOpen={showChecklist}
        order={order}
        task={task}
        taskIndex={taskIndex}
        user={user}
        initialData={order?.info?.checkListDict}
        onCancel={handleChecklistCancel}
        onSubmit={handleChecklistSave}
        saving={isSavingChecklist}
        submitError={checklistError}
      />
    </div>
  );
}

import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { cancelOrder, startOrderTask } from "@/utils/APIdb";

const TASK_STATUS_META = {
  0: {
    label: "Pendiente",
    chipClass:
      "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800",
  },
  1: {
    label: "En progreso",
    chipClass:
      "inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800",
  },
  2: {
    label: "Completada",
    chipClass:
      "inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800",
  },
  3: {
    label: "Anulada",
    chipClass:
      "inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800",
  },
};

const normalizeValue = (value, fallback = "N/A") => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && value.trim().length === 0) return fallback;
  return value;
};

export default function ViewOrder({ orden, onUpdateOrder }) {
  const info = orden?.info ?? {};
  const protocolos = useMemo(() => {
    if (!Array.isArray(orden?.protocolos)) return [];
    return orden.protocolos.filter((p) => typeof p === "string" && p.trim());
  }, [orden]);

  const tasks = useMemo(() => {
    if (!Array.isArray(orden?.tasks?.data)) return [];
    return orden.tasks.data;
  }, [orden]);

  const totalTasks = useMemo(() => {
    const declared = Number.parseInt?.(orden?.tasks?.Tasks_N, 10);
    if (Number.isFinite(declared)) return declared;
    return tasks.length;
  }, [orden, tasks]);

  const completedTasks = useMemo(() => {
    return tasks.filter((task) => Number(task?.status) === 2).length;
  }, [tasks]);

  const estimatedHours = normalizeValue(
    orden?.tasks?.h_estimadas ?? info?.h_estimadas ?? info?.["Hs Estim"],
    "N/A"
  );

  const [showProtocolModal, setShowProtocolModal] = useState(false);
  const [selectedProtocolIndex, setSelectedProtocolIndex] = useState(0);
  const [taskActionError, setTaskActionError] = useState(null);
  const [pendingTaskIndex, setPendingTaskIndex] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("Falta pieza");
  const [cancelDetail, setCancelDetail] = useState("");
  const [cancelError, setCancelError] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setSelectedProtocolIndex(0);
  }, [protocolos.length]);

  useEffect(() => {
    if (!protocolos.length) {
      setShowProtocolModal(false);
    }
  }, [protocolos.length]);

  const assignedName =
    info.asignado_a_name ??
    info.assigned_to_name ??
    info["Asignado a"] ??
    info["assigned_to_name"] ??
    null;
  const assignedCode =
    info.asignado_a_code ??
    info.assigned_to ??
    info["Asignado a Code"] ??
    info["assigned_to_code"] ??
    null;
  const assignedDisplay = normalizeValue(
    [assignedName, assignedCode].filter(Boolean).join(" ") || assignedName,
    "N/A"
  );

  const assignedByDisplay = normalizeValue(
    [info.asignado_por_name, info.asignado_por_code].filter(Boolean).join(" "),
    "Sin asignar"
  );

  const priority = normalizeValue(info.prioridad ?? info["Prioridad"], "N/A");
  const deadline = normalizeValue(
    info["Fecha Venc."] ?? info["F Venc."] ?? info["Proximo Venc."],
    "N/A"
  );
  const startDate = normalizeValue(
    info["F inicial"] ?? info["Fecha Inicio"],
    "N/A"
  );
  const finishDate = normalizeValue(info["F Real Ejecucion"], "N/A");
  const nextEmission = normalizeValue(
    info["Fecha Prox Emision"] ?? info["Proximo Venc."],
    "N/A"
  );

  const baseLeftDetails = [
    { label: "Descripción", value: info.Descripcion },
    { label: "Unidad", value: info["N Unidad"] },
    { label: "Especialidad", value: info["Especialidad"] },
  ];

  const baseRightDetails = [
    { label: "Asignado a", value: assignedDisplay },
    { label: "Asignado por", value: assignedByDisplay },
  ];

  const detailCandidates = [
    { label: "Originador", value: info["Originador"], preferred: "left" },
    { label: "Línea", value: info["Linea"], preferred: "left" },
    { label: "N° Serie", value: info["N de Serie"], preferred: "left" },
    { label: "Clase", value: info["Clase"], preferred: "left" },
    { label: "Tipo", value: info["Tipo"], preferred: "left" },
    { label: "Parte", value: info["Parte"], preferred: "left" },
    { label: "Elemento", value: info["Elemento"] },
    { label: "Modo", value: info["Modo"] },
    { label: "Incidencia", value: info["Incidencia"] },
    { label: "Kit de Tareas", value: info["Kit de Tareas"] },
    { label: "Planta", value: info["Planta"] },
    { label: "Tipo de Servicio", value: info["Tipo servici"] },
    { label: "Frec. Días", value: info["Frec. Dias"] },
    { label: "Frec. Horas", value: info["Frec. Horas"] },
    { label: "Frec. Km", value: info["Frec. Km"] },
    { label: "Fecha inicio", value: startDate, preferred: "right" },
    { label: "Fecha real ejecución", value: finishDate, preferred: "right" },
    { label: "Fecha vencimiento", value: deadline, preferred: "right" },
    { label: "Próxima emisión", value: nextEmission, preferred: "right" },
    {
      label: "Frecuencia comb.",
      value: info["Frec. Comb."],
      preferred: "right",
    },
  ];

  const leftDetails = [...baseLeftDetails];
  const rightDetails = [...baseRightDetails];

  const distributeDetail = (entry, preferred) => {
    if (!entry) return;
    const leftCount = leftDetails.length;
    const rightCount = rightDetails.length;

    if (preferred === "left" && leftCount <= rightCount) {
      leftDetails.push(entry);
      return;
    }
    if (preferred === "right" && rightCount <= leftCount) {
      rightDetails.push(entry);
      return;
    }

    if (leftCount <= rightCount) {
      leftDetails.push(entry);
    } else {
      rightDetails.push(entry);
    }
  };

  detailCandidates.forEach(({ preferred, ...entry }) => {
    distributeDetail(entry, preferred);
  });

  const rebalanceColumns = (source, target, protectedCount) => {
    let moved = false;
    while (source.length > target.length) {
      const indexToMove = source.findIndex((_, idx) => idx >= protectedCount);
      if (indexToMove === -1) break;
      target.push(source.splice(indexToMove, 1)[0]);
      moved = true;
    }
    return moved;
  };

  rebalanceColumns(leftDetails, rightDetails, baseLeftDetails.length);
  rebalanceColumns(rightDetails, leftDetails, baseRightDetails.length);

  const rowCount = Math.max(leftDetails.length, rightDetails.length);
  const detailRows = Array.from({ length: rowCount }, (_, index) => ({
    left: leftDetails[index],
    right: rightDetails[index],
  }));

  useEffect(() => {
    setTaskActionError(null);
    setPendingTaskIndex(null);
    setShowCancelModal(false);
    setCancelReason("Falta pieza");
    setCancelDetail("");
    setCancelError(null);
    setIsCancelling(false);
  }, [orden?.code]);

  const isOrderCancelled = Number(info?.status) === 3;

  const cancellationNotes = useMemo(() => {
    const raw = info?.obs_anulada;
    if (Array.isArray(raw)) {
      return raw.filter((entry) =>
        typeof entry === "string" ? entry.trim().length > 0 : false
      );
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
      return [raw.trim()];
    }
    return null;
  }, [info?.obs_anulada]);

  const handleTaskNavigation = async (task, index) => {
    if (!orden?.code && orden?.code !== 0) return;
    const hasStarted = Boolean(task?.init_task);
    const isCompleted = Number(task?.status) === 2;
    const shouldStart = !hasStarted && !isCompleted;
    try {
      setPendingTaskIndex(index);
      setTaskActionError(null);
      let updatedOrder = orden;

      if (shouldStart) {
        const { order: nextOrder } = await startOrderTask(orden.code, index);
        updatedOrder = nextOrder;
        onUpdateOrder?.(nextOrder);
      }

      navigate(`/mantenedor/orden/${orden.code}/tarea/${index}`, {
        state: {
          order: updatedOrder,
          taskIndex: index,
        },
      });
    } catch (error) {
      console.error("Failed to start task", error);
      setTaskActionError("No se pudo iniciar la tarea. Inténtalo nuevamente.");
    } finally {
      setPendingTaskIndex(null);
    }
  };

  const handleCancelOrder = async () => {
    if (!orden?.code && orden?.code !== 0) return;
    const trimmedDetail = cancelDetail.trim();
    if (!cancelReason) {
      setCancelError("Selecciona un motivo para anular la orden.");
      return;
    }
    if (trimmedDetail.length === 0) {
      setCancelError("Describe el motivo con más detalle.");
      return;
    }
    try {
      setIsCancelling(true);
      setCancelError(null);
      const updatedOrder = await cancelOrder(
        orden.code,
        cancelReason,
        trimmedDetail
      );
      onUpdateOrder?.(updatedOrder);
      setShowCancelModal(false);
    } catch (error) {
      console.error("Failed to cancel order", error);
      setCancelError("No se pudo anular la orden. Inténtalo nuevamente.");
    } finally {
      setIsCancelling(false);
    }
  };

  const qualityInfo = [
    {
      label: "Seg. y Medio Ambiente",
      value: info["Seg. y Medio Ambiente"],
    },
    { label: "Calidad", value: info["Calidad"] },
    { label: "Operación", value: info["Operacion"] },
    { label: "Mantenimiento", value: info["Mantenimiento"] },
    { label: "Categorización", value: info["Categorizacion"] },
    { label: "Tipo de Servicio", value: info["Tipo de Servicio"] },
  ];

  const observations = normalizeValue(info.observaciones, "Sin observaciones");

  if (!orden) {
    return null;
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">
            Orden #{normalizeValue(orden.code, "N/A")}
          </h2>
          <p className="text-sm text-slate-600">
            Estado actual: {normalizeValue(info["Estado"], "N/A")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
            Tareas {completedTasks}/{totalTasks}
          </span>
          <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            Horas estimadas: {estimatedHours}
          </span>
          <span className="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Prioridad: {priority}
          </span>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-y-3 text-sm text-slate-800 md:grid-cols-2 md:gap-x-8">
        {detailRows.map(({ left, right }, index) => (
          <Fragment
            key={`${left?.label ?? "left"}-${right?.label ?? "right"}-${index}`}
          >
            <div className="flex gap-2">
              <span className="w-36 shrink-0 font-semibold text-slate-600">
                {left?.label ? `${left.label}:` : ""}
              </span>
              <span className="flex-1 text-slate-900">
                {normalizeValue(left?.value)}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="w-36 shrink-0 font-semibold text-slate-600">
                {right?.label ? `${right.label}:` : ""}
              </span>
              <span className="flex-1 text-slate-900">
                {normalizeValue(right?.value)}
              </span>
            </div>
          </Fragment>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 text-sm text-slate-800 md:grid-cols-3">
        {qualityInfo.map(({ label, value }) => (
          <div
            key={label}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm"
          >
            <p className="text-xs uppercase tracking-wide text-slate-600">
              {label}
            </p>
            <p className="mt-1 font-medium text-slate-900">
              {normalizeValue(value)}
            </p>
          </div>
        ))}
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-4 text-sm text-slate-800">
        <h3 className="text-base font-semibold text-slate-900">
          Observaciones
        </h3>
        <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-900">
          {observations}
        </p>
        {isOrderCancelled && cancellationNotes?.length ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-semibold uppercase tracking-wide">
              Orden anulada
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {cancellationNotes.map((entry, idx) => (
                <li key={idx}>{entry}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              setShowCancelModal(true);
              setCancelError(null);
            }}
            disabled={isOrderCancelled}
          >
            {isOrderCancelled ? "Orden anulada" : "Anular Orden"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => protocolos.length && setShowProtocolModal(true)}
            disabled={!protocolos.length}
          >
            {protocolos.length ? "Ver anexos" : "Sin anexos"}
          </button>
        </div>
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">
            Tareas de la orden
          </h3>
          <span className="text-xs font-medium text-slate-600">
            {tasks.length} registros
          </span>
        </div>
        {taskActionError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {taskActionError}
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-2 font-semibold">#</th>
                <th className="px-4 py-2 font-semibold">Taller</th>
                <th className="px-4 py-2 font-semibold">Descripción</th>
                <th className="px-4 py-2 font-semibold">Hs estimadas</th>
                <th className="px-4 py-2 font-semibold">Estado</th>
                <th className="px-4 py-2 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {tasks.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-4 text-center text-sm text-slate-600"
                  >
                    No hay tareas registradas para esta orden.
                  </td>
                </tr>
              ) : (
                tasks.map((task, index) => {
                  const statusKey = Number.isFinite(Number(task?.status))
                    ? Number(task.status)
                    : null;
                  const status =
                    statusKey !== null ? TASK_STATUS_META[statusKey] : null;
                  const hasStarted = Boolean(task?.init_task);
                  const isCompleted = Number(task?.status) === 2;
                  const actionLabel = isCompleted
                    ? "Ver tarea"
                    : hasStarted
                    ? "Continuar"
                    : "Iniciar";
                  return (
                    <tr key={index} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-sm text-slate-600">
                        {index + 1}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {normalizeValue(task?.Taller, "-")}
                      </td>
                      <td className="px-4 py-3">
                        {normalizeValue(task?.Descripcion, "-")}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {normalizeValue(task?.["Hs Estim"], "-")}
                      </td>
                      <td className="px-4 py-3">
                        {status ? (
                          <span className={status.chipClass}>
                            {status.label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                            Sin estado
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleTaskNavigation(task, index)}
                          disabled={pendingTaskIndex === index}
                        >
                          {pendingTaskIndex === index
                            ? "Abriendo..."
                            : actionLabel}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {protocolos.length > 0 && showProtocolModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Protocolos de seguridad
                </h3>
                <p className="text-sm text-slate-600">
                  Anexos disponibles para la orden #
                  {normalizeValue(orden.code, "N/A")}.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowProtocolModal(false)}
              >
                Cerrar
              </button>
            </header>
            <div className="flex flex-col gap-3 px-5 py-4">
              {protocolos.length > 1 && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <label
                    className="text-sm font-medium text-slate-700"
                    htmlFor="protocol-select"
                  >
                    Seleccionar anexo
                  </label>
                  <select
                    id="protocol-select"
                    className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    value={selectedProtocolIndex}
                    onChange={(event) =>
                      setSelectedProtocolIndex(Number(event.target.value))
                    }
                  >
                    {protocolos.map((_, index) => (
                      <option key={index} value={index}>
                        Anexo {index + 1}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {normalizeValue(
                    protocolos[selectedProtocolIndex],
                    "No hay anexos disponibles"
                  )}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-md rounded-xl bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Anular orden
                </h3>
                <p className="text-sm text-slate-600">
                  Selecciona el motivo y agrega detalles.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowCancelModal(false)}
                disabled={isCancelling}
              >
                Cerrar
              </button>
            </header>
            <div className="flex flex-col gap-4 px-5 py-4">
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Motivo
                <select
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  disabled={isCancelling}
                >
                  <option value="Falta pieza">Falta pieza</option>
                  <option value="Otro">Otro</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Detalle
                <textarea
                  className="h-28 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Describe la razón de la anulación"
                  value={cancelDetail}
                  onChange={(event) => setCancelDetail(event.target.value)}
                  disabled={isCancelling}
                />
              </label>
              {cancelError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {cancelError}
                </div>
              )}
            </div>
            <footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowCancelModal(false)}
                disabled={isCancelling}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleCancelOrder}
                disabled={isCancelling}
              >
                {isCancelling ? "Anulando..." : "Confirmar anulación"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

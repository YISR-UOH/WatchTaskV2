import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { unstable_Activity, Activity as ActivityStable } from "react";
import { getOrderByCode } from "@/utils/APIdb";

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

export default function TaskDetail() {
  const { code: codeParam, taskIndex: taskIndexParam } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const taskIndex = useMemo(() => {
    const parsed = Number.parseInt(taskIndexParam ?? "", 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [taskIndexParam]);

  const initialOrder = location.state?.order ?? null;
  const [order, setOrder] = useState(initialOrder);
  const [loading, setLoading] = useState(!initialOrder);
  const [error, setError] = useState(null);

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

  const statusLabel = useMemo(() => {
    if (!task) return "N/A";
    const key = Number(task.status);
    return TASK_STATUS_LABEL[key] ?? normalizeValue(task.status, "N/A");
  }, [task]);

  const handleBack = () => {
    navigate(`/mantenedor/orden/${codeParam}`, {
      state: order ? { order } : undefined,
    });
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
        </div>
      </Activity>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import { formatChileDate, formatChileISODate } from "@/utils/timezone";

const CHECKLIST_ITEMS = [
  {
    item: 1,
    text: "¿Verificó que retiró todas las herramientas utilizadas en la mantención y limpió antes de guardar?",
  },
  {
    item: 2,
    text: "¿Verificó que retiró todos los insumos utilizados en la máquina? (Ej: grasas, trapos, envases, cartón, etc.)",
  },
  {
    item: 3,
    text: "¿Verificó que retiró todos los repuestos de la máquina y los dejó en el lugar correcto?",
  },
  {
    item: 4,
    text: "¿Verificó que se encuentran puestas todas las tapas y protecciones?",
  },
  {
    item: 5,
    text: "¿Dejó limpios y ordenados los sectores donde trabajó?",
  },
  {
    item: 6,
    text: "¿Retiró todos los dispositivos de bloqueo y/o lockout?",
  },
  {
    item: 7,
    text: "¿Probó el equipo antes de la puesta en marcha?",
  },
];

const buildInitialChecklist = ({
  order,
  task,
  taskIndex,
  user,
  initialData,
}) => {
  const baseMeta = {
    order_id: order?.code ?? null,
    task_id:
      task?.Codigo ??
      task?.code ??
      task?.task_id ??
      (typeof taskIndex === "number" ? taskIndex + 1 : null),
    task_index: typeof taskIndex === "number" ? taskIndex : null,
    detalle_mant:
      task?.Descripcion ??
      order?.info?.Descripcion ??
      order?.info?.detalle_mant ??
      "",
    mantenedor_code: user?.code ?? "",
    mantenedor_name: user?.name ?? "",
    fecha: formatChileISODate(),
  };

  const baseAnswers = CHECKLIST_ITEMS.map(({ item }) => ({
    item,
    si: false,
    no: false,
    na: false,
    obs: "",
  }));

  const baseSupervisor = {
    nombre: user?.role === "supervisor" ? user.name : "",
    fecha: user?.role === "supervisor" ? formatChileISODate() : "",
    firma: user?.role === "supervisor" ? String(user.code) : "",
  };

  if (!initialData) {
    return {
      meta: baseMeta,
      answers: baseAnswers,
      otrasObservaciones: "",
      supervisor: baseSupervisor,
    };
  }

  const hydrateAnswer = (item) => {
    const existing = initialData?.answers?.find(
      (answer) => answer.item === item
    );
    if (!existing) return baseAnswers.find((answer) => answer.item === item);
    const estado = String(existing.estado || "").toUpperCase();
    return {
      item,
      si: estado === "SI",
      no: estado === "NO",
      na: estado === "NA" || estado === "N/A",
      obs: existing.obs ?? "",
    };
  };

  return {
    meta: {
      ...baseMeta,
      ...(initialData.meta || {}),
      fecha: initialData?.meta?.fecha || baseMeta.fecha,
    },
    answers: baseAnswers.map(({ item }) => hydrateAnswer(item)),
    otrasObservaciones: initialData?.otrasObservaciones || "",
    supervisor: {
      ...baseSupervisor,
      ...(initialData?.supervisor || {}),
    },
  };
};

const serializeChecklist = (checklist) => ({
  meta: {
    ...checklist.meta,
    fecha: checklist.meta?.fecha || formatChileISODate(),
  },
  answers: checklist.answers.map((answer) => ({
    item: answer.item,
    estado: answer.si ? "SI" : answer.no ? "NO" : answer.na ? "NA" : "",
    obs: (answer.obs || "").trim(),
  })),
  otrasObservaciones: (checklist.otrasObservaciones || "").trim(),
  supervisor: {
    nombre: (checklist.supervisor?.nombre || "").trim(),
    fecha: checklist.supervisor?.fecha || "",
    firma: (checklist.supervisor?.firma || "").trim(),
  },
});

export default function OrderCompletionChecklist({
  isOpen,
  order,
  task,
  taskIndex,
  user: propUser,
  initialData,
  onCancel,
  onSubmit,
  saving = false,
  submitError = null,
}) {
  const { user: currentUser } = useAuth();
  const user = propUser || currentUser;

  const createInitialState = useCallback(
    () =>
      buildInitialChecklist({
        order,
        task,
        taskIndex,
        user,
        initialData,
      }),
    [order, task, taskIndex, user, initialData]
  );

  const [checklist, setChecklist] = useState(createInitialState);

  useEffect(() => {
    setChecklist(createInitialState());
  }, [createInitialState]);

  useEffect(() => {
    if (user?.role === "supervisor" && checklist.supervisor) {
      const needsAutoFill =
        !checklist.supervisor.nombre ||
        !checklist.supervisor.fecha ||
        !checklist.supervisor.firma;
      if (needsAutoFill) {
        setChecklist((prev) => ({
          ...prev,
          supervisor: {
            nombre: user.name,
            fecha: formatChileISODate(),
            firma: String(user.code),
          },
        }));
      }
    }
  }, [user, checklist.supervisor]);

  const canFinalize = useMemo(
    () =>
      checklist.answers.every((answer) => answer.si || answer.no || answer.na),
    [checklist.answers]
  );

  const toggleAnswer = useCallback((index, field) => {
    setChecklist((prev) => {
      const answers = prev.answers.map((answer, idx) => {
        if (idx !== index) return answer;
        return {
          ...answer,
          si: field === "si" ? !answer.si : false,
          no: field === "no" ? !answer.no : false,
          na: field === "na" ? !answer.na : false,
        };
      });
      return { ...prev, answers };
    });
  }, []);

  const updateAnswerObs = useCallback((index, value) => {
    setChecklist((prev) => {
      const answers = prev.answers.map((answer, idx) =>
        idx === index ? { ...answer, obs: value } : answer
      );
      return { ...prev, answers };
    });
  }, []);

  const updateSupervisor = useCallback((field, value) => {
    setChecklist((prev) => ({
      ...prev,
      supervisor: { ...prev.supervisor, [field]: value },
    }));
  }, []);

  const updateObservaciones = useCallback((value) => {
    setChecklist((prev) => ({ ...prev, otrasObservaciones: value }));
  }, []);

  const handleSubmit = async () => {
    if (!canFinalize || saving) return;
    const payload = serializeChecklist(checklist);
    try {
      await onSubmit?.(payload);
    } catch {}
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4">
      <div className="flex w-full max-w-5xl max-h-[95vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
              Orden #{order?.code ?? ""}
            </p>
            <h2 className="text-2xl font-semibold text-slate-900">
              Checklist término de mantención
            </h2>
            <p className="text-sm text-slate-600">
              Complete el formulario para cerrar la orden. Revise cada punto y
              registre observaciones si corresponde.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={onCancel}
            disabled={saving}
          >
            Cerrar
          </button>
        </header>

        <div className="flex-1 overflow-y-auto bg-white px-6 py-6">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
            {submitError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {submitError}
              </div>
            ) : null}

            <section className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Máquina / Cuerpo
                  </span>
                  <span className="text-base font-semibold text-slate-900">
                    {checklist.meta.detalle_mant || "-"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Mantenedor
                  </span>
                  <span className="text-base font-semibold text-slate-900">
                    {checklist.meta.mantenedor_name || "-"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Código mantenedor
                  </span>
                  <span className="text-base font-semibold text-slate-900">
                    {checklist.meta.mantenedor_code || "-"}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Fecha
                  </span>
                  <span className="text-base font-semibold text-slate-900">
                    {formatChileDate(checklist.meta.fecha || Date.now())}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Orden
                  </span>
                  <span className="text-base font-semibold text-slate-900">
                    {order?.code ?? "-"}
                  </span>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 shadow-sm">
                CONTESTE CON UNA "X" EN "SÍ", "NO" O "N/A" SEGÚN LO OBSERVADO.
                SI SELECCIONA "NO", REGISTRE EL MOTIVO EN LAS OBSERVACIONES.
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
                <div className="max-h-[50vh] overflow-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm text-slate-800">
                    <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="w-16 px-4 py-3 text-center">Item</th>
                        <th className="px-4 py-3 text-left">
                          Inspección primaria
                        </th>
                        <th className="w-20 px-4 py-3 text-center">Sí</th>
                        <th className="w-20 px-4 py-3 text-center">No</th>
                        <th className="w-20 px-4 py-3 text-center">N/A</th>
                        <th className="px-4 py-3 text-left">Observaciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {CHECKLIST_ITEMS.map(({ item, text }) => {
                        const index = item - 1;
                        const answer = checklist.answers[index];
                        const questionLabel = `Item ${item}: ${text}`;
                        const obsId = `checklist-item-${item}-obs`;
                        return (
                          <tr key={item} className="align-top">
                            <td className="px-4 py-3 text-center font-semibold text-slate-700">
                              {item}
                            </td>
                            <td className="px-4 py-3 text-slate-800">{text}</td>
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                checked={answer.si}
                                onChange={() => toggleAnswer(index, "si")}
                                disabled={saving}
                                aria-label={`${questionLabel} - Sí`}
                              />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                checked={answer.no}
                                onChange={() => toggleAnswer(index, "no")}
                                disabled={saving}
                                aria-label={`${questionLabel} - No`}
                              />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                checked={answer.na}
                                onChange={() => toggleAnswer(index, "na")}
                                disabled={saving}
                                aria-label={`${questionLabel} - No aplica`}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <textarea
                                id={obsId}
                                rows={2}
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100"
                                value={answer.obs}
                                onChange={(event) =>
                                  updateAnswerObs(index, event.target.value)
                                }
                                disabled={saving}
                                aria-label={`${questionLabel} - Observaciones`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <label
                htmlFor="otras-observaciones"
                className="text-sm font-semibold text-slate-700"
              >
                Otras observaciones
              </label>
              <textarea
                id="otras-observaciones"
                rows={4}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100"
                value={checklist.otrasObservaciones}
                onChange={(event) => updateObservaciones(event.target.value)}
                disabled={saving}
              />
            </section>

            <section className="rounded-xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                  Revisión por supervisor
                </h3>
                <span className="text-xs font-medium text-slate-500">
                  Completar al cierre del turno
                </span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  Nombre
                  <input
                    type="text"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100"
                    value={checklist.supervisor.nombre}
                    onChange={(event) =>
                      updateSupervisor("nombre", event.target.value)
                    }
                    disabled={saving || user?.role !== "supervisor"}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-700">
                  Fecha
                  <input
                    type="date"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100"
                    value={checklist.supervisor.fecha}
                    onChange={(event) =>
                      updateSupervisor("fecha", event.target.value)
                    }
                    disabled={saving || user?.role !== "supervisor"}
                  />
                </label>
                <label className="sm:col-span-2 flex flex-col gap-1 text-sm text-slate-700">
                  Firma
                  <input
                    type="text"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100"
                    value={checklist.supervisor.firma}
                    onChange={(event) =>
                      updateSupervisor("firma", event.target.value)
                    }
                    disabled={saving || user?.role !== "supervisor"}
                  />
                </label>
              </div>
            </section>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            className="btn btn-outline"
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!canFinalize || saving}
          >
            {saving ? "Guardando..." : "Guardar checklist"}
          </button>
        </footer>
      </div>
    </div>
  );
}


/**
 * Vista de Dashboard
 * funciona como modulo visual para supervisores y administradores.
 * el supervisor puede ver estadisticas de el mismo y de su equipo.
 * el administrador puede ver estadisticas globales.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "@/Context/AuthContext";
import { listOrders, listUsers } from "@/utils/APIdb";

const SPECIALITY_LABELS = {
  1: "Eléctrico",
  2: "Mecánico",
  3: "Instrumentista",
  4: "Electrónico",
};

const numberFormatter = new Intl.NumberFormat("es-CL");
const percentFormatter = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 0,
});

const toFloat = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const extractEstimatedHours = (order) => {
  if (!order) return null;
  const sources = [
    order?.tasks?.h_estimadas,
    order?.info?.h_estimadas,
    order?.info?.["Hs Estim"],
    order?.info?.["Hs estimadas"],
  ];
  for (const source of sources) {
    const parsed = toFloat(source);
    if (parsed !== null) return parsed;
  }
  return null;
};

const extractActualCompletionHours = (order) => {
  if (!order) return null;
  const infoValue = toFloat(order?.info?.hs_reales ?? order?.info?.Hs_reales);
  if (infoValue !== null) return infoValue;

  const tasks = order?.tasks?.data;
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  let totalSeconds = 0;
  for (const task of tasks) {
    const duration = Number(task?.duration_seconds);
    if (Number.isFinite(duration) && duration > 0) {
      totalSeconds += duration;
      continue;
    }
    const start = task?.init_task ? new Date(task.init_task) : null;
    const end = task?.end_task ? new Date(task.end_task) : null;
    const startMs = start?.getTime?.();
    const endMs = end?.getTime?.();
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      const diff = (endMs - startMs) / 1000;
      if (Number.isFinite(diff) && diff > 0) {
        totalSeconds += diff;
      }
    }
  }
  if (totalSeconds <= 0) return null;
  return totalSeconds / 3600;
};

const formatHoursValue = (value) => {
  if (!Number.isFinite(value)) return "N/D";
  return `${value.toFixed(1)} h`;
};

const formatDeviationValue = (value) => {
  if (!Number.isFinite(value)) return "N/D";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} h`;
};

const deviationClassName = (value) => {
  if (!Number.isFinite(value) || value === 0) return "text-slate-600";
  return value > 0 ? "text-rose-600" : "text-emerald-600";
};

const getSpecialityLabel = (value) => {
  if (value === undefined || value === null || value === "") {
    return "Sin especialidad";
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return SPECIALITY_LABELS[parsed] || `Especialidad ${parsed}`;
  }
  return String(value);
};

const getOrderStatus = (order) => {
  const status = Number(order?.info?.status);
  if (Number.isFinite(status)) return status;
  return 0;
};

const summarizeOrders = (orders) => {
  const summary = {
    total: orders.length,
    pending: 0,
    inProgress: 0,
    completed: 0,
    canceled: 0,
    expired: 0,
    complianceRate: 0,
    avgCompletionHours: null,
    avgDeviationHours: null,
    assignedCount: 0,
  };
  let completionSamples = 0;
  let totalCompletionHours = 0;
  let deviationSamples = 0;
  let totalDeviationHours = 0;

  for (const order of orders) {
    const status = getOrderStatus(order);
    if (status === 2) {
      summary.completed += 1;
      const actualHours = extractActualCompletionHours(order);
      if (Number.isFinite(actualHours)) {
        totalCompletionHours += actualHours;
        completionSamples += 1;
      }
      const estimatedHours = extractEstimatedHours(order);
      if (Number.isFinite(actualHours) && Number.isFinite(estimatedHours)) {
        totalDeviationHours += actualHours - estimatedHours;
        deviationSamples += 1;
      }
    } else if (status === 1) {
      summary.inProgress += 1;
    } else if (status === 3) {
      summary.canceled += 1;
    } else if (status === 4) {
      summary.expired += 1;
    } else {
      summary.pending += 1;
    }

    if (status === 0 || status === 1 || status === 2 || status === 4) {
      summary.assignedCount += 1;
    }
  }

  const assignedDenominator = summary.assignedCount;
  summary.complianceRate =
    assignedDenominator > 0
      ? Math.round((summary.completed / assignedDenominator) * 100)
      : 0;

  summary.avgCompletionHours =
    completionSamples > 0 ? totalCompletionHours / completionSamples : null;
  summary.avgDeviationHours =
    deviationSamples > 0 ? totalDeviationHours / deviationSamples : null;

  return summary;
};

const groupOrdersByAssignee = (orders) => {
  const map = new Map();
  for (const order of orders) {
    const code = Number(order?.info?.asignado_a_code);
    if (!Number.isFinite(code)) continue;
    if (!map.has(code)) {
      map.set(code, []);
    }
    map.get(code).push(order);
  }
  return map;
};

const buildUserComplianceEntries = (users, ordersByAssignee) =>
  users.map((person) => {
    const numericCode = Number(person?.code);
    const userOrders = Number.isFinite(numericCode)
      ? ordersByAssignee.get(numericCode) || []
      : [];
    const summary = summarizeOrders(userOrders);
    return {
      code: person?.code,
      name: person?.name || `Usuario ${person?.code ?? "N/R"}`,
      specialityLabel: getSpecialityLabel(person?.speciality),
      summary,
    };
  });

const buildSpecialitySummaries = (orders) => {
  const buckets = new Map();
  for (const order of orders) {
    const raw = order?.info?.["Especialidad_id"];
    const numeric = Number(raw);
    const key = Number.isFinite(numeric) ? numeric : "sin-especialidad";
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(order);
  }
  return Array.from(buckets.entries()).map(([key, list]) => {
    const label =
      key === "sin-especialidad"
        ? "Sin especialidad"
        : getSpecialityLabel(key);
    return {
      key,
      label,
      summary: summarizeOrders(list),
    };
  });
};

const StatCard = ({ title, value, subtitle, children }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-sm font-medium text-slate-500">{title}</p>
    <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
    {subtitle ? (
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {subtitle}
      </p>
    ) : null}
    {children ? <div className="mt-3">{children}</div> : null}
  </div>
);

const StatusBreakdown = ({ summary }) => {
  const segments = [
    {
      label: "Pendientes",
      value: summary.pending,
      color: "bg-amber-100 text-amber-800",
    },
    {
      label: "En progreso",
      value: summary.inProgress,
      color: "bg-blue-100 text-blue-800",
    },
    {
      label: "Completadas",
      value: summary.completed,
      color: "bg-emerald-100 text-emerald-800",
    },
    {
      label: "Vencidas",
      value: summary.expired,
      color: "bg-rose-100 text-rose-800",
    },
    {
      label: "Anuladas",
      value: summary.canceled,
      color: "bg-slate-100 text-slate-700",
    },
  ];
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {segments.map((segment) => (
        <span
          key={segment.label}
          className={`rounded-full px-2 py-1 ${segment.color}`}
        >
          {segment.label}: {segment.value}
        </span>
      ))}
    </div>
  );
};

const ComplianceTable = ({ title, entries, emptyMessage }) => (
  <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-4 py-2">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-semibold">Nombre</th>
            <th className="px-4 py-2 font-semibold">Especialidad</th>
            <th className="px-4 py-2 font-semibold">Asignadas</th>
            <th className="px-4 py-2 font-semibold">Completadas</th>
            <th className="px-4 py-2 font-semibold">Cumplimiento</th>
            <th className="px-4 py-2 font-semibold">Desvío vs. estimado</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td
                className="px-4 py-6 text-center text-slate-400"
                colSpan={7}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            entries.map((entry) => (
              <tr
                key={entry.code}
                className="border-t border-slate-100 text-slate-700"
              >
                <td className="px-4 py-2">{entry.name}</td>
                <td className="px-4 py-2">{entry.specialityLabel}</td>
                <td className="px-4 py-2">
                  {entry.summary.assignedCount ?? entry.summary.total}
                </td>
                <td className="px-4 py-2">{entry.summary.completed}</td>
                <td className="px-4 py-2 font-semibold">
                  {percentFormatter.format(entry.summary.complianceRate)}%
                </td>
                <td className="px-4 py-2">
                  <span className={`font-semibold ${deviationClassName(entry.summary.avgDeviationHours)}`}>
                    {formatDeviationValue(entry.summary.avgDeviationHours)}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

const CompletionMetrics = ({ summary, compact = false }) => {
  if (!summary) return null;
  const hasAvg = Number.isFinite(summary.avgCompletionHours);
  const hasDeviation = Number.isFinite(summary.avgDeviationHours);
  if (!hasAvg && !hasDeviation) return null;
  const baseClass = compact ? "text-[11px]" : "text-xs";
  return (
    <div className={`${baseClass} mt-2 space-y-1 text-slate-600`}>
      {hasAvg ? (
        <p>
          Tiempo prom. cierre: <strong>{formatHoursValue(summary.avgCompletionHours)}</strong>
        </p>
      ) : null}
      {hasDeviation ? (
        <p>
          Desvío: {" "}
          <span className={`font-semibold ${deviationClassName(summary.avgDeviationHours)}`}>
            {formatDeviationValue(summary.avgDeviationHours)}
          </span>
        </p>
      ) : null}
    </div>
  );
};

export default function Dashboard() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reloadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ordersData, usersData] = await Promise.all([
        listOrders(),
        listUsers(),
      ]);
      setOrders(Array.isArray(ordersData) ? ordersData : []);
      setUsers(Array.isArray(usersData) ? usersData : []);
    } catch (err) {
      setError(err?.message || "No fue posible cargar las estadísticas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadData();
  }, [reloadData]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const refresh = () => reloadData();
    window.addEventListener("orders:changed", refresh);
    window.addEventListener("users:changed", refresh);
    return () => {
      window.removeEventListener("orders:changed", refresh);
      window.removeEventListener("users:changed", refresh);
    };
  }, [reloadData]);

  const isAdmin = user?.role === "admin";
  const isSupervisor = user?.role === "supervisor";

  const ordersByAssignee = useMemo(
    () => groupOrdersByAssignee(orders),
    [orders]
  );

  const maintainers = useMemo(
    () => users.filter((u) => u.role === "mantenedor" && u.active !== false),
    [users]
  );

  const supervisors = useMemo(
    () => users.filter((u) => u.role === "supervisor" && u.active !== false),
    [users]
  );

  const globalSummary = useMemo(() => summarizeOrders(orders), [orders]);
  const specialitySummaries = useMemo(
    () => buildSpecialitySummaries(orders).sort((a, b) => b.summary.total - a.summary.total),
    [orders]
  );
  const maintainerEntries = useMemo(
    () =>
      buildUserComplianceEntries(maintainers, ordersByAssignee).sort(
        (a, b) => b.summary.complianceRate - a.summary.complianceRate
      ),
    [maintainers, ordersByAssignee]
  );

  const supervisorSpecialityOrders = useMemo(() => {
    if (!isSupervisor) return [];
    const speciality = user?.speciality;
    if (speciality === undefined || speciality === null || speciality === "") {
      return [];
    }
    return orders.filter((order) => {
      const raw = order?.info?.["Especialidad_id"];
      return String(raw) === String(speciality);
    });
  }, [orders, isSupervisor, user?.speciality]);

  const supervisorSpecialitySummary = useMemo(
    () => summarizeOrders(supervisorSpecialityOrders),
    [supervisorSpecialityOrders]
  );

  const teamMaintainers = useMemo(() => {
    if (!isSupervisor) return [];
    const speciality = user?.speciality;
    if (speciality === undefined || speciality === null || speciality === "") {
      return [];
    }
    return maintainers.filter(
      (maint) => String(maint.speciality) === String(speciality)
    );
  }, [isSupervisor, maintainers, user?.speciality]);

  const teamEntries = useMemo(
    () =>
      buildUserComplianceEntries(teamMaintainers, ordersByAssignee).sort(
        (a, b) => b.summary.complianceRate - a.summary.complianceRate
      ),
    [teamMaintainers, ordersByAssignee]
  );

  const supervisorCards = (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-1">
        <StatCard
          title={`Especialidad ${getSpecialityLabel(user?.speciality)}`}
          value={numberFormatter.format(
            supervisorSpecialitySummary.total || 0
          )}
          subtitle={`Cumplimiento ${percentFormatter.format(
            supervisorSpecialitySummary.complianceRate || 0
          )}%`}
        >
          <StatusBreakdown summary={supervisorSpecialitySummary} />
          <CompletionMetrics summary={supervisorSpecialitySummary} />
        </StatCard>
      </div>
      <ComplianceTable
        title="Equipo de mantenedores"
        entries={teamEntries}
        emptyMessage="No hay mantenedores activos en tu especialidad."
      />
    </div>
  );

  const adminCards = (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Órdenes registradas" value={numberFormatter.format(globalSummary.total)}>
          <StatusBreakdown summary={globalSummary} />
          <CompletionMetrics summary={globalSummary} />
        </StatCard>
        <StatCard
          title="Órdenes completadas"
          value={numberFormatter.format(globalSummary.completed)}
          subtitle="Último estado global"
        >
          <p className="text-sm text-slate-600">
            Cumplimiento {percentFormatter.format(globalSummary.complianceRate)}%
          </p>
        </StatCard>
        <StatCard
          title="Órdenes vencidas"
          value={numberFormatter.format(globalSummary.expired)}
          subtitle="Incluye anuladas por vencimiento"
        >
          <p className="text-sm text-slate-600">
            Anuladas: {numberFormatter.format(globalSummary.canceled)}
          </p>
        </StatCard>
      </div>
      <div className="grid gap-4 grid-cols-1">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-700">
              Cumplimiento por especialidad
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {specialitySummaries.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">
                Aún no hay órdenes registradas.
              </p>
            ) : (
              specialitySummaries.map((item) => (
                <div
                  key={item.key}
                  className="flex flex-col gap-1 px-4 py-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-800">{item.label}</p>
                      <p className="text-xs text-slate-500">
                        {numberFormatter.format(item.summary.completed)} completadas de {" "}
                        {numberFormatter.format(item.summary.total)}
                      </p>
                    </div>
                    <span className="text-base font-semibold text-slate-700">
                      {percentFormatter.format(item.summary.complianceRate)}%
                    </span>
                  </div>
                  <CompletionMetrics summary={item.summary} compact />
                </div>
              ))
            )}
          </div>
        </div>
        <ComplianceTable
          title="Cumplimiento de mantenedores"
          entries={maintainerEntries}
          emptyMessage="No hay mantenedores activos."
        />
      </div>
      
    </div>
  );

  if (!isAdmin && !isSupervisor) {
    return (
      <div className="p-6">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Esta vista está disponible para supervisores y administradores.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          Dashboard de cumplimiento
        </h1>
      </div>
      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
          Cargando estadísticas...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      ) : isAdmin ? (
        adminCards
      ) : (
        supervisorCards
      )}
    </div>
  );
}
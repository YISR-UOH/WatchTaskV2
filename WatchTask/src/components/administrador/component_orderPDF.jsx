/**
 * Transformar ordenes de mantenimiento en un PDF descargable.
 * Renderiza la vista previa generando un blob embebido en el sitio.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Page, Text, View, Document, pdf, Font, Image } from "@react-pdf/renderer";
import { listOrders, listUsers } from "@/utils/APIdb";
import LoraRegular from "@/fonts/Lora.ttf";
import LoraItalic from "@/fonts/Lora-Italic.ttf";
import { createTw } from "react-pdf-tailwind";

let fontsRegistered = false;

const STATUS_LABELS = {
  0: "Sin asignar",
  1: "Pendiente",
  2: "Completada",
  3: "Anulada",
  4: "Vencida",
};

const SPECIALITY_LABELS = {
  1: "Electrico",
  2: "Mecanico",
};

const DEFAULT_PREVIEW_LIMIT = 10;

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

const sanitizeIsoOffset = (value) => {
  if (typeof value !== "string") return value;
  return value.replace(
    /([+-])(\d{2}):(\d{1,2})(\.[0-9]+)/g,
    (_, sign, hourPart, minutePart, fractional) => {
      const minutesNumber = Number(`${minutePart}${fractional}`);
      const sanitizedMinutes = Number.isFinite(minutesNumber)
        ? Math.max(0, Math.min(59, Math.round(minutesNumber)))
        : Math.max(0, Math.min(59, Number.parseInt(minutePart, 10) || 0));
      return `${sign}${hourPart}:${String(sanitizedMinutes).padStart(2, "0")}`;
    }
  );
};

const formatFallbackDate = (value) => {
  if (!value) return "";
  const datePart = String(value).split(/[ T]/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [year, month, day] = datePart.split("-");
    return `${day}/${month}/${year}`;
  }
  return value;
};

function normalizeCode(value) {
  return String(value ?? "").trim();
}

function getStatusInfo(info) {
  const statusCode = Number(info?.status);
  if (Number.isFinite(statusCode)) {
    return {
      code: statusCode,
      label: STATUS_LABELS[statusCode] || `Estado #${statusCode}`,
    };
  }
  const fallback = normalizeCode(info?.status);
  return { code: null, label: fallback || "Sin estado" };
}

function getSpecialityLabel(info) {
  const rawId = Number(info?.["Especialidad_id"]);
  if (Number.isFinite(rawId)) {
    return SPECIALITY_LABELS[rawId] || `Especialidad #${rawId}`;
  }
  const fallback =
    info?.Especialidad ??
    info?.especialidad ??
    info?.speciality ??
    info?.Speciality;
  const label = normalizeCode(fallback);
  return label || "Sin especialidad";
}

function getUnitLabel(info) {
  const value =
    info?.["N Unidad"] ??
    info?.N_Unidad ??
    info?.Unidad ??
    info?.unidad ??
    info?.unit;
  const label = normalizeCode(value);
  return label || "Sin unidad";
}

function getDescription(info) {
  const value =
    info?.Descripcion ??
    info?.descripcion ??
    info?.description ??
    info?.Description;
  const label = normalizeCode(value);
  return label || "Sin descripcion";
}

function getStartDate(info) {
  const value = info["F inicial"];
  const label = normalizeCode(value);
  return label || "Sin fecha";
}

export default function OrderPDF() {
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [specialityFilter, setSpecialityFilter] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [selectedCodes, setSelectedCodes] = useState(() => new Set());
  const [previewUrl, setPreviewUrl] = useState("");
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [supervisorSignatures, setSupervisorSignatures] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoadingOrders(true);
    setLoadError("");

    listOrders()
      .then((result) => {
        if (cancelled) return;
        if (Array.isArray(result)) {
          setOrders(result);
        } else {
          setOrders([]);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : String(error || "")
          );
          setOrders([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingOrders(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((users) => {
        if (cancelled) return;
        const map = {};
        if (Array.isArray(users)) {
          users.forEach((user) => {
            const code = Number(user?.code);
            if (Number.isFinite(code) && user?.signature) {
              map[code] = user.signature;
            }
          });
        }
        setSupervisorSignatures(map);
      })
      .catch(() => {
        if (!cancelled) {
          setSupervisorSignatures({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const validCodes = new Set(
      orders.map((order) => normalizeCode(order?.code))
    );
    setSelectedCodes((prev) => {
      const next = new Set();
      prev.forEach((code) => {
        if (validCodes.has(code)) {
          next.add(code);
        }
      });
      return next.size === prev.size ? prev : next;
    });
  }, [orders]);

  const statusOptions = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      const { code, label } = getStatusInfo(order?.info || {});
      if (code != null) {
        map.set(String(code), label);
      }
    });
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [orders]);

  const specialityOptions = useMemo(() => {
    const set = new Set();
    orders.forEach((order) => {
      const label = getSpecialityLabel(order?.info || {});
      if (label) set.add(label);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (!orders.length) return [];
    const term = searchTerm.trim().toLowerCase();
    return orders
      .filter((order) => {
        const info = order?.info || {};
        const { code: statusCode } = getStatusInfo(info);
        if (statusFilter && String(statusCode ?? "") !== statusFilter) {
          return false;
        }
        const specialityLabel = getSpecialityLabel(info);
        if (specialityFilter && specialityLabel !== specialityFilter) {
          return false;
        }

        const unidad = info?.["N Unidad"] || "";
        const { machineName, machineDesc } = parseMachineCode(unidad);
        const machineNameUpper = (machineName || "").toUpperCase();
        const machineDescUpper = (machineDesc || "").toUpperCase();

        if (machineFilter) {
          const machineFilterUpper = machineFilter.toUpperCase();
          const machineLabelUpper = (
            MACHINES[machineFilter] || ""
          ).toUpperCase();
          if (machineNameUpper === "FL") {
            const matchesDesc = machineDescUpper.includes(machineFilterUpper);
            const matchesLabel = machineLabelUpper
              ? machineDescUpper.includes(machineLabelUpper)
              : false;
            if (!matchesDesc && !matchesLabel) {
              return false;
            }
          } else {
            const matchesName = machineNameUpper === machineFilterUpper;
            const matchesDesc = machineDescUpper.includes(machineFilterUpper);
            const matchesLabel = machineLabelUpper
              ? machineDescUpper.includes(machineLabelUpper)
              : false;
            if (!matchesName && !matchesDesc && !matchesLabel) {
              return false;
            }
          }
        }

        if (serviceFilter) {
          const serviceUpper = serviceFilter.toUpperCase();
          if (machineNameUpper !== serviceUpper) {
            return false;
          }
        }

        if (term) {
          const codeMatch = normalizeCode(order?.code).toLowerCase();
          const descriptionMatch = getDescription(info).toLowerCase();
          const unitMatch = getUnitLabel(info).toLowerCase();
          const kitMatch = normalizeCode(info?.["Kit de Tareas"]).toLowerCase();
          const assignedMatch = normalizeCode(
            info?.asignado_a_name
          ).toLowerCase();
          if (
            !codeMatch.includes(term) &&
            !descriptionMatch.includes(term) &&
            !unitMatch.includes(term) &&
            !assignedMatch.includes(term) &&
            !kitMatch.includes(term)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) =>
        normalizeCode(a?.code).localeCompare(normalizeCode(b?.code), "es")
      );
  }, [
    orders,
    searchTerm,
    statusFilter,
    specialityFilter,
    machineFilter,
    serviceFilter,
  ]);

  const selectedOrders = useMemo(() => {
    if (!selectedCodes.size) return [];
    return orders.filter((order) =>
      selectedCodes.has(normalizeCode(order?.code))
    );
  }, [orders, selectedCodes]);

  const pdfSourceOrders = useMemo(() => {
    if (selectedOrders.length) return selectedOrders;
    if (filteredOrders.length)
      return filteredOrders.slice(0, DEFAULT_PREVIEW_LIMIT);
    return [];
  }, [selectedOrders, filteredOrders]);

  const pdfData = useMemo(() => pdfSourceOrders, [pdfSourceOrders]);

  useEffect(() => {
    let cancelled = false;
    let currentUrl = "";

    if (!pdfData.length) {
      setPreviewUrl("");
      setRenderError("");
      setIsRendering(false);
      return () => {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
      };
    }

    const renderPreview = async () => {
      setIsRendering(true);
      setRenderError("");
      try {
        const blob = await pdf(
          pdfLayout(pdfData, { signaturesByUserCode: supervisorSignatures })
        ).toBlob();
        if (cancelled) return;
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = URL.createObjectURL(blob);
        setPreviewUrl(currentUrl);
      } catch (error) {
        if (!cancelled) {
          setRenderError(
            error instanceof Error ? error.message : String(error || "")
          );
          setPreviewUrl("");
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    };

    renderPreview();

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [pdfData, supervisorSignatures]);

  const frameStyle = useMemo(
    () => ({
      width: "100%",
      minHeight: "600px",
      border: "1px solid #e2e8f0",
      borderRadius: "0.75rem",
    }),
    []
  );

  const handleMachineFilterChange = (event) => {
    setServiceFilter("");
    setMachineFilter(event.target.value);
  };

  const handleServiceFilterChange = (event) => {
    setMachineFilter("");
    setServiceFilter(event.target.value);
  };

  const toggleSelection = (code) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    const next = new Set(
      filteredOrders.map((order) => normalizeCode(order?.code))
    );
    setSelectedCodes(next);
  };

  const clearSelection = () => {
    setSelectedCodes(new Set());
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="card space-y-4 p-4">
        <header>
          <h2 className="text-lg font-semibold text-slate-900">
            Buscador de ordenes
          </h2>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label
              htmlFor="order-search-term"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Buscar
            </label>
            <input
              id="order-search-term"
              type="text"
              className="input w-full"
              placeholder="Codigo, descripcion, unidad o asignado"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              disabled={loadingOrders}
            />
          </div>
          <div>
            <label
              htmlFor="order-status-filter"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Estado
            </label>
            <select
              id="order-status-filter"
              className="input w-full"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              disabled={loadingOrders}
            >
              <option value="">Todos</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="order-speciality-filter"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Especialidad
            </label>
            <select
              id="order-speciality-filter"
              className="input w-full"
              value={specialityFilter}
              onChange={(event) => setSpecialityFilter(event.target.value)}
              disabled={loadingOrders}
            >
              <option value="">Todas</option>
              {specialityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="order-machine-filter"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Maquina
            </label>
            <select
              id="order-machine-filter"
              className="input w-full"
              value={machineFilter}
              onChange={handleMachineFilterChange}
              disabled={loadingOrders}
            >
              <option value="">Todas</option>
              {Object.entries(MACHINES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="order-service-filter"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Servicio
            </label>
            <select
              id="order-service-filter"
              className="input w-full"
              value={serviceFilter}
              onChange={handleServiceFilterChange}
              disabled={loadingOrders}
            >
              <option value="">Todos</option>
              {Object.entries(SERVICES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={selectAllFiltered}
              disabled={!filteredOrders.length}
            >
              Seleccionar filtradas
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={clearSelection}
              disabled={!selectedCodes.size}
            >
              Limpiar seleccion
            </button>
          </div>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-base font-semibold text-slate-900">
            Resultados ({filteredOrders.length})
          </h3>
          {loadingOrders ? (
            <span className="text-xs text-slate-500">Cargando ordenes...</span>
          ) : loadError ? (
            <span className="text-xs text-red-600">{loadError}</span>
          ) : (
            <span className="text-xs text-slate-500">
              {selectedCodes.size} seleccionada(s)
            </span>
          )}
        </header>
        {loadError ? (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            No se pudieron cargar las ordenes: {loadError}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            {loadingOrders
              ? "Cargando informacion..."
              : "No hay ordenes que coincidan con los filtros."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 h-64 overflow-y-auto">
            {filteredOrders.map((order) => {
              const info = order?.info || {};
              const code = normalizeCode(order?.code) || "N/D";
              const status = getStatusInfo(info);
              const specialityLabel = getSpecialityLabel(info);
              const isChecked = selectedCodes.has(code);
              return (
                <li key={code} className="py-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="checkbox mt-1"
                      checked={isChecked}
                      onChange={() => toggleSelection(code)}
                    />
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-sm text-slate-700">
                          #{code}
                        </span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {status.label}
                        </span>
                      </div>
                      <p className="text-sm text-slate-800">
                        {order.info.Descripcion}
                      </p>
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                        <span>Unidad: {getUnitLabel(info)}</span>
                        <span>Especialidad: {specialityLabel}</span>
                        <span>Fecha inicio: {getStartDate(info)}</span>
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        {pdfData.length === 0 ? (
          <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Selecciona o filtra ordenes para generar la vista previa.
          </div>
        ) : renderError ? (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            No se pudo generar la vista previa: {renderError}
          </div>
        ) : (
          <iframe
            title="Vista previa de ordenes"
            style={frameStyle}
            src={previewUrl || "about:blank"}
          />
        )}
        {isRendering ? (
          <span className="text-xs text-slate-500">
            Generando vista previa...
          </span>
        ) : null}
      </section>
    </div>
  );
}

if (!fontsRegistered) {
  Font.register({
    family: "Lora",
    fonts: [
      {
        src: LoraRegular,
        fontWeight: 400,
        fontStyle: "normal",
        format: "truetype",
      },
      {
        src: LoraRegular,
        fontWeight: 700,
        fontStyle: "normal",
        format: "truetype",
      },
      {
        src: LoraItalic,
        fontWeight: 400,
        fontStyle: "italic",
        format: "truetype",
      },
    ],
  });
  fontsRegistered = true;
}

const tw = createTw({
  theme: {
    fontWeight: {
      normal: 700,
      bold: 700,
    },
  },
  fontFamily: {
    serif: ["Lora"],
  },
});

const pdfLayout = (orders, options = {}) => {
  const signaturesByUserCode = options.signaturesByUserCode || {};
  const renderSignatureBlock = ({
    signature,
    rolePrefix,
    name,
    completionDate,
  }) => (
    <View style={tw("items-center")}>
      {signature ? (
        <Image
          src={signature}
          style={{ width: 180, height: 80, objectFit: "contain" }}
        />
      ) : (
        <View
          style={{
            width: 180,
            height: 80,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: "#94a3b8",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text>Sin firma</Text>
        </View>
      )}
      <Text style={tw("mt-2 text-center font-bold")}>
        {name ? `${rolePrefix} ${name}` : rolePrefix}
      </Text>
      {completionDate ? (
        <Text style={tw("text-center text-[6px] text-slate-500")}>
          Fecha de realización: {completionDate}
        </Text>
      ) : null}
    </View>
  );
  return (
    <Document>
      {orders.map((order) => {
        const statusInfo = getStatusInfo(order?.info || {});
        const supervisorCode = Number(order?.info?.asignado_por_code);
        const supervisorSignature = Number.isFinite(supervisorCode)
          ? signaturesByUserCode[supervisorCode]
          : null;
        const supervisorName = order?.info?.asignado_por_name || "";
        const maintainerCode = Number(order?.info?.asignado_a_code);
        const maintainerSignature = Number.isFinite(maintainerCode)
          ? signaturesByUserCode[maintainerCode]
          : null;
        const maintainerName = order?.info?.asignado_a_name || "";
        const rawCompletionDate =
          order?.info?.["F. Real de Ejecucion"] ||
          order?.info?.["F. Real de Ejecución"] ||
          order?.info?.fecha_fin ||
          order?.info?.fecha_fin_estimada ||
          "";
        const completionDate = (() => {
          if (!rawCompletionDate) return "";
          const sanitized = sanitizeIsoOffset(String(rawCompletionDate).trim());
          const parsed = new Date(sanitized);
          if (Number.isNaN(parsed.getTime())) return formatFallbackDate(sanitized);
          return parsed.toLocaleDateString("es-CL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
        })();
        const showSignaturesSection =
          statusInfo.code === 2 || statusInfo.code === 3;
        return (
          <Page
            size="A4"
            style={tw("m-5 font-serif pb-6 text-[7px] gap-y-6")}
            wrap
            key={order.code}
            orientation="landscape"
            pdfVersion="1.7"
          >
            <View>
              <View style={tw("text-center mb-4 font-bold")}>
                <View style={tw("flex flex-row justify-between pr-10")}>
                  <Text>R5980027</Text>
                  <View style={tw("flex flex-col items-center")}>
                    <Text>GRUPO ARCOR</Text>
                    <Text>Rpte. Impresión OT</Text>
                  </View>
                  <Text>
                    {
                      //fecha actual dd/mm/yyyy tab hh:mm:ss
                      new Date()
                        .toLocaleString("es-CL", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })
                        .replaceAll("-", "/")
                        .replaceAll("p.", "")
                        .replaceAll("a.", "")
                        .replaceAll("m.", "")
                        .split(",")
                        .join("   ")
                    }
                  </Text>
                </View>
              </View>
              <View style={tw("mb-4 flex flex-row gap-x-10")}>
                <Text>Número orden</Text>
                <Text>{order.code}</Text>
              </View>

              <View style={tw("flex flex-row justify-between pr-10")}>
                <View style={tw("flex flex-row gap-x-5")}>
                  <View style={tw("gap-y-3")}>
                    <Text>Descripcion</Text>
                    <Text>N° Unidad</Text>
                    <Text>Especialidad</Text>
                    <Text>Originador</Text>
                    <Text>Linea</Text>
                    <Text>N° de Serie</Text>
                  </View>
                  <View style={tw("gap-y-3")}>
                    <Text> {order.info.Descripcion}</Text>
                    <Text> {order.info["N Unidad"]}</Text>
                    <Text> {order.info.Especialidad}</Text>
                    <Text> {order.info.Originador} </Text>
                    <Text> {order.info.Linea} </Text>
                    <Text>
                      {order.info["N Serie"] ? order.info["N Serie"] : ""}
                    </Text>
                  </View>
                </View>
                <View style={tw("flex flex-row gap-x-5")}>
                  <View style={tw("gap-y-3")}>
                    <Text>Clase</Text>
                    <Text>Tipo</Text>
                    <Text>Parte</Text>
                    <Text>Elemento</Text>
                    <Text>Modo</Text>
                    <Text>Incidencia</Text>
                    <Text>Kit de Tareas</Text>
                    <Text>Planta</Text>
                  </View>
                  <View style={tw("gap-y-3")}>
                    <Text> {order.info.Clase}</Text>
                    <Text> {order.info.Tipo}</Text>
                    <Text> {order.info.Parte}</Text>
                    <Text> {order.info.Elemento} </Text>
                    <Text> {order.info.Modo} </Text>
                    <Text> {order.info.Incidencia} </Text>
                    <Text> {order.info["Kit de Tareas"]} </Text>
                    <Text> {order.info.Planta} </Text>
                  </View>
                </View>
                <View style={tw("flex flex-row gap-x-5")}>
                  <View style={tw("gap-y-3")}>
                    <Text>Asignado a</Text>
                    <Text>Estado</Text>
                    <Text>F inicial</Text>
                    <Text>F. Real Ejecucion</Text>
                    <Text>Fecha Venc.</Text>
                    <Text>Proximo Venc.</Text>
                    <Text>Tipo servici</Text>
                  </View>
                  <View style={tw("gap-y-3")}>
                    <Text>
                      {order.info.asignado_a_code
                        ? " " +
                          order.info.asignado_a_code +
                          " " +
                          order.info.asignado_a_name
                        : " "}
                    </Text>
                    <Text> {order.info.Estado}</Text>
                    <Text> {order.info["F inicial"]}</Text>
                    <Text> {order.info["F. Real de Ejecucion"]}</Text>
                    <Text> {order.info["Fecha Venc."]}</Text>
                    <Text> {order.info["Proximo Venc."]}</Text>
                    <Text> {order.info["Tipo servici"]}</Text>
                  </View>
                </View>
                <View style={tw("flex flex-row gap-x-5")}>
                  <View style={tw("gap-y-3")}>
                    <Text>Frec. Dias</Text>
                    <Text>Frec. Comb.</Text>
                    <Text>Frec. Km</Text>
                    <Text>Frec. Horas</Text>
                    <Text>Ultima Realiz.</Text>
                    <Text>Fecha Prox Emisión</Text>
                  </View>

                  <View style={tw("gap-y-3")}>
                    <Text> {order.info["Frec. Dias"]}</Text>
                    <Text> {order.info["Frec. Comb."]}</Text>
                    <Text> {order.info["Frec. Km"]}</Text>
                    <Text> {order.info["Frec. Horas"]}</Text>
                    <Text> {order.info["Ultima Realiz."]} </Text>
                    <Text> {order.info["Fecha Prox Emision"]}</Text>
                  </View>
                </View>
              </View>
              <View style={tw("mt-6 flex flex-row justify-between pr-10")}>
                <Text>
                  Seg. y Medio Ambiente {order.info["Seg. y Medio Ambiente"]}
                </Text>
                <Text>Calidad {order.info.Calidad}</Text>
                <Text>Operacion {order.info.Operacion}</Text>
                <Text>Mantenimiento {order.info.Mantenimiento}</Text>
                <Text>Categorizacion {order.info.Categorizacion}</Text>
                <Text>Tipo de Servicio {order.info["Tipo de Servicio"]}</Text>
              </View>
              <View style={tw("mt-6 pr-10 mb-4")}>
                {TaskTable(order.tasks.data)}
              </View>

              {order.protocolos.map((protocolo, index) => (
                <View style={tw("pr-10")}>
                  <Text wrap>{protocolo}</Text>
                </View>
              ))}
              {showSignaturesSection ? (
                <View style={tw(" pr-5 flex flex-row justify-end")}>
                  <View style={tw("flex flex-row gap-x-10")}>
                    {renderSignatureBlock({
                      signature: maintainerSignature,
                      rolePrefix: "Mantenedor",
                      name: maintainerName,
                      completionDate,
                    })}
                    {renderSignatureBlock({
                      signature: supervisorSignature,
                      rolePrefix: "Supervisor",
                      name: supervisorName,
                      completionDate,
                    })}
                  </View>
                </View>
              ) : null}
              {
                // TODO: agregar checklist de termino solo si la orden esta terminada y firmada por mantenedor y supervisor
              }
            </View>
          </Page>
        );
      })}
    </Document>
  );
};

const TaskTable = (tasks) => {
  let dictTask = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
    7: [],
    8: [],
  };
  tasks.map(
    (task, index) => (
      dictTask[0].push(task["Taller"]),
      dictTask[1].push(task["Numero sec oper"]),
      dictTask[2].push(task["Tarea Standard"]),
      dictTask[3].push(task["Descripcion"]),
      dictTask[4].push(task["Hs Estim"]),
      dictTask[5].push(task["Valor esperado"]),
      dictTask[6].push(task["medicion_result"]),
      dictTask[7].push(task["medicion_range_from"]),
      dictTask[8].push(task["medicion_range_to"])
    )
  );
  return (
    <View style={tw("flex flex-row justify-between flex-wrap")}>
      <View>
        <View style={tw(" items-center text-center")}>
          <Text style={tw("text-center")}>Taller</Text>
          <Text style={tw("text-center")}>{"  "}</Text>
        </View>
        <View
          style={tw(
            "pt-1 border-t-[0.5px] border-solid items-center text-center"
          )}
        >
          {dictTask[0].map((item, index) => (
            <Text style={tw("text-center")}>{item}</Text>
          ))}
        </View>
      </View>
      <View>
        <View style={tw("items-center text-center")}>
          <Text style={tw("text-center")}>N° sec</Text>
          <Text style={tw("text-center")}>oper</Text>
        </View>
        <View
          style={tw(
            "pt-1 border-t-[0.5px] border-solid items-center text-center"
          )}
        >
          {dictTask[1].map((item, index) => (
            <Text style={tw("text-center")}>{item}</Text>
          ))}
        </View>
      </View>
      <View>
        <View style={tw("items-center text-center")}>
          <Text style={tw("text-center")}>Tarea</Text>
          <Text style={tw("text-center")}>Standard</Text>
        </View>
        <View
          style={tw(
            "pt-1 border-t-[0.5px] border-solid items-center text-center"
          )}
        >
          {dictTask[2].map((item, index) => (
            <Text>{item}</Text>
          ))}
        </View>
      </View>
      <View>
        <View style={tw("items-center text-center")}>
          <Text style={tw("text-center")}>Descripcion</Text>
          <Text style={tw("text-center")}>{"  "}</Text>
        </View>
        <View
          style={tw(
            "pt-1 border-t-[0.5px] border-solid items-center text-center"
          )}
        >
          {dictTask[3].map((item, index) => (
            <Text>{item}</Text>
          ))}
        </View>
      </View>
      <View>
        <View style={tw("items-center text-center")}>
          <Text style={tw("text-center")}>Hs</Text>
          <Text style={tw("text-center")}>Estim</Text>
        </View>
        <View
          style={tw(
            "pt-1 border-t-[0.5px] border-solid items-center text-center"
          )}
        >
          {dictTask[4].map((item, index) => (
            <Text>{item}</Text>
          ))}
        </View>
      </View>
      <View>
        <View style={tw("items-center text-center")}>
          <Text style={tw("text-center")}>Medición</Text>
          <Text style={tw("text-center")}>Encontrada</Text>
        </View>
        <View
          style={tw(
            "pt-1 border-t-[0.5px] border-solid items-center text-center"
          )}
        >
          {dictTask[6].map((item, index) => (
            <Text>
              {item == 1
                ? "Si"
                : item == 2
                ? "NO"
                : item == 3
                ? "NO APLICA"
                : ""}
            </Text>
          ))}
        </View>
      </View>
      <View>
        <View style={tw("items-center text-center")}>
          <Text style={tw("text-center")}>Rango</Text>
          <Text style={tw("text-center")}>Desde</Text>
        </View>
        <View
          style={tw(
            "pt-1 border-t-[0.5px] border-solid items-center text-center"
          )}
        >
          {dictTask[7].map((item, index) => (
            <Text>{item}</Text>
          ))}
        </View>
      </View>
      <View>
        <View style={tw("items-center text-center")}>
          <Text style={tw("text-center")}>Rango</Text>
          <Text style={tw("text-center")}>Hasta</Text>
        </View>
        <View
          style={tw(
            "pt-1 border-t-[0.5px] border-solid items-center text-center"
          )}
        >
          {dictTask[8].map((item, index) => (
            <Text>{item}</Text>
          ))}
        </View>
      </View>
      <View>
        <View style={tw("items-center text-center")}>
          <Text style={tw("text-center")}>Valor</Text>
          <Text style={tw("text-center")}>Esperado</Text>
        </View>
        <View
          style={tw(
            "pt-1 border-t-[0.5px] border-solid items-center text-center"
          )}
        >
          {dictTask[8].map((item, index) => (
            <Text>{""}</Text>
          ))}
        </View>
      </View>
      <View>
        <View style={tw("items-center text-center")}>
          <Text style={tw("text-center")}>Descripción</Text>
          <Text style={tw("text-center")}>Unidad de Medida</Text>
        </View>
        <View
          style={tw(
            "pt-1 border-t-[0.5px] border-solid items-center text-center"
          )}
        >
          {dictTask[5].map((item, index) => (
            <Text>{item}</Text>
          ))}
        </View>
      </View>
    </View>
  );
};

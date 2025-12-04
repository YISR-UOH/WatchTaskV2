/**
 * Vista de Administrador
 * funciona como modulo central para administradores y acceso a otras vistas.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import UserManager from "@/components/administrador/component_userManager";
import OrdersManager from "@/components/administrador/component_ordersManager";
import { processAndStorePdf } from "@/utils/pdfUtils";
import OrderPDF from "@/components/administrador/component_orderPDF";
import {
  exportDatabaseBackup,
  importDatabaseBackup,
} from "@/utils/APIdb";
import Dashboard from "@/pages/Dashboard";
export default function Admin() {
  const { user } = useAuth();
  const [pdfCount, setPdfCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploadNotice, setUploadNotice] = useState(null);
  const [backupScope, setBackupScope] = useState("all");
  const [backupPanelOpen, setBackupPanelOpen] = useState(false);
  const [backupExporting, setBackupExporting] = useState(false);
  const [backupImporting, setBackupImporting] = useState(false);
  const [backupInputKey, setBackupInputKey] = useState(0);

  const uploadOrders = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setBusy(true);
    try {
      const count = await processAndStorePdf(file, (n) => setPdfCount(n));
      setPdfCount(count);
      setUploadNotice({
        type: "success",
        count: typeof count === "number" ? count : null,
        message:
          typeof count === "number"
            ? count > 0
              ? `Se cargaron ${count} orden(es) desde el PDF.`
              : "El PDF no contenía ordenes nuevas."
            : "Proceso completado.",
        ts: Date.now(),
      });
    } catch (error) {
      const message =
        error?.message || "No fue posible procesar el PDF. Intenta nuevamente.";
      setUploadNotice({ type: "error", message, ts: Date.now() });
    } finally {
      setBusy(false);
    }
  };
  const tabs = useMemo(
    () => [
      {
        id: "userManager",
        label: "Administracion de Usuarios",
        content: <UserManager />,
      },
      {
        id: "ordersManager",
        label: "Revisar Ordenes",
        content: <OrdersManager />,
      },
      {
        id: "ordersPDF",
        label: "generar PDF",
        content: <OrderPDF />,
      },
      {
        id: "dashboard",
        label: "Dashboard",
        content: <Dashboard />,
      },
    ],
    []
  );
  const [activeTab, setActiveTab] = useState(tabs[0].id);

  const getButtonClass = (tabId) =>
    tabId === activeTab
      ? "font-bold text-lg cursor-pointer px-4 py-2 bg-blue-500 text-white rounded"
      : "text-lg cursor-pointer px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200";

  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  useEffect(() => {
    if (!uploadNotice) return undefined;
    const timer = setTimeout(() => {
      setUploadNotice((prev) => (prev === uploadNotice ? null : prev));
    }, 6000);
    return () => clearTimeout(timer);
  }, [uploadNotice]);

  const handleBackupExport = async () => {
    setBackupExporting(true);
    try {
      const payload = await exportDatabaseBackup(backupScope);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `watchtask-backup-${backupScope}-${stamp}.json`;
      if (typeof window === "undefined" || !window?.document) {
        throw new Error(
          "La descarga de backups solo está disponible dentro del navegador."
        );
      }
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      window.document.body.appendChild(anchor);
      anchor.click();
      window.document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setUploadNotice({
        type: "success",
        message: "Backup generado correctamente.",
        ts: Date.now(),
      });
    } catch (error) {
      const message =
        error?.message || "No fue posible generar el backup. Intenta nuevamente.";
      setUploadNotice({ type: "error", message, ts: Date.now() });
    } finally {
      setBackupExporting(false);
    }
  };

  const handleBackupImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBackupImporting(true);
    try {
      const text = await file.text();
      const result = await importDatabaseBackup(text);
      setUploadNotice({
        type: "success",
        message: `Backup restaurado (${result?.restored?.users || 0} usuario(s), ${
          result?.restored?.orders || 0
        } orden(es)).`,
        ts: Date.now(),
      });
      setBackupPanelOpen(false);
    } catch (error) {
      const message =
        error?.message || "No fue posible restaurar el backup. Revisa el archivo.";
      setUploadNotice({ type: "error", message, ts: Date.now() });
    } finally {
      setBackupImporting(false);
      setBackupInputKey((prev) => prev + 1);
    }
  };

  return (
    <div>
      <div className="flex flex-row gap-4 p-2 align-center justify-center sticky top-10 bg-white shadow z-10">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={getButtonClass(tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <div
          className={`relative ${
            busy ? "pointer-events-none" : "cursor-pointer"
          }`}
          aria-disabled={busy}
        >
          <button
            className="text-lg cursor-pointer px-4 py-2 bg-green-100 text-green-700 rounded hover:bg-green-200"
            disabled={busy}
          >
            {busy ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="size-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="size-6 cursor-pointer"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
            )}
          </button>
          <input
            type="file"
            accept="application/pdf"
            onChange={uploadOrders}
            disabled={busy}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Cargar ordenes desde PDF"
          />
        </div>
        <div className="relative" aria-expanded={backupPanelOpen}>
          <button
            type="button"
            className="text-lg cursor-pointer px-4 py-2 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
            onClick={() => setBackupPanelOpen((prev) => !prev)}
          >
            {backupPanelOpen ? "Cerrar Backup" : "Backup"}
          </button>
          {backupPanelOpen ? (
            <div className="absolute right-0 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-xl z-20">
              <div className="flex flex-col gap-3">
                <div>
                  <label
                    htmlFor="backup-scope"
                    className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    Contenido del backup
                  </label>
                  <select
                    id="backup-scope"
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm"
                    value={backupScope}
                    onChange={(e) => setBackupScope(e.target.value)}
                    disabled={backupExporting || backupImporting}
                  >
                    <option value="all">Usuarios y Ordenes</option>
                    <option value="users">Solo Usuarios</option>
                    <option value="orders">Solo Ordenes</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="rounded bg-indigo-600 px-3 py-2 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                    onClick={handleBackupExport}
                    disabled={backupExporting || backupImporting}
                  >
                    {backupExporting ? "Generando..." : "Descargar Backup"}
                  </button>
                  <label className="flex cursor-pointer flex-col gap-1 rounded border border-dashed border-slate-300 px-3 py-2 text-center text-slate-600 hover:border-slate-400">
                    <span className="text-xs font-semibold uppercase tracking-wide">
                      {backupImporting ? "Restaurando..." : "Cargar Backup"}
                    </span>
                    <input
                      key={backupInputKey}
                      type="file"
                      accept="application/json"
                      onChange={handleBackupImport}
                      disabled={backupImporting}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-xs text-slate-500">
                  Los backups incluyen las tablas seleccionadas y sus metadatos. Al restaurar se
                  sobrescribirá la información existente.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="p-4">{currentTab.content}</div>
      {uploadNotice ? (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm">
          <div
            className={`rounded-lg border px-4 py-3 shadow-lg ${
              uploadNotice.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">
                  {uploadNotice.type === "error"
                    ? "Error al cargar"
                    : "Ordenes procesadas"}
                </p>
                <p className="mt-1 text-sm">{uploadNotice.message}</p>
              </div>
              <button
                type="button"
                className="text-xs font-semibold uppercase tracking-wide"
                onClick={() => setUploadNotice(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

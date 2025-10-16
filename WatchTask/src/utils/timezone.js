const DEFAULT_TIME_ZONE = "America/Santiago";

const dtfCache = new Map();

const getDateTimeFormat = (timeZone) => {
  if (!dtfCache.has(timeZone)) {
    dtfCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    );
  }
  return dtfCache.get(timeZone);
};

export const getTimeZoneOffsetMinutes = (timeZone, date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
  const dtf = getDateTimeFormat(timeZone);
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return (asUTC - date.getTime()) / 60000;
};

export const createZonedDate = (
  timeZone,
  { year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 }
) => {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const base = new Date(utc);
  if (Number.isNaN(base.getTime())) return null;
  const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, base);
  return new Date(utc - offsetMinutes * 60000);
};

export const startOfDayInTimeZone = (timeZone, value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date?.getTime?.())) return null;
  const dtf = getDateTimeFormat(timeZone);
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }
  return createZonedDate(timeZone, {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  });
};

export const addDaysInTimeZone = (timeZone, value, days) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date?.getTime?.())) return null;
  const start = startOfDayInTimeZone(timeZone, date);
  if (!start) return null;
  return new Date(start.getTime() + Number(days || 0) * 86400000);
};

export const parseDateStringInTimeZone = (timeZone, value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/-/g, "/");
  const parts = normalized.split("/");
  if (parts.length === 3) {
    const [dayStr, monthStr, yearStr] = parts.map((part) => part.trim());
    const day = Number.parseInt(dayStr, 10);
    const month = Number.parseInt(monthStr, 10);
    let year = Number.parseInt(yearStr, 10);
    if (
      Number.isFinite(day) &&
      Number.isFinite(month) &&
      Number.isFinite(year)
    ) {
      if (year < 100) {
        const currentYear = new Date().getFullYear();
        const currentCentury = Math.floor(currentYear / 100) * 100;
        year += currentCentury;
        if (year > currentYear + 50) {
          year -= 100;
        }
      }
      return createZonedDate(timeZone, { year, month, day });
    }
  }

  if (!Number.isNaN(Date.parse(trimmed))) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  if (!Number.isNaN(Date.parse(normalized))) {
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
};

export const formatDateInTimeZone = (
  timeZone,
  value,
  options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }
) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date?.getTime?.())) return "";
  return new Intl.DateTimeFormat("es-CL", { timeZone, ...options }).format(
    date
  );
};

export const CHILE_TIME_ZONE = DEFAULT_TIME_ZONE;

export const startOfChileDay = (value) =>
  startOfDayInTimeZone(CHILE_TIME_ZONE, value);
export const addChileDays = (value, days) =>
  addDaysInTimeZone(CHILE_TIME_ZONE, value, days);
export const parseChileDateString = (value) =>
  parseDateStringInTimeZone(CHILE_TIME_ZONE, value);
export const formatChileDate = (value, options) =>
  formatDateInTimeZone(CHILE_TIME_ZONE, value, options);
export const formatChileISODate = (value = new Date()) => {
  const start = startOfChileDay(value);
  if (!start) return "";
  const year = start.getUTCFullYear();
  const month = String(start.getUTCMonth() + 1).padStart(2, "0");
  const day = String(start.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

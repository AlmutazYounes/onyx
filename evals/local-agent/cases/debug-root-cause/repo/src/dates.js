// Months are keyed as "YYYY-MM", matching the report argument.

export function monthKey(isoDate) {
  const date = new Date(isoDate);
  const month = String(date.getUTCMonth()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

export function monthName(key) {
  const [year, month] = key.split("-").map(Number);
  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  return `${name} ${year}`;
}

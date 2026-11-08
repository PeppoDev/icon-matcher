import { MAX_NAME_LENGTH } from "../constants.js";

function isNameSafe(stem: string): boolean {
  return (
    stem.length > 0 &&
    stem.length <= MAX_NAME_LENGTH &&
    !stem.startsWith(".") &&
    !/[\/\x00-\x1f\x7f]/.test(stem)
  );
}

export function generatedFileName(wmClass: string): string {
  if (isNameSafe(wmClass)) return wmClass;

  const cleaned = wmClass
    .replace(/[\/\x00-\x1f\x7f]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, MAX_NAME_LENGTH);

  return cleaned;
}

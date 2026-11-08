import type { MappedApp, AppCatalog } from "../src/types.js";
import type { RawAppInfo } from "../src/mappers/app.js";
import { normalize } from "../src/utils/normalize.js";
import { FALLBACK_ICON } from "../src/constants.js";
import { GENERATED_DIR } from "./fixtures/apps.js";

// toMappedApp is not exported from src/mappers/app.ts, so we mirror the logic here.
export function toMappedApp(raw: RawAppInfo, generatedDir: string): MappedApp {
  const desktopId = raw.id.toLowerCase().replace(/\.desktop$/, "");
  const shortDesktopId = desktopId.split(".").pop() ?? "";
  const nameLower = raw.name.toLowerCase();
  return {
    ...raw,
    hasIcon: !!raw.icon && raw.icon !== FALLBACK_ICON,
    isGenerated: !!raw.filename && raw.filename.startsWith(`${generatedDir}/`),
    desktopId,
    shortDesktopId,
    nameLower,
    desktopNormalized: normalize(desktopId),
    shortIdNormalized: normalize(shortDesktopId),
    nameNormalized: normalize(nameLower),
  };
}

export function catalogOf(raw: readonly RawAppInfo[]): AppCatalog {
  const facts = raw.map((app) => toMappedApp(app, GENERATED_DIR));
  const byId = new Map(facts.map((app) => [app.id, app]));
  return { all: () => facts, lookup: (id) => byId.get(id) ?? null };
}

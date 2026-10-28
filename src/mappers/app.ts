import { normalize } from "../utils/normalize.js";
import type { MappedApp } from "../matching/types.js";
import { FALLBACK_ICON } from "../constants.js";

export interface RawAppInfo {
  id: string;
  name: string;
  commandline: string;
  icon: string;
  filename: string;
}

export function createAppFacts(
  raw: RawAppInfo,
  generatedDir: string,
): MappedApp {
  const desktopId = raw.id.toLowerCase().replace(/\.desktop$/, "");
  // Just in case of dns-like desktopId
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

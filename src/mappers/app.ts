import type Gio from "gi://Gio";
import GioUnix from "gi://GioUnix";
import type { MappedApp } from "../types.js";
import { normalize } from "../utils/normalize.js";
import { FALLBACK_ICON, MATCHED_DIR } from "../constants.js";

export interface RawAppInfo {
  id: string;
  name: string;
  commandline: string;
  icon: string;
  filename: string;
}

function toMappedApp(raw: RawAppInfo, generatedDir: string): MappedApp {
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

export function toMappedAppIndexer(info: Gio.AppInfo): MappedApp {
  const filename =
    info instanceof GioUnix.DesktopAppInfo ? (info.get_filename() ?? "") : "";

  return toMappedApp(
    {
      id: info.get_id() ?? "",
      name: info.get_name() ?? "",
      commandline: info.get_commandline() ?? "",
      icon: info.get_icon()?.to_string() ?? "",
      filename,
    },
    MATCHED_DIR,
  );
}

import Gio from "gi://Gio";
import GioUnix from "gi://GioUnix";
import Shell from "gi://Shell";

import {
  APPS_INSTALLED_CHANGED,
  DESKTOP_ENTRY_DIR_CHANGED,
} from "../constants.js";
import { toMappedAppIndexer } from "../mappers/app.js";
import type { AppCatalog, Callback, MappedApp, Nullable } from "../types.js";

export class AppIndexer implements AppCatalog {
  #appSystem = Shell.AppSystem.get_default();
  #appMonitor = Gio.AppInfoMonitor.get();
  #apps: Nullable<MappedApp[]> = null;
  #byId = new Map<string, MappedApp>();

  constructor(onChanged: Callback) {
    this.#init(onChanged);
  }

  #init(onChanged: Callback) {
    const callBack = () => {
      this.#invalidate();
      onChanged();
    };

    this.#appSystem.connectObject(APPS_INSTALLED_CHANGED, callBack, this);

    // For app images or other types of installation that does not trigger the other signal
    // Maybe I can leave just this signal
    this.#appMonitor.connectObject(DESKTOP_ENTRY_DIR_CHANGED, callBack, this);
  }

  #invalidate() {
    this.#apps = null;
    this.#byId.clear();
  }

  all(): readonly MappedApp[] {
    if (!this.#apps) {
      this.#apps = this.#appSystem.get_installed().map(toMappedAppIndexer);
      for (const app of this.#apps) this.#byId.set(app.id, app);
    }
    return this.#apps;
  }

  lookup(desktopId: string): Nullable<MappedApp> {
    this.all();
    const known = this.#byId.get(desktopId);
    if (known) return known;

    const info = this.#appSystem.lookup_app(desktopId)?.get_app_info();
    return info ? toMappedAppIndexer(info) : null;
  }

  desktopAppInfo(desktopId: string): Nullable<GioUnix.DesktopAppInfo> {
    return (
      this.#appSystem.lookup_app(desktopId)?.get_app_info() ??
      GioUnix.DesktopAppInfo.new(desktopId)
    );
  }

  dispose() {
    this.#appMonitor.disconnectObject(this);
    this.#appSystem.disconnectObject(this);
    this.#invalidate();
  }
}

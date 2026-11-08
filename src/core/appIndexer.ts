import GioUnix from "gi://GioUnix";
import Shell from "gi://Shell";

import { APPS_INSTALLED_CHANGED } from "../constants.js";
import { Signals } from "./signals.js";
import { toMappedAppIndexer } from "../mappers/app.js";
import type { AppCatalog, MappedApp } from "../types.js";

export class AppIndexer implements AppCatalog {
  #appSystem = Shell.AppSystem.get_default();
  #signals = new Signals();
  #apps: MappedApp[] | null = null;
  #byId = new Map<string, MappedApp>();

  constructor(onChanged: () => void) {
    this.#signals.connect(this.#appSystem, APPS_INSTALLED_CHANGED, () => {
      this.invalidate();
      onChanged();
    });
  }

  invalidate() {
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

  lookup(desktopId: string): MappedApp | null {
    this.all();
    const known = this.#byId.get(desktopId);
    if (known) return known;

    const info = this.#appSystem.lookup_app(desktopId)?.get_app_info();
    return info ? toMappedAppIndexer(info) : null;
  }

  desktopAppInfo(desktopId: string): GioUnix.DesktopAppInfo | null {
    return (
      this.#appSystem.lookup_app(desktopId)?.get_app_info() ??
      GioUnix.DesktopAppInfo.new(desktopId)
    );
  }

  dispose() {
    this.#signals.disconnectAll();
    this.invalidate();
  }
}

import type Gio from "gi://Gio";

import { NOTIFY_SETTINGS_CHANGED, SettingsKey } from "../constants.js";
import { Nullable } from "../types.js";
import { blackList } from "./blacklist.js";
import { logger } from "./logger.js";

export class ExtensionSettings {
  #debug = false;
  #autoSync = true;
  #settings: Nullable<Gio.Settings> = null;

  constructor(settings: Gio.Settings) {
    this.#init(settings);
    settings.connectObject(
      NOTIFY_SETTINGS_CHANGED,
      () => this.#init(settings),
      this,
    );
  }

  #init(settings: Gio.Settings) {
    this.#settings = settings;
    this.#debug = settings.get_boolean(SettingsKey.debug);
    this.#autoSync = settings.get_boolean(SettingsKey.autoSync);
    blackList.setPatterns(settings.get_strv(SettingsKey.blacklist));
    logger.setDebug(this.#debug);
    logger.debug("Settigns inited");
  }

  get autoSync(): boolean {
    return this.#autoSync;
  }

  reset() {
    this.#settings?.disconnectObject(this);
    blackList.setPatterns([]);
    logger.setDebug(false);
  }
}

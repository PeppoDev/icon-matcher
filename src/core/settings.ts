import type Gio from "gi://Gio";

import { NOTIFY_SETTINGS_CHANGED, SettingsKey } from "../constants.js";
import { blackList } from "./blacklist.js";
import { Signals } from "./signals.js";
import { logger } from "./logger.js";

export class ExtensionSettings {
  #signals = new Signals();
  #debug = false;

  constructor(settings: Gio.Settings) {
    this.init(settings);
    this.#signals.connect(settings, NOTIFY_SETTINGS_CHANGED, () =>
      this.init(settings),
    );
  }

  init(settings: Gio.Settings) {
    this.#debug = settings.get_boolean(SettingsKey.debug);
    blackList.setPatterns(settings.get_strv(SettingsKey.blacklist));
    logger.setDebug(this.#debug);
  }

  reset() {
    this.#signals.disconnectAll();
    blackList.setPatterns([]);
    logger.setDebug(false);
  }
}

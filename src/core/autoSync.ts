import Gio from "gi://Gio";
import GLib from "gi://GLib";

import {
  AUTO_SYNC_DELAY_SECONDS,
  DESKTOP_ENTRY_DIR_CHANGED,
} from "../constants.js";
import type { GhostHandler } from "../entries/ghostHandler.js";
import { logger } from "./logger.js";
import type { ExtensionSettings } from "./settings.js";

export class AutoSync {
  #monitor = Gio.AppInfoMonitor.get();
  #timeoutId = 0;

  constructor(
    private readonly store: GhostHandler,
    private readonly settings: ExtensionSettings,
  ) {}

  enable() {
    this.#monitor.connectObject(
      DESKTOP_ENTRY_DIR_CHANGED,
      () => this.#schedule(),
      this,
    );
  }

  #schedule() {
    this.#cancel();
    if (!this.settings.autoSync) return;

    logger.debug(
      `Desktop entries changed, syncing in ${AUTO_SYNC_DELAY_SECONDS}s`,
    );
    this.#timeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      AUTO_SYNC_DELAY_SECONDS,
      () => {
        this.#timeoutId = 0;
        this.#run();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  async #run() {
    const { synced, skipped, failed, deleted } = await this.store.sync();
    logger.debug(
      `Auto-sync: synced ${synced}, deleted ${deleted}, skipped ${skipped}, failed ${failed}`,
    );
  }

  #cancel() {
    if (!this.#timeoutId) return;
    GLib.Source.remove(this.#timeoutId);
    this.#timeoutId = 0;
  }

  disable() {
    this.#monitor.disconnectObject(this);
    this.#cancel();
  }
}

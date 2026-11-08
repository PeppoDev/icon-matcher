import type Gio from "gi://Gio";

import { logger } from "../core/logger.js";
import type { FixRequest, Writer } from "../types.js";
import type { GhostHandler } from "./ghostHandler.js";

export class GhostWriter implements Writer {
  constructor(private readonly store: GhostHandler) {}

  async apply({
    wmClass,
    appInfo,
    match,
  }: FixRequest): Promise<Gio.File | null> {
    const id = appInfo.get_id();

    if (appInfo.get_startup_wm_class() === wmClass) {
      logger.debug(`${id} already has StartupWMClass=${wmClass}`);
      return null;
    }

    if (!appInfo.get_icon()) return null;

    const source = appInfo.get_filename();
    if (!source) {
      logger.debug(`${id} has no file on disk, skipping`);
      return null;
    }

    const target = this.store.fileFor(wmClass);
    const fileExists = await this.store.exists(target);
    if (fileExists) {
      logger.debug(`Fix already on disk: ${target.get_path()}`);
      return target;
    }

    await this.store.write(target, {
      kind: "ghost",
      source,
      wmClass,
      matchType: match.matchType,
      score: match.score,
    });
    logger.debug(`Wrote fix: ${target.get_path()}`);
    return target;
  }
}

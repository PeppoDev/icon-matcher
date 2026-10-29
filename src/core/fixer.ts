import type Gio from "gi://Gio";
import Shell from "gi://Shell";
import Meta from "gi://Meta";

import { AppIndexer } from "./appIndexer.js";
import { fileExists } from "./io.js";
import { logger } from "./logger.js";
import type { EntryWriter } from "../entries/EntryWriter.js";
import { blackList } from "./blacklist.js";
import type { Matcher } from "../matching/matcher.js";
import { hasControlChars } from "../utils/normalize.js";
import type { MatchResult } from "../types.js";
import { toMappedWindow } from "../mappers/window.js";
import { FALLBACK_ICON } from "../constants.js";
import { FixerOutcome } from "../types.js";

export class Fixer {
  #fixed = new Map<string, Gio.File | null>();
  #indexer: AppIndexer;
  #disposed = false;

  constructor(
    private readonly matcher: Matcher,
    private readonly writer: EntryWriter,
  ) {
    this.#indexer = new AppIndexer(() => this.#onAppsChanged());
  }

  apply(win: Meta.Window, isRetry: boolean): FixerOutcome {
    return this.#inspect(win, isRetry);
  }

  #inspect(win: Meta.Window, isRetry: boolean): FixerOutcome {
    const window = toMappedWindow(win);
    const { wmClass, title } = window;
    logger.debug(
      `Inspecting window "${title}" (${wmClass})${isRetry ? " after title change" : ""}`,
    );

    if (!wmClass) return "wait-wm-class";

    if (hasControlChars(wmClass)) {
      logger.debug(
        `wm class ${JSON.stringify(wmClass)} has control characters, skipping`,
      );
      return "done";
    }

    if (this.#fixed.has(wmClass)) return "done";

    if (blackList.isBlackListed(wmClass)) {
      logger.debug(`wm class ${wmClass} is blacklisted, skipping`);
      return "done";
    }

    const currentApp = Shell.WindowTracker.get_default().get_window_app(win);
    if (!currentApp || !this.#needsFix(currentApp)) {
      logger.debug("Window already has an app with an icon");
      return "done";
    }

    const result = this.matcher.match(window, this.#indexer);
    if (!result) {
      logger.debug("-> No candidate found, cannot fix automatically");
      return "retry-on-title";
    }

    logger.debug(
      `\t✔ Best candidate: ${result.app.id} (${result.matchType}, score=${result.score}, ` +
        `runner-up=${result.runnerUpScore}, rule="${result.reason}") — applying fix`,
    );

    this.#fixed.set(wmClass, null);
    this.#apply(wmClass, result).catch((err) => {
      this.#fixed.delete(wmClass);
      logger.error(`Failed to apply fix for ${wmClass}`, err);
    });
    return "done";
  }

  async #apply(wmClass: string, result: MatchResult) {
    const appInfo = this.#indexer.desktopAppInfo(result.app.id);
    if (!appInfo) {
      logger.debug(`${result.app.id} has no desktop entry, skipping`);
      return;
    }

    const file = await this.writer.apply({ wmClass, appInfo, match: result });
    if (!this.#disposed && this.#fixed.has(wmClass))
      this.#fixed.set(wmClass, file);
  }

  #needsFix(app: Shell.App): boolean {
    if (app.is_window_backed()) return true;

    const icon = app.get_icon()?.to_string();
    return !icon || icon === FALLBACK_ICON;
  }

  // TODO: verify if everthing is necessary
  async #onAppsChanged() {
    for (const [wmClass, file] of [...this.#fixed]) {
      if (!file || (await fileExists(file))) continue;
      if (this.#disposed) return;

      logger.debug(`Fix for ${wmClass} was removed, it will be redone`);
      this.#fixed.delete(wmClass);
    }
  }

  reset() {
    this.#disposed = true;
    this.#indexer.dispose();
    this.#fixed.clear();
  }
}

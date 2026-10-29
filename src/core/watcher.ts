import GLib from "gi://GLib";
import Meta from "gi://Meta";

import {
  MAX_TITLE_RETRIES,
  NOTIFY_TITLE,
  NOTIFY_WMCLASS,
  TITLE_RETRY_DELAY_MS,
  WINDOW_CREATED,
  WINDOW_INSPECT_DELAY_MS,
  WINDOW_UNMANAGED,
  ALLOWED_WINDOW_TYPES,
} from "../constants.js";
import { logger } from "./logger.js";
import { Signals } from "./signals.js";
import { Fixer } from "./fixer.js";
import { FixerOutcome } from "../types.js";

// - done: stop watching the window
// - wait-wm-class: inspect again as soon as the window gets a wm class
// - retry-on-title: nothing matched, inspect again if the title changes

interface TrackedWindow {
  timeoutId: number | null;
  waitSignalId: number | null;
  titleRetries: number;
}

// TODO check if title match resolve some of hard matches
export class Watcher {
  #tracked = new Map<Meta.Window, TrackedWindow>();
  #signals = new Signals();

  constructor(private readonly fixer: Fixer) {}

  enable() {
    this.#signals.connect(global.display, WINDOW_CREATED, (_display, win) =>
      this.#onWindowCreated(win),
    );
  }

  disable() {
    for (const win of [...this.#tracked.keys()]) this.#untrack(win);
    this.#signals.disconnectAll();
  }

  #onWindowCreated(win: Meta.Window) {
    if (!ALLOWED_WINDOW_TYPES.includes(win.get_window_type())) return;

    const tracked: TrackedWindow = {
      timeoutId: null,
      waitSignalId: null,
      titleRetries: 0,
    };
    this.#tracked.set(win, tracked);
    this.#signals.connect(win, WINDOW_UNMANAGED, () => this.#untrack(win));
    this.#schedule(win, tracked, WINDOW_INSPECT_DELAY_MS, false);
  }

  #schedule(
    win: Meta.Window,
    tracked: TrackedWindow,
    delay: number,
    isRetry: boolean,
  ) {
    tracked.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      tracked.timeoutId = null;
      this.#run(win, tracked, isRetry);
      return GLib.SOURCE_REMOVE;
    });
  }

  #run(win: Meta.Window, tracked: TrackedWindow, isRetry: boolean) {
    let outcome: FixerOutcome = "done";
    try {
      outcome = this.fixer.apply(win, isRetry);
    } catch (err) {
      logger.error("window inspection failed", err);
    }

    switch (outcome) {
      case "wait-wm-class":
        logger.debug(
          `window ${win.get_title()} has no wm class yet, waiting for it`,
        );
        this.#waitFor(win, tracked, NOTIFY_WMCLASS, () =>
          this.#run(win, tracked, isRetry),
        );
        break;

      // TODO: Maybe this is just over
      case "retry-on-title":
        if (tracked.titleRetries >= MAX_TITLE_RETRIES) {
          this.#untrack(win);
          break;
        }
        tracked.titleRetries++;
        this.#waitFor(win, tracked, NOTIFY_TITLE, () =>
          this.#schedule(win, tracked, TITLE_RETRY_DELAY_MS, true),
        );
        break;
      case "done":
        this.#untrack(win);
        break;
    }
  }

  #waitFor(
    win: Meta.Window,
    tracked: TrackedWindow,
    signal: string,
    callback: () => void,
  ) {
    tracked.waitSignalId = this.#signals.connect(win, signal, () => {
      this.#clearWait(win, tracked);
      callback();
    });
  }

  #untrack(win: Meta.Window) {
    const tracked = this.#tracked.get(win);
    if (!tracked) return;

    this.#clearTimeout(tracked);
    this.#signals.disconnectByTarget(win);
    this.#tracked.delete(win);
  }

  #clearWait(win: Meta.Window, tracked: TrackedWindow) {
    if (tracked.waitSignalId === null) return;
    this.#signals.disconnect(win, tracked.waitSignalId);
    tracked.waitSignalId = null;
  }

  #clearTimeout(tracked: TrackedWindow) {
    if (tracked.timeoutId === null) return;
    GLib.Source.remove(tracked.timeoutId);
    tracked.timeoutId = null;
  }
}

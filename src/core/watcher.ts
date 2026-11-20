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
} from "../constants.js";
import { FixerOutcome, Nullable } from "../types.js";
import { Fixer } from "./fixer.js";
import { logger } from "./logger.js";

const ALLOWED_WINDOW_TYPES = [
  Meta.WindowType.NORMAL,
  Meta.WindowType.DESKTOP,
  Meta.WindowType.DIALOG,
  Meta.WindowType.MODAL_DIALOG,
];

// - done: stop watching the window
// - wait-wm-class: inspect again as soon as the window gets a wm class
// - retry-on-title: nothing matched, inspect again if the title changes

interface TrackedWindow {
  timeoutId: Nullable<number>;
  titleRetries: number;
}

// TODO check if title match resolve some of hard matches
export class Watcher {
  #tracked = new Map<Meta.Window, TrackedWindow>();

  constructor(private readonly fixer: Fixer) {}

  enable() {
    global.display.connectObject(
      WINDOW_CREATED,
      (_display: Meta.Display, win: Meta.Window) => this.#onWindowCreated(win),
      this,
    );
  }

  disable() {
    for (const win of [...this.#tracked.keys()]) this.#untrack(win);
    global.display.disconnectObject(this);
  }

  #onWindowCreated(win: Meta.Window) {
    if (!ALLOWED_WINDOW_TYPES.includes(win.get_window_type())) return;

    const tracked: TrackedWindow = {
      timeoutId: null,
      titleRetries: 0,
    };
    this.#tracked.set(win, tracked);
    win.connectObject(WINDOW_UNMANAGED, () => this.#untrack(win), this);
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
    win.connectObject(
      signal,
      () => {
        this.#clearWait(win, tracked);
        callback();
      },
      tracked,
    );
  }

  #untrack(win: Meta.Window) {
    const tracked = this.#tracked.get(win);
    if (!tracked) return;

    this.#clearTimeout(tracked);
    this.#clearWait(win, tracked);
    win.disconnectObject(this);
    this.#tracked.delete(win);
  }

  #clearWait(win: Meta.Window, tracked: TrackedWindow) {
    win.disconnectObject(tracked);
  }

  #clearTimeout(tracked: TrackedWindow) {
    if (tracked.timeoutId === null) return;
    GLib.Source.remove(tracked.timeoutId);
    tracked.timeoutId = null;
  }
}

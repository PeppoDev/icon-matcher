import { LOGGER_PREFIX } from "../constants.js";

export class Logger {
  static #instance: Logger | null = null;

  #debugEnabled = false;

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.#instance) Logger.#instance = new Logger();
    return Logger.#instance;
  }

  get isDebugEnabled(): boolean {
    return this.#debugEnabled;
  }

  setDebug(enabled: boolean): void {
    this.#debugEnabled = enabled;
  }

  debug = (...data: unknown[]): void => {
    if (this.isDebugEnabled) console.log(LOGGER_PREFIX, ...data);
  };

  warn = (...data: unknown[]): void => {
    if (this.isDebugEnabled) console.warn(LOGGER_PREFIX, ...data);
  };

  error = (...data: unknown[]): void => {
    console.error(LOGGER_PREFIX, ...data);
  };
}

export const logger = Logger.getInstance();

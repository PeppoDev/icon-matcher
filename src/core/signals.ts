import type GObject from "gi://GObject";

import { logger } from "./logger.js";
import { Callback } from "../types.js";

interface Connection {
  target: GObject.Object;
  id: number;
}

export class Signals {
  #connections: Connection[] = [];

  connect(target: GObject.Object, signal: string, callback: Callback): number {
    const id = target.connect(signal, callback);
    this.#connections.push({ target, id });
    return id;
  }

  disconnect(target: GObject.Object, id: number) {
    const index = this.#connections.findIndex(
      (c) => c.target === target && c.id === id,
    );
    if (index === -1) return;

    this.#connections.splice(index, 1);
    this.#disconectionHandler({ target, id });
  }

  disconnectByTarget(target: GObject.Object) {
    const remaining: Connection[] = [];
    for (const connection of this.#connections) {
      if (connection.target === target) this.#disconectionHandler(connection);
      else remaining.push(connection);
    }
    this.#connections = remaining;
  }

  disconnectAll() {
    for (const connection of this.#connections)
      this.#disconectionHandler(connection);
    this.#connections = [];
  }

  #disconectionHandler({ target, id }: Connection) {
    try {
      target.disconnect(id);
    } catch (err) {
      logger.error("signal disconnection failed", err);
    }
  }
}

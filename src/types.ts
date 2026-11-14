import type Gio from "gi://Gio";
import type GioUnix from "gi://GioUnix";

export type Callback = (...args: any[]) => unknown;

export type FixerOutcome = "done" | "wait-wm-class" | "retry-on-title";

// TODO include PID for generated desktop entries
export interface MappedWindow {
  readonly wmClass: string;
  readonly appId: string;
  readonly title: string;
}

export interface HeuristicWindow {
  wm: string;
  appId: string;
  title: string;
  steamGameId: Nullable<string>;
}

export interface MappedApp {
  readonly id: string;
  readonly name: string;
  readonly commandline: string;
  readonly icon: string;
  // Phase 2: decides between editing the original in place or shadowing it
  readonly filename: string;
  readonly isGenerated: boolean;
  readonly hasIcon: boolean;
  readonly desktopId: string;
  readonly shortDesktopId: string;
  readonly nameLower: string;
  readonly desktopNormalized: string;
  readonly shortIdNormalized: string;
  readonly nameNormalized: string;
}

export interface AppCatalog {
  all(): readonly MappedApp[];
  lookup(desktopId: string): Nullable<MappedApp>;
}

export type EntryMatchType = "existing";

export interface EntryMatch {
  readonly app: MappedApp;
  readonly matchType: MatchType;
  readonly score: number;
  readonly runnerUpScore: number;
  readonly reason: string;
}

export interface ExistingEntryMatch extends EntryMatch {
  // it will have more
  readonly kind: "existing";
}

export type MatchType = "deterministic" | "heuristic";

export type MatchResult = ExistingEntryMatch;

export interface MatchStrategy {
  readonly name: MatchType;
  match(win: MappedWindow, catalog: AppCatalog): Nullable<MatchResult>;
}

export interface FixRequest {
  wmClass: string;
  appInfo: GioUnix.DesktopAppInfo;
  match: ExistingEntryMatch;
}

export interface Writer {
  apply(request: FixRequest): Promise<Nullable<Gio.File>>;
}

export type Nullable<T> = T | null;

export type Callback = (...args: any[]) => unknown;

// TODO transform into a true enum
export type FixerOutcome = "done" | "wait-wm-class" | "retry-on-title";

// TODO include PID for generated desktop entries
export interface MappedWindow {
  readonly wmClass: string;
  readonly appId: string;
  readonly title: string;
}

export interface HeurisctWindow {
  wm: string;
  appId: string;
  title: string;
  steamGameId: string | null;
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
  lookup(desktopId: string): MappedApp | null;
}

export type EntryMatchType = "existing";

export interface EntryMatch {
  readonly app: MappedApp;
  readonly matchType: MatchType;
  readonly score: number;
  // Phase 2: the trust policy needs the margin over the runner-up
  readonly runnerUpScore: number;
  // Trace
  readonly reason: string;
}

export interface ExistingEntryMatch extends EntryMatch {
  // Phase 2: discriminant, launchers add a "synthesized" kind
  readonly kind: "existing";
}

export type MatchType = "deterministic" | "heuristic";

// Phase 2: becomes ExistingEntryMatch | SynthesizedEntryMatch
export type MatchResult = ExistingEntryMatch;

// Phase 2: LauncherStrategy implements this
export interface MatchStrategy {
  readonly name: MatchType;
  match(win: MappedWindow, catalog: AppCatalog): MatchResult | null;
}

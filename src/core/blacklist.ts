type PatternKind = "exact" | "prefix" | "suffix" | "contains";

interface Pattern {
  kind: PatternKind;
  term: string;
}

class BlackList {
  static #instance: BlackList | null = null;

  #patterns: Pattern[] = [];

  private constructor() {}

  static getInstance(): BlackList {
    if (!BlackList.#instance) BlackList.#instance = new BlackList();
    return BlackList.#instance;
  }

  #resolvePattern(pattern: string): Pattern {
    const lower = pattern.toLowerCase();
    const startsWithWildcard = lower.startsWith("*");
    const endsWithWildcard = lower.endsWith("*");
    const term = lower.replace(/^\*|\*$/g, "");

    let kind: PatternKind = "exact";
    if (startsWithWildcard && endsWithWildcard) kind = "contains";
    else if (startsWithWildcard) kind = "suffix";
    else if (endsWithWildcard) kind = "prefix";

    return { kind, term };
  }

  #matches({ kind, term }: Pattern, wm: string): boolean {
    switch (kind) {
      case "contains":
        return wm.includes(term);
      case "suffix":
        return wm.endsWith(term);
      case "prefix":
        return wm.startsWith(term);
      case "exact":
        return wm === term;
    }
  }

  setPatterns(patterns: readonly string[]): void {
    this.#patterns = patterns.map(this.#resolvePattern);
  }

  isBlackListed(wmClass: string): boolean {
    const wm = wmClass.toLowerCase();
    if (!wm) return false;

    return this.#patterns.some((pattern) => this.#matches(pattern, wm));
  }
}

export const blackList = BlackList.getInstance();

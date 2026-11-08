import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MIN_STRING_LENGTH } from "../../src/constants.js";
import { Matcher } from "../../src/matching/matcher.js";
import { normalize } from "../../src/utils/normalize.js";
import {
  scoreCandidate,
} from "../../src/matching/strategies/heuristic.js";
import { toHeuristicWindow } from "../../src/mappers/window.js";
import type { MappedApp, MappedWindow } from "../../src/types.js";
import { APPS, GENERATED_DIR, WINDOWS } from "../fixtures/apps.js";
import { catalogOf, toMappedApp } from "../helpers.js";
import {
  legacyFindBestCandidate,
  legacyScoreCandidate,
} from "../legacy/legacyMatcher.js";

// The refactored matcher must behave like the code it replaced, except for
// the fixes listed here. Anything else that changes is a regression.

/** Why a single window/app score is allowed to differ from the old one */
function explainScoreChange(win: MappedWindow, app: MappedApp): string | null {
  const lower = (s: string) => s.toLowerCase().trim();
  if (win.wmClass !== lower(win.wmClass) || win.appId !== lower(win.appId))
    return "R2: wm class and app id are lowercased";
  if (app.desktopNormalized.length <= MIN_STRING_LENGTH && normalize(win.title).includes(app.desktopNormalized))
    return "R3: short desktop ids no longer match titles that contain them";
  if (/^steam_app_\d+$/i.test(win.wmClass) && app.commandline.includes("steam://rungameid/"))
    return "R10: steam game ids are matched whole";
  if (app.shortDesktopId === "application")
    return "generic short desktop ids are ignored";
  return null;
}

type Pick = { id: string; score: number } | null;

/** Windows whose final pick changes on purpose: [before, after] */
const EXPECTED_CHANGES: Record<string, [Pick, Pick]> = {
  "steam_app_480|": [{ id: "Spacewar.desktop", score: 99 }, null], // R10
  "steam_app_1808500|ARC Raiders": [{ id: "icons-matched-conhost.exe.desktop", score: 99 }, null], // R1
  "steam_app_4704690|MECCHA CHAMELEON": [{ id: "icons-matched-steam_app_4704690.desktop", score: 99 }, null], // R1
  "TeamSpeak|": [
    { id: "PEAK.desktop", score: 70 },
    { id: "com.teamspeak.TeamSpeak.desktop", score: 85 },
  ], // R2
  "TowerFall|TowerFall": [
    { id: "TowerFall Ascension.desktop", score: 65 },
    { id: "TowerFall Ascension.desktop", score: 80 },
  ], // R2
  "ShadPS4|shadPS4 v0.9": [null, { id: "net.shadps4.shadPS4.desktop", score: 85 }], // R2
  "Krita|": [null, { id: "org.kde.krita.desktop", score: 85 }], // R2
  "ravimon.x86_64|Ravimon Adventures": [{ id: "vim.desktop", score: 68 }, null], // R3
  "some-tool|Main Window": [null, { id: "org.example.sometool.desktop", score: 100 }], // R4
  "noicon|noicon": [{ id: "noicon.desktop", score: 100 }, null], // R5
};

describe("parity with the pre-refactor matcher", () => {
  it("scores every window/app pair the same, except for documented fixes", () => {
    for (const win of WINDOWS) {
      const prepared = toHeuristicWindow(win);
      for (const raw of APPS) {
        const app = toMappedApp(raw, GENERATED_DIR);
        const score = scoreCandidate(prepared, app).score;
        const legacy = legacyScoreCandidate(raw, win.wmClass, win.appId, win.title);
        if (score === legacy) continue;

        assert.ok(
          explainScoreChange(win, app),
          `unexpected score change for ${win.wmClass} / ${raw.id}: ${legacy} -> ${score}`,
        );
      }
    }
  });

  it("picks the same candidate, except for documented fixes", () => {
    const matcher = new Matcher();
    const catalog = catalogOf(APPS);

    for (const win of WINDOWS) {
      const key = `${win.wmClass}|${win.title}`;
      const result = matcher.match(win, catalog);
      const legacy = legacyFindBestCandidate(APPS, win.wmClass, win.appId, win.title);

      const now: Pick = result && { id: result.app.id, score: result.score };
      const before: Pick = legacy && { id: legacy.id, score: legacy.score };

      const expected = EXPECTED_CHANGES[key];
      if (expected) {
        assert.deepEqual([before, now], expected, key);
      } else {
        assert.deepEqual(now, before, key);
      }
    }
  });
});

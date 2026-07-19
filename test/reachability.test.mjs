import assert from "node:assert/strict";
import test from "node:test";
import { computeEndgameTitlePossibleIds } from "../scripts/reachability.mjs";

test("chance matematica considera palpites fechados da final", () => {
  const tournament = {
    champion: null,
    runnerUp: null,
    matches: [
      {
        id: "final",
        stage: "final",
        homeTeam: "Casa",
        awayTeam: "Fora",
        result: { home: null, away: null },
      },
    ],
  };
  const rows = [
    scoreRow("leader", "Lider", 10, { home: 1, away: 0 }),
    scoreRow("chaser", "Cacador", 8, { home: 0, away: 1 }),
  ];
  const pointsAtStake = { knockout: 5, groups: 0, brazilMatches: 0 };

  const possibleIds = computeEndgameTitlePossibleIds(tournament, rows, pointsAtStake);

  assert.ok(possibleIds.has("leader"));
  assert.ok(possibleIds.has("chaser"));
});

test("analise exata aguarda a abertura dos palpites da final", () => {
  const tournament = {
    champion: null,
    runnerUp: null,
    matches: [
      {
        id: "final",
        stage: "final",
        homeTeam: "Casa",
        awayTeam: "Fora",
        result: { home: null, away: null },
      },
    ],
  };
  const rows = [scoreRow("leader", "Lider", 10, null)];
  const pointsAtStake = { knockout: 5, groups: 0, brazilMatches: 0 };

  assert.equal(computeEndgameTitlePossibleIds(tournament, rows, pointsAtStake), null);
});

function scoreRow(id, displayName, total, finalPrediction) {
  return {
    id,
    displayName,
    predictions: {
      champion: null,
      runnerUp: null,
      matches: finalPrediction ? { final: finalPrediction } : {},
    },
    score: {
      total,
      exactTiebreakerHits: 0,
      outcomeHits: 0,
      groupPhasePoints: total,
    },
  };
}

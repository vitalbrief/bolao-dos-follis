import assert from "node:assert/strict";
import test from "node:test";
import { ROUND_OF_16_PAIRS, simulateStandings } from "../scripts/simulate.mjs";

test("simulacao considera palpites futuros para fases ainda sem formulario", () => {
  const roundOf32Ids = [...new Set(ROUND_OF_16_PAIRS.flat())];
  const tournament = {
    matches: roundOf32Ids.map((id) => ({
      id,
      stage: "round_of_32",
      homeTeam: `Mandante ${id}`,
      awayTeam: `Visitante ${id}`,
      result: { home: 1, away: 0 },
    })),
  };

  const rows = [
    scoreRow("leader", "Leader", 10),
    scoreRow("chaser", "Chaser", 9),
  ];

  const { summary } = simulateStandings(tournament, rows, { iterations: 2000, seed: 42 });
  const chaser = summary.find((entry) => entry.id === "chaser");

  assert.ok(chaser.titleChance > 0);
});

function scoreRow(id, displayName, total) {
  return {
    id,
    displayName,
    predictions: { champion: null, runnerUp: null, matches: {} },
    score: {
      total,
      exactTiebreakerHits: 0,
      outcomeHits: 0,
      groupPhasePoints: total,
    },
    breakdown: { matches: {} },
  };
}

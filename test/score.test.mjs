import assert from "node:assert/strict";
import test from "node:test";
import {
  rankScoreRows,
  scoreGroupPrediction,
  scoreMatchPrediction,
} from "../scripts/score.mjs";

test("grupo: acerta classificado e posicao exata", () => {
  const score = scoreGroupPrediction(
    { first: "Brasil", second: "Marrocos" },
    { first: "Brasil", second: "Marrocos" },
  );

  assert.equal(score.points, 6);
  assert.equal(score.qualifiedHits, 2);
  assert.equal(score.exactPositionHits, 2);
});

test("grupo: classificado em posicao invertida vale 2 pontos", () => {
  const score = scoreGroupPrediction(
    { first: "Argentina", second: "Brasil" },
    { first: "Brasil", second: "Argentina" },
  );

  assert.equal(score.points, 4);
  assert.equal(score.qualifiedHits, 2);
  assert.equal(score.exactPositionHits, 0);
});

test("jogo: vencedor certo sem placar exato vale 3", () => {
  const score = scoreMatchPrediction(
    { home: 2, away: 0 },
    { home: 1, away: 0 },
  );

  assert.equal(score.points, 3);
  assert.equal(score.outcomeHit, true);
  assert.equal(score.exactHit, false);
});

test("jogo: placar exato vale 5", () => {
  const score = scoreMatchPrediction(
    { home: 1, away: 1 },
    { home: 1, away: 1 },
  );

  assert.equal(score.points, 5);
  assert.equal(score.outcomeHit, true);
  assert.equal(score.exactHit, true);
});

test("mata-mata: placar exato conta no primeiro desempate", () => {
  const score = scoreMatchPrediction(
    { home: 2, away: 1 },
    { home: 2, away: 1 },
    { stage: "round_of_16" },
  );

  assert.equal(score.points, 5);
  assert.equal(score.exactKnockoutHit, true);
});

test("ranking: aplica total, placar exato mata-mata, resultados e grupos", () => {
  const ranked = rankScoreRows([
    {
      id: "a",
      displayName: "A",
      score: { total: 10, exactKnockoutHits: 0, outcomeHits: 4, groupPhasePoints: 8 },
    },
    {
      id: "b",
      displayName: "B",
      score: { total: 10, exactKnockoutHits: 1, outcomeHits: 3, groupPhasePoints: 7 },
    },
    {
      id: "c",
      displayName: "C",
      score: { total: 10, exactKnockoutHits: 1, outcomeHits: 3, groupPhasePoints: 7 },
    },
  ]);

  assert.equal(ranked[0].id, "b");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].id, "c");
  assert.equal(ranked[1].rank, 1);
  assert.equal(ranked[2].id, "a");
  assert.equal(ranked[2].rank, 3);
});

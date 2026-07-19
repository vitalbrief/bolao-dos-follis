import { isCompleteScore, scoreMatchPrediction } from "./score.mjs";

const MATCH_MAX = 5;

// Quando as semifinais terminaram, os palpites de final e terceiro lugar ja
// estao fechados. Enumera as formas relevantes de pontuar nesses jogos para
// distinguir chance muito pequena de eliminacao matematica.
export function computeEndgameTitlePossibleIds(tournament, rows, pointsAtStake) {
  const finalMatch = tournament.matches.find((match) => match.stage === "final");
  if (!finalMatch) return null;

  const lockedPendingMatches = tournament.matches.filter(
    (match) =>
      (match.stage === "final" || match.stage === "third_place") &&
      !isCompleteScore(match.result) &&
      rows.some((row) => isUsablePrediction(row.predictions.matches?.[match.id])),
  );
  if (
    !isCompleteScore(finalMatch.result) &&
    !lockedPendingMatches.some((match) => match.id === finalMatch.id)
  ) {
    return null;
  }
  const stateLists = lockedPendingMatches.map((match) => enumerateMatchStates(match, rows));
  const combinations = combineStates(stateLists);
  const possibleIds = new Set();
  const futureOpenMatchCount = Math.max(
    0,
    pointsAtStake.knockout / MATCH_MAX - lockedPendingMatches.length,
  );
  const candidateOnlyPoints = {
    total: futureOpenMatchCount * MATCH_MAX + pointsAtStake.groups + pointsAtStake.brazilMatches,
    exactMatches: futureOpenMatchCount + pointsAtStake.brazilMatches / MATCH_MAX,
  };

  for (const states of combinations) {
    const finalState = states.find((state) => state.match.id === finalMatch.id);
    const finalScore = isCompleteScore(finalMatch.result) ? finalMatch.result : finalState?.score;
    const champion = tournament.champion ?? finalState?.winner ?? winnerFromScore(finalMatch, finalScore);
    const runnerUp = tournament.runnerUp ?? loserFromWinner(finalMatch, champion);
    if (!champion || !runnerUp) continue;

    const scenarioRows = rows.map((row) =>
      scoreEndgameRow(row, states, champion, runnerUp, tournament),
    );

    for (const candidate of scenarioRows) {
      const ranked = scenarioRows
        .map((row) =>
          row.id === candidate.id ? addCandidateCeiling(row, candidateOnlyPoints) : row,
        )
        .sort(compareRows);
      const candidateResult = ranked.find((row) => row.id === candidate.id);
      if (candidateResult && compareRows(candidateResult, ranked[0]) === 0) {
        possibleIds.add(candidate.id);
      }
    }
  }

  return possibleIds;
}

function enumerateMatchStates(match, rows) {
  const scores = new Map();
  for (const row of rows) {
    const prediction = row.predictions.matches?.[match.id];
    if (isUsablePrediction(prediction)) addScore(scores, prediction);
  }

  for (const result of ["home", "away", "draw"]) {
    addScore(scores, findNonExactScore(scores, result));
  }

  const states = [];
  for (const score of scores.values()) {
    if (match.stage === "final" && score.home === score.away) {
      states.push({ match, score, winner: match.homeTeam });
      states.push({ match, score, winner: match.awayTeam });
      continue;
    }
    states.push({ match, score, winner: winnerFromScore(match, score) });
  }
  return states;
}

function findNonExactScore(scores, result) {
  for (let home = 0; home <= 20; home += 1) {
    for (let away = 0; away <= 20; away += 1) {
      const outcome = home === away ? "draw" : home > away ? "home" : "away";
      if (outcome === result && !scores.has(`${home}-${away}`)) return { home, away };
    }
  }
  throw new Error(`Nao foi possivel representar o resultado ${result}.`);
}

function combineStates(stateLists) {
  let combinations = [[]];
  for (const states of stateLists) {
    combinations = combinations.flatMap((combination) =>
      states.map((state) => [...combination, state]),
    );
  }
  return combinations;
}

function scoreEndgameRow(row, states, champion, runnerUp, tournament) {
  const scenario = {
    id: row.id,
    displayName: row.displayName,
    total: row.score.total,
    exact: row.score.exactTiebreakerHits ?? row.score.exactKnockoutHits,
    outcome: row.score.outcomeHits,
    group: row.score.groupPhasePoints,
  };

  for (const state of states) {
    const prediction = row.predictions.matches?.[state.match.id];
    const scored = scoreMatchPrediction(prediction, state.score, { stage: state.match.stage });
    scenario.total += scored.points;
    if (scored.exactTiebreakerHit) scenario.exact += 1;
    if (scored.outcomeHit) scenario.outcome += 1;
  }

  if (!tournament.champion && row.predictions.champion === champion) scenario.total += 15;
  if (!tournament.runnerUp && row.predictions.runnerUp === runnerUp) scenario.total += 10;
  return scenario;
}

function addCandidateCeiling(row, points) {
  return {
    ...row,
    total: row.total + points.total,
    exact: row.exact + points.exactMatches,
    outcome: row.outcome + points.exactMatches,
  };
}

function winnerFromScore(match, score) {
  if (!isCompleteScore(score)) return null;
  if (score.home > score.away) return match.homeTeam;
  if (score.away > score.home) return match.awayTeam;
  return match.advanced ?? null;
}

function loserFromWinner(match, winner) {
  if (winner === match.homeTeam) return match.awayTeam;
  if (winner === match.awayTeam) return match.homeTeam;
  return null;
}

function isUsablePrediction(prediction) {
  return Boolean(prediction) && !prediction.ignored && isCompleteScore(prediction);
}

function addScore(scores, score) {
  scores.set(`${score.home}-${score.away}`, { home: score.home, away: score.away });
}

function compareRows(a, b) {
  return (
    b.total - a.total ||
    b.exact - a.exact ||
    b.outcome - a.outcome ||
    b.group - a.group
  );
}

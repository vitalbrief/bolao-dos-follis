export const GROUP_LETTERS = Object.freeze(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);

export const KNOCKOUT_STAGES = Object.freeze(
  new Set(["round_of_32", "round_of_16", "quarterfinal", "semifinal", "final"]),
);

export function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugify(value) {
  return normalizeKey(value).replace(/\s+/g, "-") || "sem-nome";
}

export function buildPeopleIndex(people) {
  const byAlias = new Map();
  const byId = new Map();

  for (const person of people) {
    byId.set(person.id, person);
    const aliases = new Set([person.displayName, ...(person.aliases ?? [])]);
    for (const alias of aliases) {
      byAlias.set(normalizeKey(alias), person);
    }
  }

  return { byAlias, byId };
}

export function buildTeamIndex(teamAliases) {
  const byAlias = new Map();

  for (const [canonical, aliases] of Object.entries(teamAliases)) {
    byAlias.set(normalizeKey(canonical), canonical);
    for (const alias of aliases ?? []) {
      byAlias.set(normalizeKey(alias), canonical);
    }
  }

  return byAlias;
}

export function canonicalizeTeam(value, teamIndex) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return teamIndex.get(normalizeKey(raw)) ?? raw;
}

export function parseScore(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  if (!/^\d+$/.test(raw)) return Number.NaN;
  return Number(raw);
}

export function isCompleteScore(score) {
  return Number.isInteger(score?.home) && Number.isInteger(score?.away);
}

export function outcome(score) {
  if (!isCompleteScore(score)) return null;
  if (score.home === score.away) return "draw";
  return score.home > score.away ? "home" : "away";
}

export function scoreMatchPrediction(prediction, actual, { stage = "group_brazil" } = {}) {
  const base = {
    points: 0,
    outcomeHit: false,
    exactHit: false,
    exactKnockoutHit: false,
    pending: !isCompleteScore(actual),
  };

  if (!isCompleteScore(prediction) || !isCompleteScore(actual)) {
    return base;
  }

  const outcomeHit = outcome(prediction) === outcome(actual);
  const exactHit = prediction.home === actual.home && prediction.away === actual.away;
  const points = (outcomeHit ? 3 : 0) + (exactHit ? 2 : 0);

  return {
    points,
    outcomeHit,
    exactHit,
    exactKnockoutHit: exactHit && KNOCKOUT_STAGES.has(stage),
    pending: false,
  };
}

export function scoreGroupPrediction(prediction, actual) {
  const result = {
    points: 0,
    qualifiedHits: 0,
    exactPositionHits: 0,
    pending: !(actual?.first && actual?.second),
    slots: [],
  };

  if (result.pending) return result;

  const actualByPosition = {
    first: actual.first,
    second: actual.second,
  };
  const actualQualified = new Set([actual.first, actual.second].filter(Boolean));
  const seenPredictions = new Set();

  for (const position of ["first", "second"]) {
    const team = prediction?.[position] ?? null;
    const slot = {
      position,
      team,
      qualifiedHit: false,
      exactPositionHit: false,
      points: 0,
      duplicateIgnored: false,
    };

    if (team && seenPredictions.has(team)) {
      slot.duplicateIgnored = true;
      result.slots.push(slot);
      continue;
    }

    if (team) {
      seenPredictions.add(team);
    }

    if (team && actualQualified.has(team)) {
      slot.qualifiedHit = true;
      slot.points += 2;
      result.qualifiedHits += 1;
    }

    if (team && actualByPosition[position] === team) {
      slot.exactPositionHit = true;
      slot.points += 1;
      result.exactPositionHits += 1;
    }

    result.points += slot.points;
    result.slots.push(slot);
  }

  return result;
}

export function sameRankingTie(a, b) {
  return (
    a.score.total === b.score.total &&
    a.score.exactKnockoutHits === b.score.exactKnockoutHits &&
    a.score.outcomeHits === b.score.outcomeHits &&
    a.score.groupPhasePoints === b.score.groupPhasePoints
  );
}

export function compareScoreRows(a, b) {
  return (
    b.score.total - a.score.total ||
    b.score.exactKnockoutHits - a.score.exactKnockoutHits ||
    b.score.outcomeHits - a.score.outcomeHits ||
    b.score.groupPhasePoints - a.score.groupPhasePoints ||
    a.displayName.localeCompare(b.displayName, "pt-BR")
  );
}

export function rankScoreRows(rows) {
  const sorted = [...rows].sort(compareScoreRows);
  let previous = null;
  let currentRank = 0;

  return sorted.map((row, index) => {
    if (!previous || !sameRankingTie(previous, row)) {
      currentRank = index + 1;
    }
    previous = row;
    return { ...row, rank: currentRank };
  });
}

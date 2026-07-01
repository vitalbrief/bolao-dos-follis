import fs from "node:fs/promises";
import path from "node:path";
import { parseCsvWithHeaders } from "./csv.mjs";
import { simulateStandings } from "./simulate.mjs";
import {
  GROUP_LETTERS,
  KNOCKOUT_STAGES,
  KNOCKOUT_STAGE_MATCH_COUNTS,
  buildPeopleIndex,
  buildTeamIndex,
  canonicalizeTeam,
  isCompleteScore,
  parseScore,
  rankScoreRows,
  scoreGroupPrediction,
  scoreMatchPrediction,
  slugify,
} from "./score.mjs";

const root = process.cwd();

const args = parseArgs(process.argv.slice(2));
const formsPath = args.forms ?? "data/manual/forms.json";
const peoplePath = args.people ?? "data/manual/people.json";
const ignoredPeoplePath = args.ignoredPeople ?? "data/manual/ignored-people.json";
const teamAliasesPath = args.teamAliases ?? "data/manual/team-aliases.json";
const tournamentPath = args.tournament ?? "data/manual/tournament.json";
const overridesPath = args.overrides ?? "data/manual/prediction-overrides.json";
const siteOutPath = args.out ?? "site/data/site-data.json";
const generatedOutPath = args.generatedOut ?? "data/generated/site-data.json";

const [formsConfig, people, ignoredPeople, teamAliases, tournamentRaw, predictionOverrides] = await Promise.all([
  readJson(formsPath),
  readJson(peoplePath),
  readJson(ignoredPeoplePath),
  readJson(teamAliasesPath),
  readJson(tournamentPath),
  readJson(overridesPath),
]);

const peopleIndex = buildPeopleIndex(people);
const ignoredPeopleIndex = buildIgnoredPeopleIndex(ignoredPeople);
const teamIndex = buildTeamIndex(teamAliases);
const warnings = [];
const participants = new Map();
const submissions = [];
const ignoredSubmissions = [];

const tournament = canonicalizeTournament(tournamentRaw, teamIndex);
const matchesById = new Map(tournament.matches.map((match) => [match.id, match]));

for (const form of formsConfig.forms) {
  if (form.stage !== "group" && !KNOCKOUT_STAGES.has(form.stage)) {
    warnings.push(`Formulario ${form.id} ignorado: stage "${form.stage}" ainda nao esta implementado.`);
    continue;
  }

  const csvPath = path.resolve(root, form.sourceCsv);
  const csvText = await fs.readFile(csvPath, "utf8");
  const { headers, records } = parseCsvWithHeaders(csvText);

  validateColumnCount(form, headers, warnings);

  for (const cells of records) {
    const rawName = String(cells[form.nameColumnIndex] ?? "").trim();
    if (ignoredPeopleIndex.has(slugKey(rawName))) {
      ignoredSubmissions.push({
        formId: form.id,
        rawName,
        submittedAt: String(cells[form.timestampColumnIndex] ?? "").trim(),
      });
      continue;
    }

    const submission =
      form.stage === "group"
        ? parseGroupSubmission({ form, cells, peopleIndex, teamIndex, matchesById, warnings })
        : parseKnockoutSubmission({ form, cells, peopleIndex, matchesById, warnings });
    submissions.push(submission);

    const existing = participants.get(submission.person.id);
    if (!existing) {
      participants.set(submission.person.id, participantFromSubmission(submission));
      continue;
    }

    const existingSubmission = existing.submissions[form.id];
    if (existingSubmission) {
      warnings.push(
        `${submission.person.displayName} tem mais de uma resposta em ${form.label}. ${
          form.stage === "group" ? "Foi usada a mais recente." : "Foi usado o palpite valido mais recente por jogo."
        }`,
      );
      if (form.stage === "group" && submission.sortableTimestamp > existingSubmission.sortableTimestamp) {
        existing.submissions[form.id] = submission;
        // Merge instead of overwrite para preservar palpites de outras fases (formularios futuros).
        existing.predictions = mergePredictions(existing.predictions, submission.predictions);
      } else if (KNOCKOUT_STAGES.has(form.stage)) {
        existing.submissions[form.id] =
          submission.sortableTimestamp > existingSubmission.sortableTimestamp ? submission : existingSubmission;
        mergeKnockoutPredictions(existing, submission);
      }
    } else {
      existing.submissions[form.id] = submission;
      if (KNOCKOUT_STAGES.has(form.stage)) {
        mergeKnockoutPredictions(existing, submission);
      } else {
        existing.predictions = mergePredictions(existing.predictions, submission.predictions);
      }
    }
  }
}

applyPredictionOverrides(participants, predictionOverrides, matchesById, warnings);

const scoreRows = [...participants.values()].map((participant) => scoreParticipant(participant, tournament));
const ranking = rankScoreRows(scoreRows);

const pointsAtStake = computePointsAtStake(tournament);

const hasResults = tournament.matches.some((match) => isCompleteScore(match.result));
const simulation =
  hasResults && pointsAtStake.total > 0
    ? simulateStandings(tournament, ranking, { iterations: 40000 })
    : { summary: [], warnings: [], iterations: 0 };
const chancesById = new Map(simulation.summary.map((entry) => [entry.id, entry]));
const reachById = computeReachability(tournament, ranking, pointsAtStake);
warnings.push(...simulation.warnings);

const output = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: "Google Forms CSV + arquivos manuais",
    participantCount: ranking.length,
    submissionCount: submissions.length,
    ignoredSubmissionCount: ignoredSubmissions.length,
    pointsAtStake,
    simulation: {
      iterations: simulation.iterations,
      note: "Estimativa por Monte Carlo do restante do torneio. Ver scripts/simulate.mjs.",
    },
    scoringVersion: "2026-06-13.1",
  },
  rules: {
    groupQualified: 2,
    groupExactPositionBonus: 1,
    champion: 15,
    runnerUp: 10,
    matchOutcome: 3,
    exactScoreBonus: 2,
    matchMax: 5,
    tiebreakers: [
      "Maior número de placares exatos no mata-mata",
      "Maior número de resultados acertados, incluindo empate",
      "Maior pontuação na fase de grupos",
      "Empate compartilhado",
    ],
  },
  warnings,
  aliases: {
    people: people.map((person) => ({
      id: person.id,
      displayName: person.displayName,
      aliases: person.aliases ?? [],
    })),
  },
  tournament,
  participants: ranking.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    rank: row.rank,
    score: row.score,
    chances: chancesById.get(row.id) ? pickChances(chancesById.get(row.id), reachById.get(row.id)) : null,
    predictions: row.predictions,
    breakdown: row.breakdown,
  })),
  ranking: ranking.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    rank: row.rank,
    score: row.score,
    chances: chancesById.get(row.id) ? pickChances(chancesById.get(row.id), reachById.get(row.id)) : null,
  })),
};

await fs.mkdir(path.dirname(path.resolve(root, siteOutPath)), { recursive: true });
await fs.mkdir(path.dirname(path.resolve(root, generatedOutPath)), { recursive: true });
await fs.writeFile(path.resolve(root, siteOutPath), `${JSON.stringify(output, null, 2)}\n`);
await fs.writeFile(path.resolve(root, generatedOutPath), `${JSON.stringify(output, null, 2)}\n`);

console.log(`Participantes: ${ranking.length}`);
console.log(`Respostas: ${submissions.length}`);
console.log(`Avisos: ${warnings.length}`);
console.log(`Site data: ${siteOutPath}`);

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const key = rawArgs[index];
    if (!key.startsWith("--")) continue;
    parsed[toCamel(key.slice(2))] = rawArgs[index + 1];
    index += 1;
  }
  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(root, filePath), "utf8"));
}

function buildIgnoredPeopleIndex(names) {
  return new Set((names ?? []).map((name) => slugKey(name)));
}

function validateColumnCount(form, headers, targetWarnings) {
  const expectedIndexes = [
    form.timestampColumnIndex,
    form.nameColumnIndex,
    form.championColumnIndex,
    form.runnerUpColumnIndex,
    ...Object.values(form.groupColumns ?? {}).flatMap((group) => [group.firstColumnIndex, group.secondColumnIndex]),
    ...(form.matchScoreColumns ?? []).flatMap((match) => [match.homeScoreColumnIndex, match.awayScoreColumnIndex]),
  ].filter(Number.isInteger);
  const maxExpected = Math.max(...expectedIndexes);
  if (headers.length <= maxExpected) {
    targetWarnings.push(
      `Formulario ${form.id} tem ${headers.length} colunas, mas a configuracao espera a coluna ${maxExpected + 1}.`,
    );
  }
}

function parsePerson(cells, form, peopleIndex, targetWarnings) {
  const rawName = String(cells[form.nameColumnIndex] ?? "").trim();
  const knownPerson = peopleIndex.byAlias.get(slugKey(rawName));
  const person = knownPerson ?? {
    id: slugify(rawName),
    displayName: rawName || "Sem nome",
    aliases: [rawName],
  };

  if (!knownPerson) {
    targetWarnings.push(`Nome sem alias cadastrado: "${rawName}". Confira data/manual/people.json.`);
  }

  return { person, rawName };
}

function parseGroupSubmission({ form, cells, peopleIndex, teamIndex, matchesById, warnings: targetWarnings }) {
  const { person, rawName } = parsePerson(cells, form, peopleIndex, targetWarnings);

  const groupPredictions = {};
  for (const group of GROUP_LETTERS) {
    const mapping = form.groupColumns[group];
    groupPredictions[group] = {
      first: canonicalizeTeam(cells[mapping.firstColumnIndex], teamIndex),
      second: canonicalizeTeam(cells[mapping.secondColumnIndex], teamIndex),
    };
  }

  const matchPredictions = {};
  for (const matchMapping of form.matchScoreColumns) {
    const match = matchesById.get(matchMapping.matchId);
    const prediction = {
      home: parseScore(cells[matchMapping.homeScoreColumnIndex]),
      away: parseScore(cells[matchMapping.awayScoreColumnIndex]),
    };
    if (Number.isNaN(prediction.home) || Number.isNaN(prediction.away)) {
      targetWarnings.push(`${person.displayName}: placar invalido em ${matchMapping.matchId}.`);
    }
    matchPredictions[matchMapping.matchId] = {
      ...prediction,
      label: match ? `${match.homeTeam} x ${match.awayTeam}` : matchMapping.matchId,
    };
  }

  const submittedAt = String(cells[form.timestampColumnIndex] ?? "").trim();

  return {
    formId: form.id,
    formLabel: form.label,
    person,
    rawName,
    submittedAt,
    sortableTimestamp: parseBrazilianDateTime(submittedAt),
    predictions: {
      champion: canonicalizeTeam(cells[form.championColumnIndex], teamIndex),
      runnerUp: canonicalizeTeam(cells[form.runnerUpColumnIndex], teamIndex),
      groups: groupPredictions,
      matches: matchPredictions,
    },
  };
}

function parseKnockoutSubmission({ form, cells, peopleIndex, matchesById, warnings: targetWarnings }) {
  const { person, rawName } = parsePerson(cells, form, peopleIndex, targetWarnings);
  const submittedAt = String(cells[form.timestampColumnIndex] ?? "").trim();
  const sortableTimestamp = parseBrazilianDateTime(submittedAt);
  const matchPredictions = {};
  const matchPredictionMeta = {};

  for (const matchMapping of form.matchScoreColumns ?? []) {
    const match = matchesById.get(matchMapping.matchId);
    const label = match ? `${match.homeTeam} x ${match.awayTeam}` : matchMapping.matchId;
    const prediction = {
      home: parseScore(cells[matchMapping.homeScoreColumnIndex]),
      away: parseScore(cells[matchMapping.awayScoreColumnIndex]),
      label,
    };

    if (!match) {
      targetWarnings.push(`${person.displayName}: jogo "${matchMapping.matchId}" nao encontrado.`);
      continue;
    }

    if (Number.isNaN(prediction.home) || Number.isNaN(prediction.away)) {
      targetWarnings.push(`${person.displayName}: placar invalido em ${matchMapping.matchId}.`);
    }

    const kickoffTimestamp = parseIsoDateTime(match.kickoff);
    const late = Number.isFinite(kickoffTimestamp) && sortableTimestamp >= kickoffTimestamp;

    if (late) {
      matchPredictions[matchMapping.matchId] = {
        home: null,
        away: null,
        label,
        ignored: true,
        ignoredReason: "after_kickoff",
      };
      matchPredictionMeta[matchMapping.matchId] = { sortableTimestamp, ignored: true };
      targetWarnings.push(
        `${person.displayName}: palpite de ${label} ignorado porque foi enviado apos o inicio do jogo.`,
      );
      continue;
    }

    matchPredictions[matchMapping.matchId] = prediction;
    matchPredictionMeta[matchMapping.matchId] = { sortableTimestamp, ignored: false };
  }

  return {
    formId: form.id,
    formLabel: form.label,
    person,
    rawName,
    submittedAt,
    sortableTimestamp,
    predictions: {
      matches: matchPredictions,
    },
    predictionMeta: {
      matches: matchPredictionMeta,
    },
  };
}

function participantFromSubmission(submission) {
  return {
    id: submission.person.id,
    displayName: submission.person.displayName,
    submissions: {
      [submission.formId]: submission,
    },
    predictions: submission.predictions,
    predictionMeta: submission.predictionMeta ?? { matches: {} },
  };
}

function mergePredictions(base, next) {
  return {
    champion: next.champion ?? base.champion,
    runnerUp: next.runnerUp ?? base.runnerUp,
    groups: { ...(base.groups ?? {}), ...(next.groups ?? {}) },
    matches: { ...(base.matches ?? {}), ...(next.matches ?? {}) },
  };
}

function mergeKnockoutPredictions(participant, submission) {
  participant.predictionMeta ??= { matches: {} };
  participant.predictionMeta.matches ??= {};
  participant.predictions = {
    ...participant.predictions,
    matches: mergeMatchPredictions(
      participant.predictions.matches ?? {},
      submission.predictions.matches ?? {},
      participant.predictionMeta.matches,
      submission.predictionMeta?.matches ?? {},
    ),
  };
}

function mergeMatchPredictions(baseMatches, nextMatches, baseMeta, nextMeta) {
  const merged = { ...baseMatches };

  for (const [matchId, nextPrediction] of Object.entries(nextMatches)) {
    const current = merged[matchId];
    const currentMeta = baseMeta[matchId] ?? { sortableTimestamp: -Infinity, ignored: Boolean(current?.ignored) };
    const incomingMeta = nextMeta[matchId] ?? { sortableTimestamp: 0, ignored: Boolean(nextPrediction?.ignored) };

    if (incomingMeta.ignored && current && !current.ignored) {
      continue;
    }

    if (!current || current.ignored || incomingMeta.sortableTimestamp >= currentMeta.sortableTimestamp) {
      merged[matchId] = nextPrediction;
      baseMeta[matchId] = incomingMeta;
    }
  }

  return merged;
}

function applyPredictionOverrides(participantsById, overrides, matchesById, targetWarnings) {
  for (const override of overrides.matchScores ?? []) {
    const participant = participantsById.get(override.participantId);
    if (!participant) {
      targetWarnings.push(`Correcao ignorada: participante "${override.participantId}" nao encontrado.`);
      continue;
    }

    const match = matchesById.get(override.matchId);
    if (!match) {
      targetWarnings.push(`Correcao ignorada: jogo "${override.matchId}" nao encontrado.`);
      continue;
    }

    const home = Number(override.home);
    const away = Number(override.away);
    if (!Number.isInteger(home) || !Number.isInteger(away)) {
      targetWarnings.push(
        `Correcao ignorada: placar invalido para ${participant.displayName} em ${override.matchId}.`,
      );
      continue;
    }

    participant.predictions.matches[override.matchId] = {
      home,
      away,
      label: `${match.homeTeam} x ${match.awayTeam}`,
    };
  }
}

function parseBrazilianDateTime(value) {
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return 0;
  const [, day, month, year, hour, minute, second = "0"] = match;
  const timestamp = Date.parse(
    `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}-03:00`,
  );
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function parseIsoDateTime(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isNaN(timestamp) ? Infinity : timestamp;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function slugKey(value) {
  return slugify(value).replace(/-/g, " ");
}

function canonicalizeTournament(raw, teamIndex) {
  const groups = {};
  for (const group of GROUP_LETTERS) {
    const actual = raw.groups?.[group] ?? {};
    groups[group] = {
      first: canonicalizeTeam(actual.first, teamIndex),
      second: canonicalizeTeam(actual.second, teamIndex),
    };
  }

  const matches = [...(raw.matches ?? []), ...(raw.knockoutMatches ?? [])].map((match) => ({
    ...match,
    homeTeam: canonicalizeTeam(match.homeTeam, teamIndex),
    awayTeam: canonicalizeTeam(match.awayTeam, teamIndex),
    advanced: match.advanced ? canonicalizeTeam(match.advanced, teamIndex) : null,
    result: {
      home: Number.isInteger(match.result?.home) ? match.result.home : null,
      away: Number.isInteger(match.result?.away) ? match.result.away : null,
    },
  }));

  return {
    name: raw.name,
    season: raw.season,
    lastResultsCheckedAt: raw.lastResultsCheckedAt,
    champion: canonicalizeTeam(raw.champion, teamIndex),
    runnerUp: canonicalizeTeam(raw.runnerUp, teamIndex),
    groups,
    matches,
  };
}

function pickChances(entry, reach) {
  return {
    titleChance: entry.titleChance,
    podiumChance: entry.podiumChance,
    eliminated: reach?.eliminated ?? false,
  };
}

// Maximo de pontos que cada participante ainda pode somar (cenario otimista) e
// se ja esta matematicamente sem chance de alcancar o lider. Serve para separar
// "improvavel" (mostra <1%) de "impossivel" (mostra 0%).
function computeReachability(tournament, rows, pointsAtStake) {
  const MATCH_MAX = 5;
  const pendingR32 = tournament.matches.filter(
    (match) => match.stage === "round_of_32" && !isCompleteScore(match.result),
  );
  // Fases futuras (oitavas em diante) ainda nao foram palpitadas, mas TODOS
  // poderao pontuar nelas quando os formularios abrirem. So os palpites de
  // 16-avos ja estao travados: jogo nao palpitado agora vira ponto perdido.
  const futureKnockoutPoints = pointsAtStake.knockout - pendingR32.length * MATCH_MAX;
  const openToEveryone = futureKnockoutPoints + pointsAtStake.groups + pointsAtStake.brazilMatches;
  const leaderTotal = rows.reduce((max, row) => Math.max(max, row.score.total), 0);

  const reach = new Map();
  for (const row of rows) {
    let maxAdditional = openToEveryone;
    for (const match of pendingR32) {
      const prediction = row.predictions.matches?.[match.id];
      if (prediction && !prediction.ignored && isCompleteScore(prediction)) {
        maxAdditional += MATCH_MAX; // melhor caso: placar exato
      }
    }
    if (row.predictions.champion) maxAdditional += pointsAtStake.champion;
    if (row.predictions.runnerUp) maxAdditional += pointsAtStake.runnerUp;

    const maxTotal = row.score.total + maxAdditional;
    // O lider so ganha pontos daqui pra frente (monotonico), entao quem nao
    // alcanca o total atual dele nem no melhor cenario ja era: eliminado.
    reach.set(row.id, { maxTotal, eliminated: maxTotal < leaderTotal });
  }
  return reach;
}

function computePointsAtStake(tournament) {
  // Maximo de pontos que ainda podem ser conquistados ate o fim da Copa.
  // Fases futuras (oitavas, quartas, semi, 3o lugar, final) contam pelo total
  // previsto do formato mesmo antes de serem cadastradas em tournament.json,
  // e o valor cai a cada resultado novo registrado.
  const MATCH_MAX = 5; // 3 (resultado) + 2 (placar exato)
  const GROUP_MAX = 6; // por grupo: 2 slots x (2 classificado + 1 posicao exata)
  const CHAMPION = 15;
  const RUNNER_UP = 10;

  const breakdown = { groups: 0, brazilMatches: 0, knockout: 0, champion: 0, runnerUp: 0 };

  for (const group of GROUP_LETTERS) {
    const actual = tournament.groups?.[group];
    if (!(actual?.first && actual?.second)) {
      breakdown.groups += GROUP_MAX;
    }
  }

  // Jogos do Brasil na fase de grupos existem sempre em tournament.json:
  // contam os que ainda nao tem placar.
  const decidedByStage = {};
  for (const match of tournament.matches) {
    if (match.stage === "group_brazil") {
      if (!isCompleteScore(match.result)) breakdown.brazilMatches += MATCH_MAX;
      continue;
    }
    if (isCompleteScore(match.result)) {
      decidedByStage[match.stage] = (decidedByStage[match.stage] ?? 0) + 1;
    }
  }

  // Mata-mata: total previsto da fase menos os jogos ja decididos.
  for (const [stage, capacity] of Object.entries(KNOCKOUT_STAGE_MATCH_COUNTS)) {
    const remaining = Math.max(0, capacity - (decidedByStage[stage] ?? 0));
    breakdown.knockout += remaining * MATCH_MAX;
  }

  if (!tournament.champion) breakdown.champion += CHAMPION;
  if (!tournament.runnerUp) breakdown.runnerUp += RUNNER_UP;

  const total =
    breakdown.groups + breakdown.brazilMatches + breakdown.knockout + breakdown.champion + breakdown.runnerUp;

  return { total, ...breakdown };
}

function scoreParticipant(participant, tournament) {
  const score = {
    total: 0,
    groupClassificationPoints: 0,
    brazilGroupMatchPoints: 0,
    groupPhasePoints: 0,
    knockoutPoints: 0,
    championPoints: 0,
    runnerUpPoints: 0,
    outcomeHits: 0,
    exactScoreHits: 0,
    exactKnockoutHits: 0,
  };

  const breakdown = {
    groups: {},
    matches: {},
    champion: { prediction: participant.predictions.champion, actual: tournament.champion, points: 0 },
    runnerUp: { prediction: participant.predictions.runnerUp, actual: tournament.runnerUp, points: 0 },
  };

  for (const group of GROUP_LETTERS) {
    const groupScore = scoreGroupPrediction(participant.predictions.groups?.[group], tournament.groups[group]);
    score.groupClassificationPoints += groupScore.points;
    breakdown.groups[group] = {
      prediction: participant.predictions.groups?.[group] ?? { first: null, second: null },
      actual: tournament.groups[group],
      ...groupScore,
    };
  }

  for (const match of tournament.matches) {
    const prediction = participant.predictions.matches?.[match.id] ?? { home: null, away: null };
    const matchScore = scoreMatchPrediction(prediction, match.result, { stage: match.stage });

    if (match.stage === "group_brazil") {
      score.brazilGroupMatchPoints += matchScore.points;
    } else if (KNOCKOUT_STAGES.has(match.stage)) {
      score.knockoutPoints += matchScore.points;
    }

    if (matchScore.outcomeHit) score.outcomeHits += 1;
    if (matchScore.exactHit) score.exactScoreHits += 1;
    if (matchScore.exactKnockoutHit) score.exactKnockoutHits += 1;

    breakdown.matches[match.id] = {
      match,
      prediction,
      ...matchScore,
    };
  }

  if (tournament.champion && participant.predictions.champion === tournament.champion) {
    score.championPoints = 15;
    breakdown.champion.points = 15;
  }

  if (tournament.runnerUp && participant.predictions.runnerUp === tournament.runnerUp) {
    score.runnerUpPoints = 10;
    breakdown.runnerUp.points = 10;
  }

  score.groupPhasePoints = score.groupClassificationPoints + score.brazilGroupMatchPoints;
  score.total =
    score.groupPhasePoints + score.knockoutPoints + score.championPoints + score.runnerUpPoints;

  return {
    id: participant.id,
    displayName: participant.displayName,
    predictions: participant.predictions,
    score,
    breakdown,
  };
}

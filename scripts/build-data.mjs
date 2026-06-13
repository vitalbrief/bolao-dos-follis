import fs from "node:fs/promises";
import path from "node:path";
import { parseCsvWithHeaders } from "./csv.mjs";
import {
  GROUP_LETTERS,
  KNOCKOUT_STAGES,
  buildPeopleIndex,
  buildTeamIndex,
  canonicalizeTeam,
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
const teamAliasesPath = args.teamAliases ?? "data/manual/team-aliases.json";
const tournamentPath = args.tournament ?? "data/manual/tournament.json";
const siteOutPath = args.out ?? "site/data/site-data.json";
const generatedOutPath = args.generatedOut ?? "data/generated/site-data.json";

const [formsConfig, people, teamAliases, tournamentRaw] = await Promise.all([
  readJson(formsPath),
  readJson(peoplePath),
  readJson(teamAliasesPath),
  readJson(tournamentPath),
]);

const peopleIndex = buildPeopleIndex(people);
const teamIndex = buildTeamIndex(teamAliases);
const warnings = [];
const participants = new Map();
const submissions = [];

const tournament = canonicalizeTournament(tournamentRaw, teamIndex);
const matchesById = new Map(tournament.matches.map((match) => [match.id, match]));

for (const form of formsConfig.forms) {
  if (form.stage !== "group") {
    warnings.push(`Formulario ${form.id} ignorado: stage "${form.stage}" ainda nao esta implementado.`);
    continue;
  }

  const csvPath = path.resolve(root, form.sourceCsv);
  const csvText = await fs.readFile(csvPath, "utf8");
  const { headers, records } = parseCsvWithHeaders(csvText);

  validateColumnCount(form, headers, warnings);

  for (const cells of records) {
    const submission = parseGroupSubmission({ form, cells, peopleIndex, teamIndex, matchesById, warnings });
    submissions.push(submission);

    const existing = participants.get(submission.person.id);
    if (!existing) {
      participants.set(submission.person.id, participantFromSubmission(submission));
      continue;
    }

    const existingSubmission = existing.submissions[form.id];
    if (existingSubmission) {
      warnings.push(
        `${submission.person.displayName} tem mais de uma resposta em ${form.label}. Foi usada a mais recente.`,
      );
      if (submission.sortableTimestamp > existingSubmission.sortableTimestamp) {
        existing.submissions[form.id] = submission;
        // Merge instead of overwrite para preservar palpites de outras fases (formularios futuros).
        existing.predictions = mergePredictions(existing.predictions, submission.predictions);
      }
    } else {
      existing.submissions[form.id] = submission;
      existing.predictions = mergePredictions(existing.predictions, submission.predictions);
    }
  }
}

const scoreRows = [...participants.values()].map((participant) => scoreParticipant(participant, tournament));
const ranking = rankScoreRows(scoreRows);

const output = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: "Google Forms CSV + arquivos manuais",
    participantCount: ranking.length,
    submissionCount: submissions.length,
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
    predictions: row.predictions,
    breakdown: row.breakdown,
  })),
  ranking: ranking.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    rank: row.rank,
    score: row.score,
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

function validateColumnCount(form, headers, targetWarnings) {
  const expectedIndexes = [
    form.timestampColumnIndex,
    form.nameColumnIndex,
    form.championColumnIndex,
    form.runnerUpColumnIndex,
    ...Object.values(form.groupColumns).flatMap((group) => [group.firstColumnIndex, group.secondColumnIndex]),
    ...form.matchScoreColumns.flatMap((match) => [match.homeScoreColumnIndex, match.awayScoreColumnIndex]),
  ];
  const maxExpected = Math.max(...expectedIndexes);
  if (headers.length <= maxExpected) {
    targetWarnings.push(
      `Formulario ${form.id} tem ${headers.length} colunas, mas a configuracao espera a coluna ${maxExpected + 1}.`,
    );
  }
}

function parseGroupSubmission({ form, cells, peopleIndex, teamIndex, matchesById, warnings: targetWarnings }) {
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

function participantFromSubmission(submission) {
  return {
    id: submission.person.id,
    displayName: submission.person.displayName,
    submissions: {
      [submission.formId]: submission,
    },
    predictions: submission.predictions,
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

function parseBrazilianDateTime(value) {
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const [, day, month, year, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
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

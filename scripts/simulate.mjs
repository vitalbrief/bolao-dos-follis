import { isCompleteScore, KNOCKOUT_STAGES, normalizeKey, outcome, scoreMatchPrediction } from "./score.mjs";

// ----------------------------------------------------------------------------
// Chaveamento (bracket) da Copa 2026 a partir das 16-avos.
//
// Cada par abaixo indica os dois jogos das 16-avos cujos vencedores se enfrentam
// nas oitavas. A ordem dos pares e a ordem do proprio chaveamento: oitavas 1 e 2
// levam a quarta 1, quartas 1 e 2 levam a semi 1, e assim por diante. Ou seja,
// basta ir emparelhando vencedores adjacentes ate sobrar o campeao.
//
// Fonte do cruzamento (numeros de jogo FIFA 89-96):
//   89 = V(ger-par) x V(fra-swe)   90 = V(rsa-can) x V(ned-mar)
//   91 = V(por-cro) x V(esp-aut)   92 = V(usa-bih) x V(bel-sen)
//   93 = V(bra-jpn) x V(civ-nor)   94 = V(mex-ecu) x V(eng-cod)
//   95 = V(arg-cpv) x V(aus-egy)   96 = V(sui-alg) x V(col-gan)
// ----------------------------------------------------------------------------
export const ROUND_OF_16_PAIRS = Object.freeze([
  ["ger-par", "fra-swe"],
  ["rsa-can", "ned-mar"],
  ["por-cro", "esp-aut"],
  ["usa-bih", "bel-sen"],
  ["bra-jpn", "civ-nor"],
  ["mex-ecu", "eng-cod"],
  ["arg-cpv", "aus-egy"],
  ["sui-alg", "col-gan"],
]);

// Forca relativa (escala tipo Elo) das selecoes. Sao estimativas editaveis:
// mexer aqui muda diretamente as probabilidades. Times sem valor usam DEFAULT_ELO.
export const TEAM_ELO = Object.freeze({
  Argentina: 2085,
  Espanha: 2050,
  França: 2040,
  Brasil: 2010,
  Inglaterra: 1990,
  Portugal: 1975,
  Holanda: 1965,
  Alemanha: 1945,
  Bélgica: 1915,
  Marrocos: 1860,
  Noruega: 1850,
  Colômbia: 1835,
  Croácia: 1830,
  Japão: 1820,
  Senegal: 1815,
  Suíça: 1810,
  EUA: 1795,
  México: 1790,
  Áustria: 1785,
  Equador: 1775,
  Suécia: 1770,
  "Costa do Marfim": 1770,
  Argélia: 1760,
  Canadá: 1760,
  Egito: 1755,
  Austrália: 1740,
  Paraguai: 1730,
  "RD Congo": 1730,
  Gana: 1720,
  "Bósnia e Herz.": 1715,
  "África do Sul": 1715,
  "Cabo Verde": 1650,
});

const DEFAULT_ELO = 1720;
const ELO_PER_GOAL = 300; // ~300 pontos de Elo equivalem a 1 gol de vantagem esperada
const BASE_TOTAL_GOALS = 2.6; // media de gols por jogo no mata-mata
const PREDICTION_TOTAL_GOALS = 2.35; // palpites tendem a ser um pouco mais conservadores
const CHAMPION_PICK_ELO_BONUS = 120;
const RUNNER_UP_PICK_ELO_BONUS = 70;
const FUTURE_STAGES_BY_BRACKET_SIZE = Object.freeze({
  8: "quarterfinal",
  4: "semifinal",
  2: "final",
});

function eloOf(team, eloIndex) {
  if (!team) return DEFAULT_ELO;
  return eloIndex.get(normalizeKey(team)) ?? DEFAULT_ELO;
}

// Probabilidade de A avancar sobre B (ja embute a decisao por penaltis num empate).
function advanceProbability(eloA, eloB) {
  return 1 / (1 + 10 ** ((eloB - eloA) / 400));
}

// PRNG deterministico (mulberry32): mesmo build => mesmo resultado, sem ruido no git.
function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lambda, rng) {
  const limit = Math.exp(-lambda);
  let count = 0;
  let product = rng();
  while (product > limit) {
    count += 1;
    product *= rng();
  }
  return count;
}

// Sorteia um placar plausivel para um confronto de mata-mata.
function simulateScore(eloA, eloB, rng, { totalGoals = BASE_TOTAL_GOALS } = {}) {
  const supremacy = Math.max(-2.4, Math.min(2.4, (eloA - eloB) / ELO_PER_GOAL));
  const lambdaA = Math.max(0.2, totalGoals / 2 + supremacy / 2);
  const lambdaB = Math.max(0.2, totalGoals / 2 - supremacy / 2);
  return { home: poisson(lambdaA, rng), away: poisson(lambdaB, rng) };
}

// Chave que identifica um confronto pelo par de times (independe da ordem).
function pairKey(teamA, teamB) {
  return [normalizeKey(teamA), normalizeKey(teamB)].sort().join("|");
}

function stagePairKey(stage, teamA, teamB) {
  return `${stage}:${pairKey(teamA, teamB)}`;
}

// Vencedor de um confronto a partir de um placar (real ou sorteado). Empate no
// tempo normal decide pelo campo "advanced" (penaltis ja acontecidos) ou, se o
// jogo ainda nao aconteceu, por um sorteio ponderado pela forca dos times.
function winnerFromScore(match, score, eloIndex, rng) {
  if (score.home > score.away) return match.homeTeam;
  if (score.away > score.home) return match.awayTeam;
  if (match.advanced) return match.advanced;
  const pA = advanceProbability(eloOf(match.homeTeam, eloIndex), eloOf(match.awayTeam, eloIndex));
  return rng() < pA ? match.homeTeam : match.awayTeam;
}

/**
 * Roda o Monte Carlo do restante do torneio e devolve, por participante, a
 * probabilidade de terminar em 1o (titleChance) e no top 3 (podiumChance).
 *
 * Simula o chaveamento inteiro (16-avos, oitavas, quartas, semi, 3o lugar e
 * final) para definir campeao/vice e os pontos dos jogos pendentes. Palpites
 * reais ja enviados sempre prevalecem; para jogos futuros sem palpite, o modelo
 * simula como cada participante provavelmente apostaria.
 */
export function simulateStandings(tournament, rows, { iterations = 30000, seed = 20260701 } = {}) {
  const eloIndex = new Map(Object.entries(TEAM_ELO).map(([team, elo]) => [normalizeKey(team), elo]));
  const rng = makeRng(seed);

  const knockoutMatches = tournament.matches.filter((match) => KNOCKOUT_STAGES.has(match.stage));
  const knockoutById = new Map(knockoutMatches.map((match) => [match.id, match]));
  const roundOf32Matches = knockoutMatches.filter((match) => match.stage === "round_of_32");
  const realByStageAndPair = new Map(
    knockoutMatches.map((match) => [stagePairKey(match.stage, match.homeTeam, match.awayTeam), match]),
  );

  const warnings = [];
  for (const [a, b] of ROUND_OF_16_PAIRS) {
    if (!knockoutById.has(a) || !knockoutById.has(b)) {
      warnings.push(`Simulacao: chaveamento cita jogo inexistente (${a} / ${b}).`);
    }
  }
  for (const match of knockoutMatches) {
    if (isCompleteScore(match.result) && outcome(match.result) === "draw" && !match.advanced) {
      warnings.push(
        `Simulacao: ${match.homeTeam} x ${match.awayTeam} (${match.id}) terminou empatado, mas nao informa quem avancou (campo "advanced"). O chaveamento pode ficar incorreto.`,
      );
    }
  }

  // Estado base de cada participante (pontos ja garantidos + componentes de desempate).
  const players = rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    predictions: row.predictions,
    profile: buildPredictionProfile(row),
    base: {
      total: row.score.total,
      exactTiebreakerHits: row.score.exactTiebreakerHits ?? row.score.exactKnockoutHits,
      outcomeHits: row.score.outcomeHits,
      groupPhasePoints: row.score.groupPhasePoints,
    },
    wins: 0,
    podium: 0,
  }));

  const scratch = players.map(() => ({ total: 0, exact: 0, out: 0, grp: 0 }));
  const context = { realByStageAndPair, simResults: null, eloIndex };

  for (let iter = 0; iter < iterations; iter += 1) {
    // 1) Resolve os 16 avos ja cadastrados. Jogos decididos usam placar real;
    //    pendentes sorteiam um placar. Esses jogos ja tem formulario, entao
    //    palpites reais sao usados quando existem.
    const simResults = new Map();
    const scoringEvents = [];
    const advancers = new Map();
    context.simResults = simResults;

    for (const match of roundOf32Matches) {
      const event = resolveRegisteredMatch(match, context, rng);
      advancers.set(match.id, event.winner);
      if (shouldScoreEvent(event)) scoringEvents.push(event);
    }

    // 2) Oitavas: cruza os vencedores das 16-avos conforme o chaveamento. Se o
    //    jogo ja tiver sido cadastrado em tournament.json, usa esse registro;
    //    senao cria uma partida futura apenas para esta simulacao.
    const roundOf16Events = ROUND_OF_16_PAIRS.map(([a, b], index) =>
      resolveMatchEvent(
        advancers.get(a),
        advancers.get(b),
        "round_of_16",
        `sim-round_of_16-${index + 1}`,
        context,
        rng,
      ),
    );
    for (const event of roundOf16Events) {
      if (shouldScoreEvent(event)) scoringEvents.push(event);
    }
    let bracket = roundOf16Events.map((event) => event.winner);

    // 3) Reduz quartas -> semi -> final, sempre emparelhando adjacentes.
    let champion = null;
    let runnerUp = null;
    const semifinalLosers = [];
    while (bracket.length > 1) {
      const stage = FUTURE_STAGES_BY_BRACKET_SIZE[bracket.length];
      const next = [];
      for (let i = 0; i < bracket.length; i += 2) {
        const event = resolveMatchEvent(
          bracket[i],
          bracket[i + 1],
          stage,
          `sim-${stage}-${i / 2 + 1}`,
          context,
          rng,
        );
        if (shouldScoreEvent(event)) scoringEvents.push(event);
        if (stage === "semifinal" && event.loser) {
          semifinalLosers.push(event.loser);
        }
        if (stage === "final") {
          champion = event.winner;
          runnerUp = event.loser;
        }
        next.push(event.winner);
      }
      bracket = next;
    }

    // 4) Disputa de terceiro lugar entre os perdedores das semifinais.
    if (semifinalLosers.length === 2) {
      const thirdPlaceEvent = resolveMatchEvent(
        semifinalLosers[0],
        semifinalLosers[1],
        "third_place",
        "sim-third_place-1",
        context,
        rng,
      );
      if (shouldScoreEvent(thirdPlaceEvent)) scoringEvents.push(thirdPlaceEvent);
    }

    // 5) Pontuacao de cada participante nesta simulacao.
    for (let p = 0; p < players.length; p += 1) {
      const player = players[p];
      const s = scratch[p];
      s.total = player.base.total;
      s.exact = player.base.exactTiebreakerHits;
      s.out = player.base.outcomeHits;
      s.grp = player.base.groupPhasePoints;

      for (const event of scoringEvents) {
        const prediction = predictionForEvent(player, event, context, rng);
        if (!prediction) continue;
        const scored = scoreMatchPrediction(prediction, event.score, { stage: event.match.stage });
        s.total += scored.points;
        if (scored.outcomeHit) s.out += 1;
        if (scored.exactTiebreakerHit) s.exact += 1;
      }

      if (champion && player.predictions.champion === champion) s.total += 15;
      if (runnerUp && player.predictions.runnerUp === runnerUp) s.total += 10;
    }

    // 6) Ranking desta simulacao (mesmos criterios de desempate do bolao).
    tallyPlacings(players, scratch);
  }

  const summary = players.map((player) => ({
    id: player.id,
    titleChance: player.wins / iterations,
    podiumChance: player.podium / iterations,
  }));

  return { summary, warnings, iterations };
}

function resolveRegisteredMatch(match, context, rng) {
  const score = scoreForMatch(match, context, rng);
  return eventFromMatch(match, score, context, rng, false);
}

function resolveMatchEvent(teamA, teamB, stage, fallbackId, context, rng) {
  if (!teamA || !teamB) {
    return {
      match: {
        id: fallbackId,
        stage,
        homeTeam: teamA,
        awayTeam: teamB,
        result: { home: null, away: null },
      },
      score: null,
      winner: teamA ?? teamB ?? null,
      loser: null,
      generated: true,
    };
  }

  const registered = context.realByStageAndPair.get(stagePairKey(stage, teamA, teamB));
  if (registered) {
    const score = scoreForMatch(registered, context, rng);
    return eventFromMatch(registered, score, context, rng, false);
  }

  const match = {
    id: fallbackId,
    stage,
    homeTeam: teamA,
    awayTeam: teamB,
    result: { home: null, away: null },
  };
  const score = scoreForMatch(match, context, rng);
  return eventFromMatch(match, score, context, rng, true);
}

function scoreForMatch(match, context, rng) {
  if (isCompleteScore(match.result)) return match.result;
  const cached = context.simResults.get(match.id);
  if (cached) return cached;
  const score = simulateScore(eloOf(match.homeTeam, context.eloIndex), eloOf(match.awayTeam, context.eloIndex), rng);
  context.simResults.set(match.id, score);
  return score;
}

function eventFromMatch(match, score, context, rng, generated) {
  const winner = score ? winnerFromScore(match, score, context.eloIndex, rng) : null;
  const loser = winner === match.homeTeam ? match.awayTeam : match.homeTeam;
  return { match, score, winner, loser, generated };
}

function shouldScoreEvent(event) {
  return Boolean(event.score) && !isCompleteScore(event.match.result);
}

function predictionForEvent(player, event, context, rng) {
  const realPrediction = player.predictions.matches?.[event.match.id];
  if (realPrediction) {
    if (realPrediction.ignored || !isCompleteScore(realPrediction)) return null;
    return realPrediction;
  }

  // Os 16 avos ja tem formulario no projeto. Se alguem nao apostou ali, isso
  // continua valendo zero; palpites simulados entram para as fases futuras.
  if (event.match.stage === "round_of_32") return null;

  return simulateFuturePrediction(player, event.match, context, rng);
}

function simulateFuturePrediction(player, match, context, rng) {
  if (!match.homeTeam || !match.awayTeam) return null;

  let homeElo = bettorEloForTeam(player, match.homeTeam, context.eloIndex);
  let awayElo = bettorEloForTeam(player, match.awayTeam, context.eloIndex);
  const noise = (rng() - rng()) * player.profile.predictionNoiseElo;
  homeElo += noise;
  awayElo -= noise;

  const sampled = simulateScore(homeElo, awayElo, rng, {
    totalGoals: player.profile.predictedTotalGoals,
  });
  return capPredictionScore(adjustPredictionDraw(sampled, player.profile, homeElo, awayElo, rng));
}

function bettorEloForTeam(player, team, eloIndex) {
  let elo = eloOf(team, eloIndex);
  if (sameTeam(team, player.predictions.champion)) elo += CHAMPION_PICK_ELO_BONUS;
  if (sameTeam(team, player.predictions.runnerUp)) elo += RUNNER_UP_PICK_ELO_BONUS;
  return elo;
}

function adjustPredictionDraw(score, profile, homeElo, awayElo, rng) {
  const adjusted = { ...score };
  if (adjusted.home === adjusted.away && rng() > profile.drawPredictionRate) {
    if (rng() < advanceProbability(homeElo, awayElo)) {
      adjusted.home += 1;
    } else {
      adjusted.away += 1;
    }
  } else if (adjusted.home !== adjusted.away && rng() < profile.drawPredictionRate * 0.25) {
    const shared = Math.min(adjusted.home, adjusted.away);
    adjusted.home = shared;
    adjusted.away = shared;
  }
  return adjusted;
}

function capPredictionScore(score) {
  return {
    home: Math.min(score.home, 5),
    away: Math.min(score.away, 5),
  };
}

function buildPredictionProfile(row) {
  let attempts = 0;
  let outcomeHits = 0;
  let exactHits = 0;
  let drawPredictions = 0;
  let predictedGoals = 0;

  for (const entry of Object.values(row.breakdown?.matches ?? {})) {
    if (!isCompleteScore(entry.match?.result) || !isCompleteScore(entry.prediction)) continue;
    if (entry.match.stage !== "group_brazil" && !KNOCKOUT_STAGES.has(entry.match.stage)) continue;

    attempts += 1;
    predictedGoals += entry.prediction.home + entry.prediction.away;
    if (entry.outcomeHit) outcomeHits += 1;
    if (entry.exactHit) exactHits += 1;
    if (outcome(entry.prediction) === "draw") drawPredictions += 1;
  }

  const outcomeRate = smoothRate(outcomeHits, attempts, 0.55, 10);
  const exactRate = smoothRate(exactHits, attempts, 0.1, 12);
  const skill = clamp(((outcomeRate - 0.48) / 0.22) * 0.65 + ((exactRate - 0.08) / 0.14) * 0.35, 0, 1);

  return {
    outcomeRate,
    exactRate,
    predictionNoiseElo: 280 - skill * 170,
    predictedTotalGoals: clamp(smoothAverage(predictedGoals, attempts, PREDICTION_TOTAL_GOALS, 8), 1.8, 3.1),
    drawPredictionRate: clamp(smoothRate(drawPredictions, attempts, 0.18, 8), 0.05, 0.35),
  };
}

function smoothRate(hits, attempts, priorRate, priorWeight) {
  return (hits + priorRate * priorWeight) / (attempts + priorWeight);
}

function smoothAverage(total, count, priorAverage, priorWeight) {
  return (total + priorAverage * priorWeight) / (count + priorWeight);
}

function sameTeam(a, b) {
  return normalizeKey(a) === normalizeKey(b);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function better(a, b) {
  return (
    b.total - a.total || b.exact - a.exact || b.out - a.out || b.grp - a.grp
  );
}

// Credita vitoria (rank 1) e pódio (rank <= 3) desta simulacao. Empates exatos
// nos criterios de desempate dividem o credito igualmente.
function tallyPlacings(players, scratch) {
  const order = scratch.map((s, index) => ({ index, s })).sort((x, y) => better(x.s, y.s));

  // Rank 1: todos empatados no topo dividem a vitoria.
  let leaders = 1;
  while (leaders < order.length && better(order[0].s, order[leaders].s) === 0) leaders += 1;
  for (let i = 0; i < leaders; i += 1) players[order[i].index].wins += 1 / leaders;

  // Top 3: conta quem esta nas 3 primeiras posicoes considerando empates.
  let counted = 0;
  let i = 0;
  while (i < order.length && counted < 3) {
    let group = i + 1;
    while (group < order.length && better(order[i].s, order[group].s) === 0) group += 1;
    const size = group - i;
    const slotsLeft = 3 - counted;
    const share = size <= slotsLeft ? 1 : slotsLeft / size;
    for (let k = i; k < group; k += 1) players[order[k].index].podium += share;
    counted += size;
    i = group;
  }
}

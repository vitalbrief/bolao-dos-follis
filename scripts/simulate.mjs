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
//   91 = V(bra-jpn) x V(civ-nor)   92 = V(mex-ecu) x V(eng-cod)
//   93 = V(por-cro) x V(esp-aut)   94 = V(usa-bih) x V(bel-sen)
//   95 = V(arg-cpv) x V(aus-egy)   96 = V(sui-alg) x V(col-gan)
// ----------------------------------------------------------------------------
export const ROUND_OF_16_PAIRS = Object.freeze([
  ["ger-par", "fra-swe"],
  ["rsa-can", "ned-mar"],
  ["bra-jpn", "civ-nor"],
  ["mex-ecu", "eng-cod"],
  ["por-cro", "esp-aut"],
  ["usa-bih", "bel-sen"],
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
function simulateScore(eloA, eloB, rng) {
  const supremacy = Math.max(-2.4, Math.min(2.4, (eloA - eloB) / ELO_PER_GOAL));
  const lambdaA = Math.max(0.2, BASE_TOTAL_GOALS / 2 + supremacy / 2);
  const lambdaB = Math.max(0.2, BASE_TOTAL_GOALS / 2 - supremacy / 2);
  return { home: poisson(lambdaA, rng), away: poisson(lambdaB, rng) };
}

// Chave que identifica um confronto pelo par de times (independe da ordem).
function pairKey(teamA, teamB) {
  return [normalizeKey(teamA), normalizeKey(teamB)].sort().join("|");
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

// Vencedor de um confronto entre dois times ja definidos. Se esse jogo ja existe
// no tournament.json (fase futura ja cadastrada), usa o resultado real/sorteado
// dele; senao, sorteia direto pela forca (fase ainda nem chaveada).
function resolveMatch(teamA, teamB, context, rng) {
  if (!teamA) return teamB ?? null;
  if (!teamB) return teamA;
  const real = context.realByPair.get(pairKey(teamA, teamB));
  if (real) {
    const score = isCompleteScore(real.result) ? real.result : context.simResults.get(real.id);
    if (score) return winnerFromScore(real, score, context.eloIndex, rng);
  }
  return playKnockout(teamA, teamB, context.eloIndex, rng);
}

/**
 * Roda o Monte Carlo do restante do torneio e devolve, por participante, a
 * probabilidade de terminar em 1o (titleChance) e no top 3 (podiumChance).
 *
 * Simula o chaveamento inteiro (16-avos ate a final) para definir campeao e vice,
 * e pontua todos os jogos de mata-mata que ainda estao pendentes E ja tem palpite.
 * Hoje isso e so as 16-avos restantes; quando os formularios das oitavas em diante
 * abrirem, esses jogos entram automaticamente na pontuacao (usam o proprio
 * homeTeam/awayTeam do jogo para sortear o placar).
 */
export function simulateStandings(tournament, rows, { iterations = 30000, seed = 20260701 } = {}) {
  const eloIndex = new Map(Object.entries(TEAM_ELO).map(([team, elo]) => [normalizeKey(team), elo]));
  const rng = makeRng(seed);

  const knockoutMatches = tournament.matches.filter((match) => KNOCKOUT_STAGES.has(match.stage));
  const knockoutById = new Map(knockoutMatches.map((match) => [match.id, match]));
  const pendingKnockout = knockoutMatches.filter((match) => !isCompleteScore(match.result));
  const realByPair = new Map(knockoutMatches.map((match) => [pairKey(match.homeTeam, match.awayTeam), match]));

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
    base: {
      total: row.score.total,
      exactKnockoutHits: row.score.exactKnockoutHits,
      outcomeHits: row.score.outcomeHits,
      groupPhasePoints: row.score.groupPhasePoints,
    },
    wins: 0,
    podium: 0,
  }));

  const scratch = players.map(() => ({ total: 0, eko: 0, out: 0, grp: 0 }));
  const context = { realByPair, simResults: null, eloIndex };

  for (let iter = 0; iter < iterations; iter += 1) {
    // 1) Placar e vencedor de cada jogo de mata-mata ja cadastrado. Jogos
    //    decididos usam o placar real; pendentes sorteiam pela forca dos times.
    const simResults = new Map();
    const advancers = new Map();
    for (const match of knockoutMatches) {
      const score = isCompleteScore(match.result)
        ? match.result
        : simulateScore(eloOf(match.homeTeam, eloIndex), eloOf(match.awayTeam, eloIndex), rng);
      if (!isCompleteScore(match.result)) simResults.set(match.id, score);
      advancers.set(match.id, winnerFromScore(match, score, eloIndex, rng));
    }
    context.simResults = simResults;

    // 2) Oitavas: cruza os vencedores das 16-avos conforme o chaveamento.
    let bracket = ROUND_OF_16_PAIRS.map(([a, b]) =>
      resolveMatch(advancers.get(a), advancers.get(b), context, rng),
    );

    // 3) Reduz quartas -> semi -> final, sempre emparelhando adjacentes. Se a fase
    //    ja estiver cadastrada, resolveMatch usa o jogo real; senao, sorteia.
    let champion = null;
    let runnerUp = null;
    while (bracket.length > 1) {
      const next = [];
      for (let i = 0; i < bracket.length; i += 2) {
        const teamA = bracket[i];
        const teamB = bracket[i + 1];
        const winner = resolveMatch(teamA, teamB, context, rng);
        if (bracket.length === 2) {
          champion = winner;
          runnerUp = winner === teamA ? teamB : teamA;
        }
        next.push(winner);
      }
      bracket = next;
    }

    // 4) Pontuacao de cada participante nesta simulacao.
    for (let p = 0; p < players.length; p += 1) {
      const player = players[p];
      const s = scratch[p];
      s.total = player.base.total;
      s.eko = player.base.exactKnockoutHits;
      s.out = player.base.outcomeHits;
      s.grp = player.base.groupPhasePoints;

      for (const match of pendingKnockout) {
        const prediction = player.predictions.matches?.[match.id];
        if (!prediction) continue;
        const scored = scoreMatchPrediction(prediction, simResults.get(match.id), { stage: match.stage });
        s.total += scored.points;
        if (scored.outcomeHit) s.out += 1;
        if (scored.exactKnockoutHit) s.eko += 1;
      }

      if (champion && player.predictions.champion === champion) s.total += 15;
      if (runnerUp && player.predictions.runnerUp === runnerUp) s.total += 10;
    }

    // 5) Ranking desta simulacao (mesmos criterios de desempate do bolao).
    tallyPlacings(players, scratch);
  }

  const summary = players.map((player) => ({
    id: player.id,
    titleChance: player.wins / iterations,
    podiumChance: player.podium / iterations,
  }));

  return { summary, warnings, iterations };
}

function playKnockout(teamA, teamB, eloIndex, rng) {
  if (!teamA) return teamB ?? null;
  if (!teamB) return teamA;
  const pA = advanceProbability(eloOf(teamA, eloIndex), eloOf(teamB, eloIndex));
  return rng() < pA ? teamA : teamB;
}

function better(a, b) {
  return (
    b.total - a.total || b.eko - a.eko || b.out - a.out || b.grp - a.grp
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

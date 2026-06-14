const DATA_URL = "data/site-data.json";

const state = {
  data: null,
  activeView: "ranking",
};

const formatDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

// Canonical team name (pt-BR) -> flag emoji.
const TEAM_FLAGS = {
  "África do Sul": "🇿🇦",
  Alemanha: "🇩🇪",
  Argélia: "🇩🇿",
  "Arábia Saudita": "🇸🇦",
  Argentina: "🇦🇷",
  Austrália: "🇦🇺",
  Áustria: "🇦🇹",
  Bélgica: "🇧🇪",
  "Bósnia e Herz.": "🇧🇦",
  Brasil: "🇧🇷",
  Canadá: "🇨🇦",
  Colômbia: "🇨🇴",
  "Coreia do Sul": "🇰🇷",
  "Costa do Marfim": "🇨🇮",
  Croácia: "🇭🇷",
  Egito: "🇪🇬",
  Equador: "🇪🇨",
  Escócia: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  Espanha: "🇪🇸",
  EUA: "🇺🇸",
  França: "🇫🇷",
  Gana: "🇬🇭",
  Haiti: "🇭🇹",
  Holanda: "🇳🇱",
  Irã: "🇮🇷",
  Iraque: "🇮🇶",
  Inglaterra: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  Japão: "🇯🇵",
  Marrocos: "🇲🇦",
  México: "🇲🇽",
  Noruega: "🇳🇴",
  "Nova Zelândia": "🇳🇿",
  Paraguai: "🇵🇾",
  Portugal: "🇵🇹",
  "RD Congo": "🇨🇩",
  "Rep. Tcheca": "🇨🇿",
  Senegal: "🇸🇳",
  Suécia: "🇸🇪",
  Suíça: "🇨🇭",
  Turquia: "🇹🇷",
  Uruguai: "🇺🇾",
};

function flag(team) {
  return TEAM_FLAGS[team] ?? "🏳️";
}

init().catch((error) => {
  document.body.innerHTML = `<main class="panel" style="margin:40px auto;max-width:560px"><h1>Bolão dos Follis</h1><p>Não foi possível carregar os dados.</p><pre>${escapeHtml(error.message)}</pre></main>`;
});

async function init() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Falha ao carregar ${DATA_URL}`);
  }
  state.data = await response.json();

  wireTabs();
  renderHeroStats();
  renderWarnings();
  renderPodium();
  renderRanking();
  renderParticipantSelect();
  renderParticipantDetail(state.data.participants[0]?.id);
  renderChampionBoard();
  renderResults();
  renderRules();
  renderAliases();
  renderFooter();
}

function wireTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      document.querySelectorAll(".tab-button").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle("is-active", view.id === `view-${state.activeView}`);
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function hasAnyPoints() {
  return state.data.ranking.some((row) => row.score.total > 0);
}

function renderHeroStats() {
  const { meta, tournament, ranking } = state.data;
  const leaderCount = ranking.filter((row) => row.rank === 1).length;
  const finishedMatches = tournament.matches.filter((match) => isCompleteScore(match.result)).length;
  const live = hasAnyPoints();
  const generatedAt = new Date(meta.generatedAt);

  const leaderStat = !live
    ? statCard("0–0", "placar zerado")
    : statCard(leaderCount, leaderCount === 1 ? "líder isolado" : "empatados na ponta");

  document.querySelector("#hero-stats").innerHTML = [
    statCard(meta.participantCount, "palpiteiros"),
    leaderStat,
    statCard(finishedMatches, "jogos com resultado"),
    statCard(formatDate.format(generatedAt).split(",")[0] ?? "—", "atualizado em", "stat-card--date"),
  ].join("");
}

function statCard(value, label, className = "") {
  const classes = ["stat-card", className].filter(Boolean).join(" ");
  return `<div class="${classes}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderWarnings() {
  const warnings = state.data.warnings ?? [];
  const target = document.querySelector("#warnings");
  if (!warnings.length) {
    target.innerHTML = "";
    return;
  }
  target.innerHTML = `
    <div class="warning-card">
      <strong>⚠️ Conferir antes de publicar</strong>
      <ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderPodium() {
  const target = document.querySelector("#podium");
  const live = hasAnyPoints();

  if (!live) {
    target.innerHTML = `
      <div class="podium-waiting">
        <span class="big" aria-hidden="true">🏆</span>
        <div>
          <strong>O pódio aguarda o primeiro apito</strong>
          <span>Assim que os jogos começarem, os três primeiros aparecem aqui em destaque.</span>
        </div>
      </div>
    `;
    return;
  }

  const top3 = state.data.ranking.slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];

  target.innerHTML = top3
    .map((row, index) => {
      return `
        <div class="podium-card p${index + 1}">
          <span class="podium-medal" aria-hidden="true">${medals[index]}</span>
          <span class="podium-name">${escapeHtml(row.displayName)}</span>
          <span class="podium-score">${row.score.total}<span>pontos</span></span>
        </div>
      `;
    })
    .join("");
}

function renderRanking() {
  const rows = state.data.ranking;
  const live = hasAnyPoints();
  const byId = new Map(state.data.participants.map((p) => [p.id, p]));
  const status = document.querySelector("#ranking-status");
  status.textContent = live ? "Pontuação em andamento" : "Aguardando resultados";
  status.classList.toggle("is-live", live);

  document.querySelector("#ranking-body").innerHTML = rows
    .map((row) => {
      const champ = byId.get(row.id)?.predictions?.champion ?? null;
      const rankClass = live ? `rank-${row.rank}` : "";
      return `
        <tr class="${rankClass}">
          <td class="col-pos"><span class="rank-badge">${row.rank}</span></td>
          <td>
            <div class="player-cell">
              <span class="player-flag" title="${escapeHtml(champ ?? "sem palpite")}" aria-hidden="true">${flag(champ)}</span>
              <span>
                <span class="player-name">${escapeHtml(row.displayName)}</span>
                <span class="player-sub">aposta: ${escapeHtml(champ ?? "—")}</span>
              </span>
            </div>
          </td>
          <td class="num"><span class="total-score">${row.score.total}</span></td>
          <td class="num hide-sm">${numCell(row.score.groupClassificationPoints)}</td>
          <td class="num hide-sm">${numCell(row.score.brazilGroupMatchPoints)}</td>
          <td class="num hide-sm">${numCell(row.score.knockoutPoints)}</td>
          <td class="num hide-sm">${numCell(row.score.championPoints)}</td>
          <td class="num hide-sm">${numCell(row.score.runnerUpPoints)}</td>
          <td class="hide-md">
            <div class="tiebreakers">
              <span class="score-pill" title="Placares exatos no mata-mata">🎯 ${row.score.exactKnockoutHits}</span>
              <span class="score-pill" title="Resultados acertados">✅ ${row.score.outcomeHits}</span>
              <span class="score-pill" title="Pontos na fase de grupos">🧩 ${row.score.groupPhasePoints}</span>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  document.querySelector("#ranking-note").textContent = live
    ? "Desempate: 🎯 placares exatos no mata-mata · ✅ resultados acertados · 🧩 pontos nos grupos."
    : "Ranking provisório — todos zerados até os jogos começarem. A ordem é só alfabética por enquanto.";
}

function numCell(value) {
  return value > 0
    ? `<span class="num-soft">${value}</span>`
    : `<span class="num-zero">0</span>`;
}

function renderParticipantSelect() {
  const select = document.querySelector("#participant-select");
  select.innerHTML = state.data.participants
    .map((participant) => `<option value="${escapeAttr(participant.id)}">${escapeHtml(participant.displayName)}</option>`)
    .join("");
  select.addEventListener("change", () => renderParticipantDetail(select.value));
}

function renderParticipantDetail(participantId) {
  const participant = state.data.participants.find((item) => item.id === participantId);
  const target = document.querySelector("#participant-detail");

  if (!participant) {
    target.innerHTML = `<div class="empty">Nenhum participante encontrado.</div>`;
    return;
  }

  const s = participant.score;
  const champPoints = s.championPoints + s.runnerUpPoints;

  const matchCards = state.data.tournament.matches
    .map((match) => matchPredictionCard(match, participant.breakdown.matches[match.id]))
    .join("");

  const groupCards = Object.entries(participant.predictions.groups)
    .map(([group, prediction]) => groupPredictionCard(group, prediction, participant.breakdown.groups[group]))
    .join("");

  target.innerHTML = `
    <article class="participant-card">
      <aside class="profile-strip">
        <span class="profile-flag" aria-hidden="true">${flag(participant.predictions.champion)}</span>
        <p class="eyebrow">Palpiteiro</p>
        <h3>${escapeHtml(participant.displayName)}</h3>
        <span class="profile-rank">🏅 ${participant.rank}º no ranking</span>
        <div class="profile-total">${s.total}<span> pontos</span></div>
        <div class="mini-breakdown">
          <div><span>Grupos</span><strong>${s.groupClassificationPoints}</strong></div>
          <div><span>Brasil</span><strong>${s.brazilGroupMatchPoints}</strong></div>
          <div><span>Mata-mata</span><strong>${s.knockoutPoints}</strong></div>
          <div><span>Campeão/Vice</span><strong>${champPoints}</strong></div>
        </div>
      </aside>
      <div class="prediction-stack">
        <div>
          <p class="block-label">🏆 Aposta na taça</p>
          <div class="pick-row">
            ${pickCard("Campeão", participant.predictions.champion, participant.breakdown.champion.points, true)}
            ${pickCard("Vice-campeão", participant.predictions.runnerUp, participant.breakdown.runnerUp.points, false)}
          </div>
        </div>
        <div>
          <p class="block-label">⚽ Jogos do Brasil</p>
          <div class="match-grid">${matchCards}</div>
        </div>
        <div>
          <p class="block-label">🧩 Classificados dos grupos</p>
          <div class="groups-grid">${groupCards}</div>
        </div>
      </div>
    </article>
  `;
}

function pickCard(label, team, points, isChamp) {
  return `
    <div class="pick-card ${isChamp ? "is-champ" : ""}">
      <span class="big-flag" aria-hidden="true">${flag(team)}</span>
      <span class="pick-info">
        <span class="pick-kind">${escapeHtml(label)}</span>
        <span class="pick-team">${escapeHtml(team ?? "Pendente")}</span>
      </span>
      <span class="pts-badge ${points > 0 ? "has-pts" : ""}">${points} pts</span>
    </div>
  `;
}

function groupPredictionCard(group, prediction, breakdown) {
  const actual = breakdown?.actual;
  const actualText =
    actual?.first && actual?.second
      ? `${flag(actual.first)} ${actual.first} · ${flag(actual.second)} ${actual.second}`
      : "a definir";
  const points = breakdown?.points ?? 0;
  return `
    <div class="group-card">
      <div class="group-title">
        <span class="gt-name">Grupo ${escapeHtml(group)}</span>
        <span class="pts-badge ${points > 0 ? "has-pts" : ""}">${points} pts</span>
      </div>
      ${teamLine("1", prediction.first)}
      ${teamLine("2", prediction.second)}
      <div class="group-actual">Resultado: ${escapeHtml(actualText)}</div>
    </div>
  `;
}

function teamLine(position, team) {
  const pending = !team;
  return `
    <div class="team-line">
      <span class="pos">${escapeHtml(position)}º</span>
      <span class="flag" aria-hidden="true">${flag(team)}</span>
      <span class="name ${pending ? "pending" : ""}">${escapeHtml(team ?? "Pendente")}</span>
    </div>
  `;
}

function matchPredictionCard(match, breakdown) {
  const prediction = breakdown?.prediction ?? { home: null, away: null };
  const result = match.result;
  const resultLabel = isCompleteScore(result) ? `${result.home} – ${result.away}` : "— – —";
  const predictionLabel = isCompleteScore(prediction) ? `${prediction.home} – ${prediction.away}` : "— – —";
  const points = breakdown?.points ?? 0;

  return `
    <div class="match-card">
      <div class="mc-teams">
        <span class="t"><span aria-hidden="true">${flag(match.homeTeam)}</span><span>${escapeHtml(match.homeTeam)}</span></span>
        <span class="t"><span>${escapeHtml(match.awayTeam)}</span><span aria-hidden="true">${flag(match.awayTeam)}</span></span>
      </div>
      <div class="mc-scores">
        <span class="mc-pred">
          <span class="lbl">Palpite</span>
          <span class="val">${escapeHtml(predictionLabel)}</span>
        </span>
        <span class="mc-divider"></span>
        <span class="mc-pred">
          <span class="lbl">Resultado</span>
          <span class="val result">${escapeHtml(resultLabel)}</span>
        </span>
        <span class="pts-badge ${points > 0 ? "has-pts" : ""}">${points} pts</span>
      </div>
    </div>
  `;
}

function renderChampionBoard() {
  const target = document.querySelector("#champion-board");
  target.innerHTML = state.data.participants
    .map((participant) => {
      const champ = participant.predictions.champion;
      const vice = participant.predictions.runnerUp;
      return `
        <div class="champion-card">
          <span class="cc-flag" aria-hidden="true">${flag(champ)}</span>
          <span class="cc-info">
            <span class="cc-name">${escapeHtml(participant.displayName)}</span>
            <span class="cc-pick">🏆 ${escapeHtml(champ ?? "Pendente")}</span>
            <span class="cc-vice">🥈 Vice: ${escapeHtml(vice ?? "Pendente")}</span>
          </span>
        </div>
      `;
    })
    .join("");
}

function renderResults() {
  const matches = state.data.tournament.matches;
  const finished = matches.filter((match) => isCompleteScore(match.result)).length;
  const status = document.querySelector("#results-status");
  status.textContent = finished ? `${finished} jogo(s) finalizado(s)` : "Sem jogos finalizados";
  status.classList.toggle("is-live", finished > 0);

  document.querySelector("#match-list").innerHTML = matches
    .map((match) => {
      const final = isCompleteScore(match.result);
      const scoreBox = final
        ? `<span class="score-box">${match.result.home}<span class="x">×</span>${match.result.away}</span>`
        : `<span class="score-box pending">—<span class="x">×</span>—</span>`;
      return `
        <div class="result-row ${final ? "is-final" : ""}">
          <span class="result-stage">${escapeHtml(match.stageLabel ?? "Jogo")}</span>
          <span class="result-team home">
            <span class="nm">${escapeHtml(match.homeTeam)}</span>
            <span class="flag" aria-hidden="true">${flag(match.homeTeam)}</span>
          </span>
          ${scoreBox}
          <span class="result-team">
            <span class="flag" aria-hidden="true">${flag(match.awayTeam)}</span>
            <span class="nm">${escapeHtml(match.awayTeam)}</span>
          </span>
        </div>
      `;
    })
    .join("");

  const checkedAt = state.data.tournament.lastResultsCheckedAt;
  document.querySelector("#results-note").textContent = checkedAt
    ? `Resultados conferidos em ${formatDate.format(new Date(checkedAt))}.`
    : "Os resultados são conferidos manualmente antes de cada atualização.";

  document.querySelector("#actual-groups").innerHTML = Object.entries(state.data.tournament.groups)
    .map(([group, actual]) => {
      return `
        <div class="group-card">
          <div class="group-title"><span class="gt-name">Grupo ${escapeHtml(group)}</span></div>
          ${teamLine("1", actual.first)}
          ${teamLine("2", actual.second)}
        </div>
      `;
    })
    .join("");
}

function renderRules() {
  const { rules } = state.data;
  document.querySelector("#rules-list").innerHTML = [
    ruleCard("🧩", "Classificados dos grupos", `${rules.groupQualified} pts por seleção classificada e +${rules.groupExactPositionBonus} pt se acertar a posição exata (1º ou 2º). Até 6 pts por grupo.`),
    ruleCard("🏆", "Campeão", `${rules.champion} pts para quem cravar o campeão da Copa.`),
    ruleCard("🥈", "Vice-campeão", `${rules.runnerUp} pts para quem acertar o vice-campeão.`),
    ruleCard("⚽", "Jogos (Brasil e mata-mata)", `${rules.matchOutcome} pts pelo resultado (vitória ou empate) e +${rules.exactScoreBonus} pts pelo placar exato. Máximo de ${rules.matchMax} pts por jogo.`),
  ].join("");

  document.querySelector("#tiebreak-list").innerHTML = rules.tiebreakers
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function ruleCard(emoji, label, value) {
  return `
    <div class="rule-card">
      <span class="rc-emoji" aria-hidden="true">${emoji}</span>
      <span>
        <span class="rc-title">${escapeHtml(label)}</span>
        <span class="rc-desc">${escapeHtml(value)}</span>
      </span>
    </div>
  `;
}

function renderAliases() {
  document.querySelector("#alias-list").innerHTML = state.data.aliases.people
    .map((person) => {
      const aliases = person.aliases.filter((alias) => alias !== person.displayName).join(", ");
      return `
        <div class="alias-item">
          <strong>${escapeHtml(person.displayName)}</strong>
          <span>${aliases ? `também aceita: ${escapeHtml(aliases)}` : "sem variações cadastradas"}</span>
        </div>
      `;
    })
    .join("");
}

function renderFooter() {
  const generatedAt = new Date(state.data.meta.generatedAt);
  document.querySelector("#footer-updated").textContent = `Atualizado em ${formatDate.format(generatedAt)}`;
}

function isCompleteScore(score) {
  return Number.isInteger(score?.home) && Number.isInteger(score?.away);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

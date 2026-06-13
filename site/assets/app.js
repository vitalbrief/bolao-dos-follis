const DATA_URL = "data/site-data.json";

const state = {
  data: null,
  activeView: "ranking",
};

const formatDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

init().catch((error) => {
  document.body.innerHTML = `<main class="panel"><h1>Bolão dos Follis</h1><p>Não foi possível carregar os dados.</p><pre>${escapeHtml(error.message)}</pre></main>`;
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
  renderRanking();
  renderParticipantSelect();
  renderParticipantDetail(state.data.participants[0]?.id);
  renderChampionGrid();
  renderResults();
  renderRules();
  renderAliases();
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
    });
  });
}

function renderHeroStats() {
  const { meta, tournament, ranking } = state.data;
  const leaderCount = ranking.filter((row) => row.rank === 1).length;
  const finishedMatches = tournament.matches.filter((match) => isCompleteScore(match.result)).length;
  const generatedAt = new Date(meta.generatedAt);

  document.querySelector("#hero-stats").innerHTML = [
    statCard(meta.participantCount, "participantes"),
    statCard(leaderCount, leaderCount === 1 ? "líder agora" : "empatados na ponta"),
    statCard(finishedMatches, "jogos com resultado"),
    statCard(formatDate.format(generatedAt), "atualizado em"),
  ].join("");
}

function statCard(value, label) {
  return `<div class="stat-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
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
      <strong>Conferir antes de publicar</strong>
      <ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderRanking() {
  const rows = state.data.ranking;
  const hasPoints = rows.some((row) => row.score.total > 0);
  const status = document.querySelector("#ranking-status");
  status.textContent = hasPoints ? "Pontuação em andamento" : "Aguardando resultados";
  status.classList.toggle("is-live", hasPoints);

  document.querySelector("#ranking-body").innerHTML = rows
    .map((row) => {
      const leaderClass = row.rank === 1 ? "leader" : "";
      return `
        <tr class="${leaderClass}">
          <td><span class="rank-badge">${row.rank}</span></td>
          <td><strong>${escapeHtml(row.displayName)}</strong></td>
          <td><span class="total-score">${row.score.total}</span></td>
          <td>${row.score.groupClassificationPoints}</td>
          <td>${row.score.brazilGroupMatchPoints}</td>
          <td>${row.score.knockoutPoints}</td>
          <td>${row.score.championPoints}</td>
          <td>${row.score.runnerUpPoints}</td>
          <td>
            <div class="tiebreakers">
              <span class="score-pill">${row.score.exactKnockoutHits} exatos mata-mata</span>
              <span class="score-pill">${row.score.outcomeHits} resultados</span>
              <span class="score-pill">${row.score.groupPhasePoints} grupos</span>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderParticipantSelect() {
  const select = document.querySelector("#participant-select");
  select.innerHTML = state.data.participants
    .map((participant) => `<option value="${participant.id}">${escapeHtml(participant.displayName)}</option>`)
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

  const groupCards = Object.entries(participant.predictions.groups)
    .map(([group, prediction]) => groupPredictionCard(group, prediction, participant.breakdown.groups[group]))
    .join("");

  const matchCards = state.data.tournament.matches
    .map((match) => matchPredictionCard(match, participant.breakdown.matches[match.id]))
    .join("");

  target.innerHTML = `
    <article class="participant-card">
      <aside class="profile-strip">
        <p class="eyebrow">Participante</p>
        <h2>${escapeHtml(participant.displayName)}</h2>
        <div class="total-score">${participant.score.total}</div>
        <div class="mini-breakdown">
          <div><span>Grupos</span><strong>${participant.score.groupClassificationPoints}</strong></div>
          <div><span>Brasil</span><strong>${participant.score.brazilGroupMatchPoints}</strong></div>
          <div><span>Mata-mata</span><strong>${participant.score.knockoutPoints}</strong></div>
          <div><span>Campeão/Vice</span><strong>${participant.score.championPoints + participant.score.runnerUpPoints}</strong></div>
        </div>
      </aside>
      <div class="prediction-stack">
        <div class="pick-row">
          ${pickCard("Campeão", participant.predictions.champion, participant.breakdown.champion.points)}
          ${pickCard("Vice-campeão", participant.predictions.runnerUp, participant.breakdown.runnerUp.points)}
        </div>
        <div class="match-grid">${matchCards}</div>
        <div class="groups-grid">${groupCards}</div>
      </div>
    </article>
  `;
}

function pickCard(label, team, points) {
  return `
    <div class="pick-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(team ?? "Pendente")}</strong>
      <span>${points} pts</span>
    </div>
  `;
}

function groupPredictionCard(group, prediction, breakdown) {
  const actual = breakdown?.actual;
  const actualText = actual?.first && actual?.second ? `${actual.first}, ${actual.second}` : "Pendente";
  return `
    <div class="group-card">
      <div class="group-title">
        <strong>Grupo ${group}</strong>
        <span class="score-pill">${breakdown?.points ?? 0} pts</span>
      </div>
      ${teamLine("1º", prediction.first)}
      ${teamLine("2º", prediction.second)}
      <span>Resultado: ${escapeHtml(actualText)}</span>
    </div>
  `;
}

function teamLine(position, team) {
  return `
    <div class="team-line">
      <span class="position">${position}</span>
      <strong>${escapeHtml(team ?? "Pendente")}</strong>
    </div>
  `;
}

function matchPredictionCard(match, breakdown) {
  const prediction = breakdown?.prediction ?? { home: null, away: null };
  const result = match.result;
  const resultLabel = isCompleteScore(result) ? `${result.home} x ${result.away}` : "Pendente";
  const predictionLabel = isCompleteScore(prediction) ? `${prediction.home} x ${prediction.away}` : "Pendente";

  return `
    <div class="match-card">
      <span>${escapeHtml(match.homeTeam)} x ${escapeHtml(match.awayTeam)}</span>
      <div class="scoreline">
        <strong>${escapeHtml(predictionLabel)}</strong>
        <span class="score-pill">${breakdown?.points ?? 0} pts</span>
      </div>
      <span>Resultado: ${escapeHtml(resultLabel)}</span>
    </div>
  `;
}

function renderChampionGrid() {
  const target = document.querySelector("#champion-grid");
  target.innerHTML = state.data.participants
    .map((participant) => {
      return `
        <div class="champion-card">
          <div>
            <strong>${escapeHtml(participant.displayName)}</strong>
            <span>Vice: ${escapeHtml(participant.predictions.runnerUp ?? "Pendente")}</span>
          </div>
          <span class="team-pill">${escapeHtml(participant.predictions.champion ?? "Pendente")}</span>
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
      const result = isCompleteScore(match.result) ? `${match.result.home} x ${match.result.away}` : "x";
      const statusText = isCompleteScore(match.result) ? "Finalizado" : "Pendente";
      return `
        <div class="result-row">
          <strong class="team-home">${escapeHtml(match.homeTeam)}</strong>
          <span class="score-box">${escapeHtml(result)}</span>
          <strong>${escapeHtml(match.awayTeam)}</strong>
          <span class="status-pill ${isCompleteScore(match.result) ? "is-live" : ""}">${statusText}</span>
        </div>
      `;
    })
    .join("");

  document.querySelector("#actual-groups").innerHTML = Object.entries(state.data.tournament.groups)
    .map(([group, actual]) => {
      return `
        <div class="group-card">
          <div class="group-title"><strong>Grupo ${group}</strong></div>
          ${teamLine("1º", actual.first ?? "Pendente")}
          ${teamLine("2º", actual.second ?? "Pendente")}
        </div>
      `;
    })
    .join("");
}

function renderRules() {
  const { rules } = state.data;
  document.querySelector("#rules-list").innerHTML = [
    ruleCard("Classificados dos grupos", `${rules.groupQualified} pts por seleção classificada, +${rules.groupExactPositionBonus} pt pela posição exata.`),
    ruleCard("Campeão", `${rules.champion} pts pelo campeão.`),
    ruleCard("Vice-campeão", `${rules.runnerUp} pts pelo vice-campeão.`),
    ruleCard("Jogos", `${rules.matchOutcome} pts pelo resultado e +${rules.exactScoreBonus} pts pelo placar exato.`),
    ruleCard("Desempate", rules.tiebreakers.join(" > ")),
  ].join("");
}

function ruleCard(label, value) {
  return `<div class="rule-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderAliases() {
  document.querySelector("#alias-list").innerHTML = state.data.aliases.people
    .map((person) => {
      const aliases = person.aliases.filter((alias) => alias !== person.displayName).join(", ");
      return `
        <div class="alias-item">
          <span>${escapeHtml(person.id)}</span>
          <strong>${escapeHtml(person.displayName)}</strong>
          <span>${escapeHtml(aliases || "sem alias extra")}</span>
        </div>
      `;
    })
    .join("");
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

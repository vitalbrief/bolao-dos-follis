const DATA_URL = "data/site-data.json";

const state = {
  data: null,
  activeView: "ranking",
  rankingShareBlob: null,
  rankingShareBlobPromise: null,
};

const formatDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

const SHARE_IMAGE = {
  width: 390,
  height: 844,
  scale: 3,
  filename: "classificacao-bolao-dos-follis.png",
};

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
  "Cabo Verde": "🇨🇻",
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
  wireRankingShare();
  renderParticipantSelect();
  renderParticipantDetail(state.data.participants[0]?.id);
  renderChampionBoard();
  renderResults();
  wireMatchModal();
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

  const pointsAtStake = meta.pointsAtStake?.total ?? 0;
  const stakeStat =
    pointsAtStake > 0
      ? statCard(pointsAtStake, "pontos em disputa")
      : statCard(meta.participantCount, "palpiteiros");

  document.querySelector("#hero-stats").innerHTML = [
    stakeStat,
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

function wireRankingShare() {
  const button = document.querySelector("#share-ranking");
  if (!button) {
    return;
  }

  const readyLabel = button.querySelector(".share-button-label")?.textContent ?? "Compartilhar";
  setShareButtonState(button, "Preparando...", true);
  prepareRankingShareImage()
    .then(() => setShareButtonState(button, readyLabel, false))
    .catch((error) => {
      console.warn("Não foi possível preparar a imagem de classificação com antecedência:", error);
      setShareButtonState(button, readyLabel, false);
    });

  button.addEventListener("click", async () => {
    if (button.disabled) {
      return;
    }

    const label = button.querySelector(".share-button-label");
    const originalLabel = label?.textContent ?? "Compartilhar";

    if (state.rankingShareBlob) {
      shareOrDownloadRankingImage(state.rankingShareBlob, button, originalLabel);
      return;
    }

    setShareButtonState(button, "Gerando...", true);
    try {
      const blob = await prepareRankingShareImage({ force: true });
      setShareButtonState(button, originalLabel, false);
      shareOrDownloadRankingImage(blob, button, originalLabel);
    } catch (error) {
      console.error("Erro ao gerar imagem de classificação:", error);
      setShareButtonState(button, originalLabel, false);
      window.alert("Não deu para gerar a imagem da classificação agora. Tente de novo em instantes.");
    }
  });
}

function setShareButtonState(button, text, isBusy) {
  button.disabled = isBusy;
  button.classList.toggle("is-busy", isBusy);
  button.setAttribute("aria-label", text === "Compartilhar" ? "Compartilhar classificação" : text);
  button.title = text === "Compartilhar" ? "Compartilhar classificação" : text;
  const label = button.querySelector(".share-button-label");
  if (label) {
    label.textContent = text;
  }
}

function prepareRankingShareImage(options = {}) {
  const { force = false } = options;
  if (!force && state.rankingShareBlob) {
    return Promise.resolve(state.rankingShareBlob);
  }

  if (!force && state.rankingShareBlobPromise) {
    return state.rankingShareBlobPromise;
  }

  state.rankingShareBlobPromise = createRankingShareBlob()
    .then((blob) => {
      state.rankingShareBlob = blob;
      return blob;
    })
    .catch((error) => {
      state.rankingShareBlobPromise = null;
      throw error;
    });

  return state.rankingShareBlobPromise;
}

function shareOrDownloadRankingImage(blob, button, originalLabel) {
  let file = null;
  try {
    file = new File([blob], SHARE_IMAGE.filename, { type: "image/png" });
  } catch {
    downloadRankingImage(blob, button, originalLabel);
    return;
  }

  const shareData = {
    title: "Classificação do Bolão dos Follis",
    text: "Tabela completa da classificação do Bolão dos Follis.",
    files: [file],
  };

  if (!canShareRankingFile(file) || !navigator.share) {
    downloadRankingImage(blob, button, originalLabel);
    return;
  }

  setShareButtonState(button, "Abrindo...", false);

  let settled = false;
  window.setTimeout(() => {
    if (!settled) {
      setShareButtonState(button, originalLabel, false);
    }
  }, 1200);

  try {
    Promise.resolve(navigator.share(shareData))
      .catch((error) => {
        if (error?.name !== "AbortError") {
          console.error("Erro ao compartilhar imagem de classificação:", error);
          downloadRankingImage(blob, button, originalLabel);
        }
      })
      .finally(() => {
        settled = true;
        setShareButtonState(button, originalLabel, false);
      });
  } catch (error) {
    settled = true;
    if (error?.name !== "AbortError") {
      console.error("Erro ao compartilhar imagem de classificação:", error);
      downloadRankingImage(blob, button, originalLabel);
      return;
    }
    setShareButtonState(button, originalLabel, false);
  }
}

function canShareRankingFile(file) {
  try {
    return navigator.canShare?.({ files: [file] }) ?? false;
  } catch {
    return false;
  }
}

function downloadRankingImage(blob, button, originalLabel) {
  downloadBlob(blob, SHARE_IMAGE.filename);
  setShareButtonState(button, "Baixado", false);
  window.setTimeout(() => setShareButtonState(button, originalLabel, false), 1500);
}

async function createRankingShareBlob() {
  if (document.fonts?.ready) {
    await Promise.race([document.fonts.ready, wait(1200)]).catch(() => {});
  }

  const canvas = document.createElement("canvas");
  canvas.width = SHARE_IMAGE.width * SHARE_IMAGE.scale;
  canvas.height = SHARE_IMAGE.height * SHARE_IMAGE.scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas indisponível");
  }

  ctx.scale(SHARE_IMAGE.scale, SHARE_IMAGE.scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  drawRankingShareImage(ctx);

  const blob = await canvasToPngBlob(canvas);

  if (!blob) {
    throw new Error("Não foi possível exportar o PNG");
  }

  return blob;
}

async function canvasToPngBlob(canvas) {
  if (canvas.toBlob) {
    const blob = await new Promise((resolve) => {
      let done = false;
      const timeout = window.setTimeout(() => {
        done = true;
        resolve(null);
      }, 1800);

      canvas.toBlob((value) => {
        if (done) {
          return;
        }
        done = true;
        window.clearTimeout(timeout);
        resolve(value);
      }, "image/png", 0.95);
    });

    if (blob) {
      return blob;
    }
  }

  return dataUrlToBlob(canvas.toDataURL("image/png", 0.95));
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] ?? "image/png";
  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function drawRankingShareImage(ctx) {
  const rows = state.data.ranking;
  const participantsById = new Map(state.data.participants.map((participant) => [participant.id, participant]));
  const live = hasAnyPoints();
  const generatedAt = new Date(state.data.meta.generatedAt);

  drawShareBackground(ctx);
  drawShareHeader(ctx, rows.length, live, generatedAt);
  drawShareRankingCard(ctx, rows, participantsById, live);
  drawShareFooter(ctx);
}

function drawShareBackground(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, 0, SHARE_IMAGE.height);
  gradient.addColorStop(0, "#052f21");
  gradient.addColorStop(0.55, "#0a4a2e");
  gradient.addColorStop(1, "#0b2c48");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SHARE_IMAGE.width, SHARE_IMAGE.height);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let x = -SHARE_IMAGE.height; x < SHARE_IMAGE.width; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + SHARE_IMAGE.height, SHARE_IMAGE.height);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.rotate(-0.13);
  fillRoundedRect(ctx, -38, 68, 470, 9, 5, "#f6c945");
  fillRoundedRect(ctx, -22, 84, 440, 7, 4, "#1d63bd");
  fillRoundedRect(ctx, -52, 99, 460, 7, 4, "#16a058");
  ctx.restore();

  ctx.save();
  ctx.rotate(-0.16);
  fillRoundedRect(ctx, -26, 772, 470, 18, 9, "rgba(246, 201, 69, 0.95)");
  fillRoundedRect(ctx, -18, 796, 440, 11, 6, "rgba(29, 99, 189, 0.9)");
  ctx.restore();
}

function drawShareHeader(ctx, participantCount, live, generatedAt) {
  ctx.fillStyle = "#ffe8a3";
  ctx.font = "800 9px Inter, Arial, sans-serif";
  drawFittedText(ctx, "COPA DO MUNDO 2026", 18, 26, 170);

  const statusText = live ? "AO VIVO" : "PROVISÓRIO";
  fillRoundedRect(ctx, 278, 13, 94, 24, 12, live ? "rgba(232, 248, 239, 0.95)" : "rgba(255, 255, 255, 0.88)");
  fillRoundedRect(ctx, 289, 22, 7, 7, 4, live ? "#16a058" : "#5e7268");
  ctx.fillStyle = live ? "#064a2e" : "#2c4338";
  ctx.font = "800 8px Inter, Arial, sans-serif";
  drawFittedText(ctx, statusText, 302, 28, 58);

  ctx.fillStyle = "#ffffff";
  ctx.font = "400 34px Anton, Impact, sans-serif";
  drawFittedText(ctx, "Classificação", 18, 64, 250);

  ctx.fillStyle = "#f6c945";
  ctx.font = "400 25px Anton, Impact, sans-serif";
  drawFittedText(ctx, "Bolão dos Follis", 18, 91, 300);

  const updated = formatDate.format(generatedAt).replace(",", " ·");
  ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
  ctx.font = "700 10px Inter, Arial, sans-serif";
  drawFittedText(ctx, `Tabela completa · ${participantCount} participantes`, 18, 112, 220);
  drawFittedText(ctx, `Atualizado em ${updated}`, 18, 126, 250);
}

function drawShareRankingCard(ctx, rows, participantsById, live) {
  const cardX = 14;
  const cardY = 142;
  const cardW = 362;
  const cardH = 656;
  const headerH = 38;
  const rowTop = cardY + headerH + 4;
  const rowH = Math.min(34, (cardH - headerH - 16) / Math.max(rows.length, 1));

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 12;
  fillRoundedRect(ctx, cardX, cardY, cardW, cardH, 18, "#fffef9");
  ctx.restore();

  fillRoundedRect(ctx, cardX, cardY, cardW, headerH, 18, "#f6f3e9");
  ctx.fillStyle = "#5e7268";
  ctx.font = "800 8px Inter, Arial, sans-serif";
  drawFittedText(ctx, "#", cardX + 16, cardY + 24, 26, { align: "center" });
  drawFittedText(ctx, "PARTICIPANTE / APOSTA", cardX + 44, cardY + 24, 190);
  drawFittedText(ctx, "PTS", cardX + cardW - 58, cardY + 24, 42, { align: "right" });

  rows.forEach((row, index) => {
    drawShareRankingRow(ctx, {
      row,
      index,
      rowH,
      y: rowTop + index * rowH,
      cardX,
      cardW,
      participant: participantsById.get(row.id),
      live,
    });
  });
}

function drawShareRankingRow(ctx, { row, index, rowH, y, cardX, cardW, participant, live }) {
  const rowX = cardX + 9;
  const rowW = cardW - 18;
  const accent = shareRankAccent(row.rank, live);
  const bgColor = accent?.soft ?? (index % 2 === 0 ? "#fbf8ee" : "#ffffff");

  fillRoundedRect(ctx, rowX, y + 1.5, rowW, rowH - 3, 10, bgColor);

  if (accent) {
    fillRoundedRect(ctx, rowX, y + 5, 4, rowH - 10, 3, accent.strong);
  }

  const badgeY = y + (rowH - 22) / 2;
  fillRoundedRect(ctx, cardX + 18, badgeY, 27, 22, 8, accent?.badge ?? "#e3eefb");
  ctx.fillStyle = accent?.badgeText ?? "#14488f";
  ctx.font = "900 10px Inter, Arial, sans-serif";
  drawFittedText(ctx, String(row.rank), cardX + 18, badgeY + 14.7, 27, { align: "center" });

  const champ = participant?.predictions?.champion ?? null;
  const nameSize = Math.max(10.1, Math.min(11.4, rowH * 0.34));
  const subSize = Math.max(7.6, Math.min(8.6, rowH * 0.26));

  ctx.fillStyle = "#0e2018";
  ctx.font = `800 ${nameSize}px Inter, Arial, sans-serif`;
  drawFittedText(ctx, row.displayName, cardX + 54, y + rowH * 0.43, 216);

  ctx.fillStyle = "#5e7268";
  ctx.font = `700 ${subSize}px Inter, Arial, sans-serif`;
  drawFittedText(ctx, `${flag(champ)} ${champ ?? "sem palpite"}`, cardX + 54, y + rowH * 0.75, 205);

  ctx.fillStyle = accent?.score ?? "#0a6b3c";
  ctx.font = `400 ${Math.max(17, Math.min(21, rowH * 0.64))}px Anton, Impact, sans-serif`;
  drawFittedText(ctx, String(row.score.total), cardX + cardW - 86, y + rowH * 0.67, 54, { align: "right" });

  ctx.fillStyle = "#5e7268";
  ctx.font = "800 6.8px Inter, Arial, sans-serif";
  drawFittedText(ctx, "pts", cardX + cardW - 28, y + rowH * 0.67, 17);
}

function shareRankAccent(rank, live) {
  if (!live) {
    return null;
  }

  if (rank === 1) {
    return {
      soft: "#fff8df",
      strong: "#d99c12",
      badge: "#f6c945",
      badgeText: "#4a3500",
      score: "#d99c12",
    };
  }

  if (rank === 2) {
    return {
      soft: "#f4f7f9",
      strong: "#b7c2cc",
      badge: "#dde3e8",
      badgeText: "#36424c",
      score: "#52606b",
    };
  }

  if (rank === 3) {
    return {
      soft: "#fff2e8",
      strong: "#c8854a",
      badge: "#e7b187",
      badgeText: "#4a2c12",
      score: "#a86432",
    };
  }

  return null;
}

function drawShareFooter(ctx) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
  ctx.font = "800 9px Inter, Arial, sans-serif";
  drawFittedText(ctx, "bolao-dos-follis.pages.dev", 18, 825, 180);

  ctx.fillStyle = "#ffe8a3";
  ctx.font = "800 9px Inter, Arial, sans-serif";
  drawFittedText(ctx, "Classificação feita para compartilhar", 178, 825, 194, { align: "right" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fillRoundedRect(ctx, x, y, width, height, radius, color) {
  ctx.beginPath();
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawFittedText(ctx, value, x, y, maxWidth, options = {}) {
  const { align = "left" } = options;
  const originalAlign = ctx.textAlign;
  const originalBaseline = ctx.textBaseline;
  const text = fitCanvasText(ctx, value, maxWidth);
  const drawX = align === "right" ? x + maxWidth : align === "center" ? x + maxWidth / 2 : x;

  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, drawX, y);
  ctx.textAlign = originalAlign;
  ctx.textBaseline = originalBaseline;
}

function fitCanvasText(ctx, value, maxWidth) {
  const text = String(value ?? "");
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  const ellipsis = "…";
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${chars.slice(0, mid).join("").trimEnd()}${ellipsis}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return `${chars.slice(0, low).join("").trimEnd()}${ellipsis}`;
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
          <p class="block-label">⚽ Palpites dos jogos</p>
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
  const ignored = Boolean(prediction.ignored);
  const resultLabel = isCompleteScore(result) ? `${result.home} – ${result.away}` : "— – —";
  const predictionLabel = ignored ? "Fora do prazo" : isCompleteScore(prediction) ? `${prediction.home} – ${prediction.away}` : "— – —";
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
        <button type="button" class="result-row ${final ? "is-final" : ""}" data-match-id="${escapeAttr(match.id)}" aria-label="Ver palpites de ${escapeAttr(match.homeTeam)} contra ${escapeAttr(match.awayTeam)}">
          <span class="result-stage">${escapeHtml(match.stageLabel ?? "Jogo")}</span>
          <span class="result-hint" aria-hidden="true">👁️ palpites</span>
          <span class="result-team home">
            <span class="nm">${escapeHtml(match.homeTeam)}</span>
            <span class="flag" aria-hidden="true">${flag(match.homeTeam)}</span>
          </span>
          ${scoreBox}
          <span class="result-team">
            <span class="flag" aria-hidden="true">${flag(match.awayTeam)}</span>
            <span class="nm">${escapeHtml(match.awayTeam)}</span>
          </span>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll("#match-list .result-row").forEach((row) => {
    row.addEventListener("click", () => openMatchModal(row.dataset.matchId));
  });

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

function wireMatchModal() {
  const modal = document.querySelector("#match-modal");
  if (!modal) {
    return;
  }
  modal.querySelectorAll("[data-close]").forEach((element) => {
    element.addEventListener("click", closeMatchModal);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeMatchModal();
    }
  });
}

function openMatchModal(matchId) {
  const match = state.data.tournament.matches.find((item) => item.id === matchId);
  const modal = document.querySelector("#match-modal");
  if (!match || !modal) {
    return;
  }

  const final = isCompleteScore(match.result);
  const scoreText = final ? `${match.result.home} × ${match.result.away}` : "— × —";

  document.querySelector("#match-modal-head").innerHTML = `
    <span class="mm-stage">${escapeHtml(match.stageLabel ?? "Jogo")}</span>
    <div class="mm-fixture" id="match-modal-title">
      <span class="mm-team"><span class="mm-flag" aria-hidden="true">${flag(match.homeTeam)}</span>${escapeHtml(match.homeTeam)}</span>
      <span class="mm-score ${final ? "" : "pending"}">${escapeHtml(scoreText)}</span>
      <span class="mm-team"><span class="mm-flag" aria-hidden="true">${flag(match.awayTeam)}</span>${escapeHtml(match.awayTeam)}</span>
    </div>
  `;

  const rows = state.data.participants
    .map((participant) => {
      const breakdown = participant.breakdown.matches[match.id];
      const prediction = breakdown?.prediction ?? { home: null, away: null };
      const ignored = Boolean(prediction.ignored);
      const hasGuess = isCompleteScore(prediction);
      const guessLabel = ignored
        ? "Fora do prazo"
        : hasGuess
        ? `${prediction.home} × ${prediction.away}`
        : "Sem palpite";
      return {
        displayName: participant.displayName,
        guessLabel,
        guessState: ignored ? "ignored" : hasGuess ? "guess" : "empty",
        points: breakdown?.points ?? 0,
        exactHit: Boolean(breakdown?.exactHit),
        outcomeHit: Boolean(breakdown?.outcomeHit),
      };
    })
    .sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName, "pt-BR"));

  const items = rows
    .map((row) => {
      const tag = row.exactHit
        ? `<span class="mm-tag exact" title="Placar exato">🎯</span>`
        : row.outcomeHit
        ? `<span class="mm-tag outcome" title="Acertou o resultado">✅</span>`
        : "";
      return `
        <li class="mm-pred">
          <span class="mm-name">${escapeHtml(row.displayName)}</span>
          <span class="mm-guess is-${row.guessState}">${escapeHtml(row.guessLabel)}${tag}</span>
          <span class="pts-badge ${row.points > 0 ? "has-pts" : ""}">${row.points} pts</span>
        </li>
      `;
    })
    .join("");

  const hint = final
    ? `${rows.filter((row) => row.points > 0).length} de ${rows.length} pontuaram neste jogo.`
    : "Jogo ainda sem resultado — os pontos aparecem quando o placar for confirmado.";

  document.querySelector("#match-modal-body").innerHTML = `
    <ol class="mm-list">${items}</ol>
    <p class="mm-foot">${escapeHtml(hint)}</p>
  `;

  modal.hidden = false;
  document.body.classList.add("modal-open");
  modal.querySelector(".match-modal-close")?.focus();
}

function closeMatchModal() {
  const modal = document.querySelector("#match-modal");
  if (!modal) {
    return;
  }
  modal.hidden = true;
  document.body.classList.remove("modal-open");
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

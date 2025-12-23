// js/games.js

const RECENT_GROUPS_KEY = "yamican.recentGroups.v1";
const MAX_RECENT_GROUPS = 8;

const PAYMENT_WEIGHTS_VERSION = 1;
const PAYMENT_WEIGHTS_ALPHA = 0.12; // 影響度（大きいほど差が広がる）
const PAYMENT_FACTOR_MIN = 0.7; // 1ゲームでの変動幅（下限）
const PAYMENT_FACTOR_MAX = 1.3; // 1ゲームでの変動幅（上限）
const PAYMENT_WEIGHT_MIN = 0.5; // 累積重みの下限
const PAYMENT_WEIGHT_MAX = 2.0; // 累積重みの上限

function loadRecentGroups() {
  if (!window.localStorage) return [];

  try {
    const raw = window.localStorage.getItem(RECENT_GROUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(item => item && typeof item.gid === "string" && item.gid.trim().length > 0)
      .map(item => ({
        gid: item.gid,
        name: typeof item.name === "string" ? item.name : "グループ",
        lastUsedAt: typeof item.lastUsedAt === "number" ? item.lastUsedAt : 0
      }))
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_RECENT_GROUPS);
  } catch {
    return [];
  }
}

function saveRecentGroups(groups) {
  if (!window.localStorage) return;
  window.localStorage.setItem(RECENT_GROUPS_KEY, JSON.stringify(groups));
}

function upsertRecentGroup({ gid, name }) {
  const now = Date.now();
  const normalizedName = (name || "").trim() || "グループ";

  const current = loadRecentGroups();
  const next = [
    { gid, name: normalizedName, lastUsedAt: now },
    ...current.filter(item => item.gid !== gid)
  ].slice(0, MAX_RECENT_GROUPS);

  saveRecentGroups(next);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyRateBadge(el, rateValue) {
  if (!el) return;
  const rate = typeof rateValue === "number" && Number.isFinite(rateValue) ? rateValue : 1;

  // 1 からの距離に応じて色を強くする（>1 は緑、<1 は赤）
  const diff = rate - 1;
  const intensity = clamp(Math.abs(diff) / 0.8, 0, 1);
  const alpha = 0.12 + 0.42 * intensity;

  if (Math.abs(diff) < 1e-6) {
    el.style.backgroundColor = "rgba(234, 179, 8, 0.22)"; // yellow for neutral
    el.style.borderColor = "rgba(202, 138, 4, 0.45)";
    el.style.color = "#854d0e";
  } else if (diff >= 0) {
    el.style.backgroundColor = `rgba(239, 68, 68, ${alpha})`; // red for higher rates
    el.style.borderColor = `rgba(239, 68, 68, ${0.18 + 0.35 * intensity})`;
    el.style.color = intensity >= 0.55 ? "#7f1d1d" : "#991b1b";
  } else {
    el.style.backgroundColor = `rgba(34, 197, 94, ${alpha})`; // green for lower rates
    el.style.borderColor = `rgba(34, 197, 94, ${0.18 + 0.35 * intensity})`;
    el.style.color = intensity >= 0.55 ? "#052e16" : "#14532d";
  }

  el.classList.add("rate-badge");
}

function resolvePenaltyMultiplier(penaltyValue) {
  if (typeof penaltyValue === "number" && Number.isFinite(penaltyValue)) {
    if (penaltyValue > 0 && penaltyValue < 1) return 1 - penaltyValue;
    if (penaltyValue > 0) return penaltyValue;
  }
  return 1;
}

function signedSqrt(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v === 0) return 0;
  return Math.sign(v) * Math.sqrt(Math.abs(v));
}

function normalizeMeanOne(map) {
  // NOTE: 以前は平均=1に正規化していたが、要望により廃止（互換のため関数は残す）
  return map;
}

function computeNextPaymentWeights({ members, scores, currentWeights }) {
  const raw = members.map((m) => signedSqrt(scores?.[m] ?? 0));
  const mean = raw.length > 0 ? raw.reduce((a, b) => a + b, 0) / raw.length : 0;

  const rawFactors = {};
  members.forEach((m, idx) => {
    const centered = raw[idx] - mean;
    // 高得点ほど支払レートが下がるように符号を反転
    rawFactors[m] = Math.exp(-PAYMENT_WEIGHTS_ALPHA * centered);
  });

  const normalizedFactors = {};
  members.forEach((m) => {
    const base = rawFactors[m] || 1;
    normalizedFactors[m] = clamp(base, PAYMENT_FACTOR_MIN, PAYMENT_FACTOR_MAX);
  });

  const nextWeightsRaw = {};
  members.forEach((m) => {
    const current = typeof currentWeights?.[m] === "number" && Number.isFinite(currentWeights[m]) && currentWeights[m] > 0
      ? currentWeights[m]
      : 1;
    nextWeightsRaw[m] = current * normalizedFactors[m];
  });

  const nextWeights = {};
  members.forEach((m) => {
    nextWeights[m] = clamp(nextWeightsRaw[m] ?? 1, PAYMENT_WEIGHT_MIN, PAYMENT_WEIGHT_MAX);
  });

  return { factors: normalizedFactors, nextWeights };
}

function computeTotalsFromRounds({ members, rounds }) {
  const totals = {};
  members.forEach((m) => (totals[m] = 0));
  if (!Array.isArray(rounds)) return totals;
  rounds.forEach((r) => {
    const scores = r?.scores || {};
    members.forEach((m) => {
      const v = scores[m];
      totals[m] += typeof v === "number" && Number.isFinite(v) ? v : 0;
    });
  });
  return totals;
}

function getGameScoresForMembers({ gameData, members }) {
  if (gameData && gameData.totalScores && typeof gameData.totalScores === "object") {
    return gameData.totalScores;
  }
  if (Array.isArray(gameData?.rounds) && gameData.rounds.length > 0) {
    return computeTotalsFromRounds({ members, rounds: gameData.rounds });
  }
  return gameData?.scores || {};
}

// URLパラメータから gid を取得
function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

document.addEventListener("DOMContentLoaded", async () => {
  const groupId = getGroupIdFromQuery();
  console.log("[games.js] groupId =", groupId);

  // Firestore参照（firebase.js が db または window.db を作っている前提）
  const dbRef =
    (typeof window !== "undefined" && window.db) ||
    (typeof db !== "undefined" ? db : null);

  if (!dbRef) {
    alert("Firestore(db) が見つかりません。js/firebase.js の読み込み順を確認してください。");
    return;
  }

  if (!groupId) {
    alert("グループIDが指定されていません。（URL に ?gid= が付いているか確認してください）");
    return;
  }

  // DOM
  const groupInfoEl = document.getElementById("groupInfo");
  const gamesListEl = document.getElementById("gamesList");
  const addNewGameBtn = document.getElementById("addNewGameBtn");
  const ratingsBody = document.getElementById("ratingsBody");
  const ratingInfo = document.getElementById("ratingInfo");
  const rateLogicLink = document.getElementById("rateLogicLink");

  let members = [];
  let groupName = "無題のイベント";

  function renderPaymentWeights({ paymentWeights, sourceLabel, baseRates = {}, penaltyMultipliers = {} }) {
    if (ratingsBody) {
      ratingsBody.innerHTML = "";
      members.forEach((m) => {
        const tr = document.createElement("tr");
        const tdName = document.createElement("td");
        const tdGameRate = document.createElement("td");
        const tdPenaltyRate = document.createElement("td");
        const tdRate = document.createElement("td");
        tdName.textContent = m;
        const base = typeof baseRates?.[m] === "number" && Number.isFinite(baseRates[m]) ? baseRates[m] : 1;
        const penalty =
          typeof penaltyMultipliers?.[m] === "number" && Number.isFinite(penaltyMultipliers[m])
            ? penaltyMultipliers[m]
            : 1;
        const v = typeof paymentWeights?.[m] === "number" && Number.isFinite(paymentWeights[m]) ? paymentWeights[m] : 1;
        tdGameRate.textContent = base.toFixed(2);
        tdPenaltyRate.textContent = penalty.toFixed(2);
        const badge = document.createElement("span");
        badge.textContent = v.toFixed(2);
        applyRateBadge(badge, v);
        tdRate.appendChild(badge);
        tr.appendChild(tdName);
        tr.appendChild(tdGameRate);
        tr.appendChild(tdPenaltyRate);
        tr.appendChild(tdRate);
        ratingsBody.appendChild(tr);
      });
    }

    if (ratingInfo) {
      ratingInfo.textContent = sourceLabel;
    }
  }

  async function loadPaymentWeightsFromGroup() {
    if (!ratingInfo && !ratingsBody) return;

    try {
      const groupDoc = await dbRef.collection("groups").doc(groupId).get();
      const data = groupDoc.data() || {};
      const baseRates = data.paymentWeights || {};
      const penaltyMultipliers = {};

      try {
        const sosouSnap = await dbRef.collection("groups").doc(groupId).collection("sosou").get();
        sosouSnap.forEach((doc) => {
          const p = doc.data() || {};
          if (p.penaltyType === "rate" && p.member) {
            const mult =
              typeof p.rateMultiplier === "number" && Number.isFinite(p.rateMultiplier)
                ? p.rateMultiplier
                : resolvePenaltyMultiplier(p.penaltyValue);
            if (mult > 0) {
              const current =
                typeof penaltyMultipliers[p.member] === "number" && Number.isFinite(penaltyMultipliers[p.member])
                  ? penaltyMultipliers[p.member]
                  : 1;
              penaltyMultipliers[p.member] = current * mult;
            }
          }
        });
      } catch (err) {
        console.warn("[games.js] penalty load error", err);
      }

      const paymentWeights = {};
      members.forEach((m) => {
        const base = typeof baseRates[m] === "number" && Number.isFinite(baseRates[m]) ? baseRates[m] : 1;
        const penalty =
          typeof penaltyMultipliers[m] === "number" && Number.isFinite(penaltyMultipliers[m])
            ? penaltyMultipliers[m]
            : 1;
        paymentWeights[m] = base * penalty;
        penaltyMultipliers[m] = penalty; // normalize fallback
      });
      const sourceName = data.paymentWeightsSourceGameName || "";
      const sourceLabel = sourceName ? `最後に反映したゲーム: ${sourceName}` : "まだ確定済みゲームがありません";
      renderPaymentWeights({ paymentWeights, sourceLabel, baseRates, penaltyMultipliers });
    } catch (err) {
      console.warn("[games.js] payment weights load error", err);
      renderPaymentWeights({
        paymentWeights: {},
        baseRates: {},
        penaltyMultipliers: {},
        sourceLabel: "支払いレートを取得できませんでした",
      });
    }
  }

  // ===== グループ情報の取得 =====
  try {
    const doc = await dbRef.collection("groups").doc(groupId).get();
    console.log("[games.js] group doc exists =", doc.exists);

    if (!doc.exists) {
      groupInfoEl.textContent = "グループが見つかりませんでした。";
      return;
    }

    const data = doc.data();
    console.log("[games.js] group data =", data);

    members = data.members || [];
    groupName = data.name || "無題のイベント";
    groupInfoEl.textContent = `グループ：${groupName}（メンバー：${members.join("、")}）`;
    upsertRecentGroup({ gid: groupId, name: groupName });

    await loadPaymentWeightsFromGroup();
    console.log("[games.js] members loaded:", members);
  } catch (err) {
    console.error("[games.js] グループ情報取得エラー", err);
    groupInfoEl.textContent = "グループ情報の取得に失敗しました。";
    return;
  }

  // ===== 過去のゲーム結果一覧 =====
  dbRef
    .collection("groups")
    .doc(groupId)
    .collection("games")
    .orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      console.log("[games.js] onSnapshot called, snap.empty:", snap.empty);
      gamesListEl.innerHTML = "";

      if (snap.empty) {
        const p = document.createElement("p");
        p.className = "helper";
        p.textContent = "まだゲーム結果がありません。";
        gamesListEl.appendChild(p);
        return;
      }

      snap.forEach((gameDoc) => {
        const d = gameDoc.data() || {};
        const gameName = d.name || "名前なしゲーム";
        const memo = d.memo || "";
        const scores = getGameScoresForMembers({ gameData: d, members });
        const storedRatingFactors = d.ratingFactors || {};
        const computedRatingFactors = !d.ratingConfirmed
          ? computeNextPaymentWeights({
              members,
              scores,
              currentWeights: {},
            }).factors
          : null;

        let dateText = "日時未記録";
        if (d.createdAt && d.createdAt.toDate) {
          const t = d.createdAt.toDate();
          const yyyy = t.getFullYear();
          const mm = String(t.getMonth() + 1).padStart(2, "0");
          const dd = String(t.getDate()).padStart(2, "0");
          const hh = String(t.getHours()).padStart(2, "0");
          const mi = String(t.getMinutes()).padStart(2, "0");
          dateText = `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
        }

        const card = document.createElement("div");
        card.className = "game-card";
        const isLocked = Boolean(d.ratingConfirmed);
        if (isLocked) {
          card.style.backgroundColor = "#f3f4f6";
          card.style.borderColor = "#cbd5e1";
        }

        const header = document.createElement("div");
        header.className = "game-card-header";

        const titleEl = document.createElement("div");
        titleEl.className = "game-card-title";
        titleEl.textContent = gameName;

        const dateEl = document.createElement("div");
        dateEl.className = "game-card-date";
        dateEl.textContent = dateText;

        const headerRight = document.createElement("div");
        headerRight.style.display = "flex";
        headerRight.style.alignItems = "center";
        headerRight.style.gap = "8px";

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.textContent = d.ratingConfirmed ? "確定済み" : "結果確定";
        confirmBtn.style.backgroundColor = "#2563eb";
        confirmBtn.style.borderColor = "#2563eb";
        confirmBtn.style.color = "#fff";
        confirmBtn.disabled = Boolean(d.ratingConfirmed);
        confirmBtn.addEventListener("click", async () => {
          confirmBtn.disabled = true;
          try {
            await confirmGameResult(gameDoc.id);
            confirmBtn.textContent = "確定済み";
          } catch (err) {
            console.error("[games.js] 結果確定エラー", err);
            alert("結果の確定に失敗しました。時間をおいて再度お試しください。");
            confirmBtn.disabled = false;
          }
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.textContent = "削除";
        deleteBtn.className = "secondary";
        deleteBtn.addEventListener("click", async () => {
          const ok = window.confirm("このゲーム結果を削除しますか？");
          if (!ok) return;
          try {
            await dbRef
              .collection("groups")
              .doc(groupId)
              .collection("games")
              .doc(gameDoc.id)
              .delete();
          } catch (err) {
            console.error("[games.js] ゲーム削除エラー", err);
            alert("削除に失敗しました。時間をおいて再度お試しください。");
          }
        });

        headerRight.appendChild(dateEl);
        headerRight.appendChild(confirmBtn);
        if (!isLocked) {
          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.textContent = "編集";
          editBtn.className = "secondary";
          editBtn.addEventListener("click", () => {
            window.location.href = `addgame.html?gid=${groupId}&gameId=${gameDoc.id}`;
          });
          headerRight.appendChild(editBtn);
        }
        headerRight.appendChild(deleteBtn);

        header.appendChild(titleEl);
        header.appendChild(headerRight);
        card.appendChild(header);

        if (memo) {
          const memoEl = document.createElement("div");
          memoEl.className = "game-card-memo";
          memoEl.textContent = memo;
          card.appendChild(memoEl);
        }

        const table = document.createElement("table");
        table.className = "game-card-table";

        const thead = document.createElement("thead");
        const trHead = document.createElement("tr");
        const thMember = document.createElement("th");
        thMember.textContent = "メンバー";
        const thScore = document.createElement("th");
        thScore.textContent = "ポイント";
        const thFactor = document.createElement("th");
        thFactor.textContent = "レート";
        trHead.appendChild(thMember);
        trHead.appendChild(thScore);
        trHead.appendChild(thFactor);
        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const names = members.length > 0 ? members : Object.keys(scores);

        names.forEach((name) => {
          const tr = document.createElement("tr");
          const tdName = document.createElement("td");
          const tdScore = document.createElement("td");
          const tdFactor = document.createElement("td");
          tdName.textContent = name;
          const scoreValue = scores[name];
          tdScore.textContent =
            typeof scoreValue === "number" && Number.isFinite(scoreValue) ? String(scoreValue) : "0";

          const factorValue = d.ratingConfirmed
            ? storedRatingFactors?.[name]
            : computedRatingFactors?.[name];
          const isNumber = typeof factorValue === "number" && Number.isFinite(factorValue);
          if (isNumber) {
            const badge = document.createElement("span");
            badge.textContent = factorValue.toFixed(2);
            applyRateBadge(badge, factorValue);
            tdFactor.appendChild(badge);
          } else {
            tdFactor.textContent = "—";
          }
          tr.appendChild(tdName);
          tr.appendChild(tdScore);
          tr.appendChild(tdFactor);
          tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        card.appendChild(table);
        gamesListEl.appendChild(card);
      });
    });

  // ===== 新しいゲームを追加ボタン =====
  addNewGameBtn?.addEventListener("click", () => {
    window.location.href = `addgame.html?gid=${groupId}`;
  });

  // ===== ハンバーガーメニュー制御 =====
  const menuButton = document.getElementById("menuButton");
  const sideMenu = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");

  const navToGroup = document.getElementById("navToGroup");
  const navToGame = document.getElementById("navToGame");
  const navToSosou = document.getElementById("navToSosou");
  const navToSettle = document.getElementById("navToSettle");
  const navToManage = document.getElementById("navToManage");

  function openMenu() {
    sideMenu?.classList.add("open");
  }

  function closeMenu() {
    sideMenu?.classList.remove("open");
  }

  menuButton?.addEventListener("click", openMenu);
  closeMenuButton?.addEventListener("click", closeMenu);
  sideMenuOverlay?.addEventListener("click", closeMenu);

  navToGroup?.addEventListener("click", () => {
    window.location.href = `group.html?gid=${groupId}`;
  });

  navToGame?.addEventListener("click", closeMenu);

  navToSosou?.addEventListener("click", () => {
    window.location.href = `sosou.html?gid=${groupId}`;
  });

  navToSettle?.addEventListener("click", () => {
    window.location.href = `settlement.html?gid=${groupId}`;
  });

  navToManage?.addEventListener("click", () => {
    window.location.href = `manage.html?gid=${groupId}`;
  });

  // レートロジックページへのリンクに gid を引き継ぐ
  if (rateLogicLink && groupId) {
    const url = new URL(rateLogicLink.href, window.location.href);
    url.searchParams.set("gid", groupId);
    rateLogicLink.href = url.toString();
  }

  // ===== 結果確定処理 =====
  async function confirmGameResult(docId) {
    const groupRef = dbRef.collection("groups").doc(groupId);
    const gameRef = groupRef.collection("games").doc(docId);

    await dbRef.runTransaction(async (tx) => {
      const [groupSnap, gameSnap] = await Promise.all([tx.get(groupRef), tx.get(gameRef)]);

      if (!gameSnap.exists) {
        throw new Error("game not found");
      }

      const gameData = gameSnap.data() || {};
      if (gameData.ratingConfirmed) {
        return;
      }

      const groupData = groupSnap.data() || {};
      const currentWeights = groupData.paymentWeights || {};
      const memberList = Array.isArray(groupData.members) && groupData.members.length > 0
        ? groupData.members
        : Object.keys(gameData.scores || {});

      const scoreMap = getGameScoresForMembers({ gameData, members: memberList });

      const { factors, nextWeights } = computeNextPaymentWeights({
        members: memberList,
        scores: scoreMap,
        currentWeights
      });

      tx.set(
        groupRef,
        {
          paymentWeights: nextWeights,
          paymentWeightsVersion: PAYMENT_WEIGHTS_VERSION,
          paymentWeightsUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          paymentWeightsSourceGameId: docId,
          paymentWeightsSourceGameName: gameData.name || null,
        },
        { merge: true }
      );

      tx.set(
        gameRef,
        {
          ratingConfirmed: true,
          ratingAppliedAt: firebase.firestore.FieldValue.serverTimestamp(),
          ratingMethod: "signed-sqrt-exp-normalize-cap-v1",
          ratingFactors: factors,
          ratingWeightsApplied: nextWeights,
        },
        { merge: true }
      );
    });

    await loadPaymentWeightsFromGroup();
  }
});

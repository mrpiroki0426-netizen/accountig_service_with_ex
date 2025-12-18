// js/addgame.js

const RECENT_GROUPS_KEY = "yamican.recentGroups.v1";
const MAX_RECENT_GROUPS = 8;

function loadRecentGroups() {
  if (!window.localStorage) return [];

  try {
    const raw = window.localStorage.getItem(RECENT_GROUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => item && typeof item.gid === "string" && item.gid.trim().length > 0)
      .map((item) => ({
        gid: item.gid,
        name: typeof item.name === "string" ? item.name : "グループ",
        lastUsedAt: typeof item.lastUsedAt === "number" ? item.lastUsedAt : 0,
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
  const next = [{ gid, name: normalizedName, lastUsedAt: now }, ...current.filter((i) => i.gid !== gid)]
    .slice(0, MAX_RECENT_GROUPS);

  saveRecentGroups(next);
}

// URLパラメータから gid を取得
function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

// URLパラメータから gameId を取得（編集モードに使用）
function getGameIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gameId");
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildStableMemberOrder({ groupMembers, scoreMembers, removedMembers }) {
  const removed = removedMembers || new Set();
  const fromScores = Array.isArray(scoreMembers) ? scoreMembers : [];
  const fromGroup = Array.isArray(groupMembers) ? groupMembers : [];

  const scoreSet = new Set(fromScores.filter((m) => typeof m === "string"));
  const ordered = [];

  // まずはグループに登録されている順を優先
  fromGroup.forEach((m) => {
    if (typeof m !== "string") return;
    if (removed.has(m)) return;
    if (!scoreSet.has(m) && fromScores.length > 0) return;
    ordered.push(m);
  });

  // グループ外メンバー（古いゲームなど）を末尾に追加
  fromScores.forEach((m) => {
    if (typeof m !== "string") return;
    if (removed.has(m)) return;
    if (ordered.includes(m)) return;
    ordered.push(m);
  });

  return ordered;
}

// デフォルトのゲーム名を生成（YYYY/MM/DD HH:mm ゲーム）
function buildDefaultGameName() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi} ゲーム`;
}

function createEmptyRound(members) {
  const scores = {};
  (members || []).forEach((m) => {
    scores[m] = 0;
  });
  return { scores };
}

document.addEventListener("DOMContentLoaded", async () => {
  const groupId = getGroupIdFromQuery();
  const gameId = getGameIdFromQuery();
  const isEditMode = Boolean(gameId);
  console.log("[addgame.js] groupId =", groupId);
  console.log("[addgame.js] gameId =", gameId, "isEditMode:", isEditMode);

  // Firestore参照（firebase.js が db または window.db を作っている前提）
  const dbRef = (typeof window !== "undefined" && window.db) || (typeof db !== "undefined" ? db : null);

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
  const gameNameInput = document.getElementById("gameName");
  const gameMemoInput = document.getElementById("gameMemo"); // 無いページもあるので後でnullチェック
  const saveGameBtn = document.getElementById("saveGameBtn");
  const gameErrorEl = document.getElementById("gameError");
  const gameSuccessEl = document.getElementById("gameSuccess");
  const shareUrlInput = document.getElementById("shareUrl");
  const copyShareUrlBtn = document.getElementById("copyShareUrlBtn");
  const shareUrlMessage = document.getElementById("shareUrlMessage");
  const addRoundBtn = document.getElementById("addRoundBtn");
  const roundsContainerEl = document.getElementById("roundsContainer");
  const totalScoresInfoEl = document.getElementById("totalScoresInfo");

  // サイドメニュー（存在する場合だけ使う）
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
  navToGame?.addEventListener("click", () => {
    closeMenu();
  });
  navToSosou?.addEventListener("click", () => {
    window.location.href = `sosou.html?gid=${groupId}`;
  });
  navToSettle?.addEventListener("click", () => {
    window.location.href = `settlement.html?gid=${groupId}`;
  });
  navToManage?.addEventListener("click", () => {
    window.location.href = `manage.html?gid=${groupId}`;
  });

  // データ保持
  let members = [];
  let isLocked = false;
  let groupMembers = [];
  let currentGameCreatedAt = null;
  const removedMembers = new Set();
  let rounds = []; // [{ scores: {member:number} }]

  const groupDocRef = dbRef.collection("groups").doc(groupId);
  const liveGameDocRef = groupDocRef.collection("liveGame").doc("current");
  const gameDocRef = isEditMode ? groupDocRef.collection("games").doc(gameId) : null;
  const scoreTargetRef = isEditMode ? gameDocRef : liveGameDocRef;

  let unsubscribeLiveGame = null;
  let unsubscribeGameDoc = null;

  function applyLockState() {
    const disabled = isLocked;
    [gameNameInput, gameMemoInput, saveGameBtn, addRoundBtn].forEach((el) => {
      if (el) el.disabled = disabled;
    });
    if (gameErrorEl) {
      gameErrorEl.textContent = disabled ? "結果確定済みのため編集できません。" : "";
    }
  }

  function ensureRoundsInitialized() {
    if (!Array.isArray(rounds) || rounds.length === 0) {
      rounds = [createEmptyRound(members)];
    }
    rounds = rounds.map((r) => ({ scores: { ...(r?.scores || {}) } }));
  }

  function syncRoundsWithMembers() {
    ensureRoundsInitialized();

    const memberSet = new Set(members);
    rounds = rounds.map((r) => {
      const scores = { ...(r.scores || {}) };

      // 追加されたメンバーは 0 で補完
      members.forEach((m) => {
        if (removedMembers.has(m)) return;
        scores[m] = toFiniteNumber(scores[m], 0);
      });

      // 対象外メンバーは削除
      Object.keys(scores).forEach((m) => {
        if (!memberSet.has(m) || removedMembers.has(m)) {
          delete scores[m];
        }
      });

      return { ...r, scores };
    });
  }

  function computeTotalScores() {
    const totals = {};
    members.forEach((m) => (totals[m] = 0));
    rounds.forEach((r) => {
      const s = r?.scores || {};
      members.forEach((m) => {
        totals[m] += toFiniteNumber(s[m], 0);
      });
    });
    return totals;
  }

  function renderTotals() {
    if (!totalScoresInfoEl) return;
    if (!members || members.length === 0) {
      totalScoresInfoEl.textContent = "";
      return;
    }
    const totals = computeTotalScores();
    const parts = members.map((m) => `${m}: ${totals[m]}`);
    totalScoresInfoEl.textContent = `合計ポイント（全ラウンド）: ${parts.join(" / ")}`;
  }

  let pushTimer = null;
  function schedulePushLiveState() {
    if (!scoreTargetRef) return;
    if (pushTimer) window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => {
      pushLiveStateToFirestore();
    }, 150);
  }

  async function pushLiveStateToFirestore() {
    if (!scoreTargetRef) return;
    syncRoundsWithMembers();
    try {
      const totals = computeTotalScores();
      const payload = {
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        rounds,
        // 互換: 旧実装向けフィールド（切替UIは廃止）
        currentRoundIndex: 0,
        totalScores: totals,
        scores: totals,
      };
      await scoreTargetRef.set(payload, { merge: true });
    } catch (err) {
      console.error("[addgame.js] live スコア更新エラー", err);
    }
  }

  function removeMember(name) {
    if (isLocked) return;
    const ok = window.confirm(`「${name}」をこのゲームの記録対象から外しますか？`);
    if (!ok) return;
    removedMembers.add(name);
    members = members.filter((m) => m !== name);
    rounds = rounds.map((r) => {
      const nextScores = { ...(r.scores || {}) };
      delete nextScores[name];
      return { ...r, scores: nextScores };
    });
    renderRounds();
    schedulePushLiveState();
  }

  function setRoundScore(roundIndex, member, value) {
    if (isLocked) return;
    ensureRoundsInitialized();
    if (!rounds[roundIndex]) return;
    rounds[roundIndex].scores = { ...(rounds[roundIndex].scores || {}) };
    rounds[roundIndex].scores[member] = toFiniteNumber(value, 0);
    renderTotals();
    schedulePushLiveState();
  }

  function changeRoundScore(roundIndex, member, delta) {
    if (isLocked) return;
    ensureRoundsInitialized();
    if (!rounds[roundIndex]) return;
    const current = toFiniteNumber(rounds[roundIndex]?.scores?.[member], 0);
    setRoundScore(roundIndex, member, current + delta);
  }

  function deleteRound(roundIndex) {
    if (isLocked) return;
    ensureRoundsInitialized();
    if (rounds.length <= 1) return;
    if (roundIndex < 0 || roundIndex >= rounds.length) return;
    const ok = window.confirm(`第${roundIndex + 1}ラウンドを削除しますか？`);
    if (!ok) return;
    rounds.splice(roundIndex, 1);
    syncRoundsWithMembers();
    renderRounds();
    schedulePushLiveState();
  }

  function addRound() {
    if (isLocked) return;
    ensureRoundsInitialized();
    rounds.push(createEmptyRound(members));
    renderRounds();
    schedulePushLiveState();
  }

  addRoundBtn?.addEventListener("click", addRound);

  function renderRounds() {
    if (!roundsContainerEl) return;
    syncRoundsWithMembers();
    roundsContainerEl.innerHTML = "";

    if (!members || members.length === 0) {
      const empty = document.createElement("p");
      empty.className = "helper";
      empty.textContent = "メンバーが登録されていません。";
      roundsContainerEl.appendChild(empty);
      renderTotals();
      return;
    }

    rounds.forEach((round, roundIndex) => {
      const card = document.createElement("section");
      card.className = "round-card";

      const header = document.createElement("div");
      header.className = "round-card-header";

      const title = document.createElement("div");
      title.className = "round-card-title";
      title.textContent = `第${roundIndex + 1}ラウンド`;

      const actions = document.createElement("div");
      actions.className = "round-card-actions";

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "secondary";
      deleteBtn.textContent = "ラウンド削除";
      deleteBtn.disabled = isLocked || rounds.length <= 1;
      deleteBtn.addEventListener("click", () => deleteRound(roundIndex));
      actions.appendChild(deleteBtn);

      header.appendChild(title);
      header.appendChild(actions);
      card.appendChild(header);

      const table = document.createElement("table");
      table.className = "round-table";

      const thead = document.createElement("thead");
      const trHead = document.createElement("tr");
      const thMember = document.createElement("th");
      thMember.textContent = "メンバー";
      const thScore = document.createElement("th");
      thScore.textContent = "ポイント";
      trHead.appendChild(thMember);
      trHead.appendChild(thScore);
      thead.appendChild(trHead);

      const tbody = document.createElement("tbody");
      members.forEach((m) => {
        const score = toFiniteNumber(round?.scores?.[m], 0);

        const tr = document.createElement("tr");

        const tdName = document.createElement("td");
        const nameWrap = document.createElement("div");
        nameWrap.className = "round-member";

        const nameSpan = document.createElement("span");
        nameSpan.textContent = m;

        const delMemberBtn = document.createElement("button");
        delMemberBtn.type = "button";
        delMemberBtn.className = "score-btn score-btn-minus score-btn-remove-member";
        delMemberBtn.textContent = "－";
        delMemberBtn.disabled = isLocked;
        delMemberBtn.addEventListener("click", () => removeMember(m));

        nameWrap.appendChild(nameSpan);
        nameWrap.appendChild(delMemberBtn);
        tdName.appendChild(nameWrap);

        const tdScore = document.createElement("td");

        const controls = document.createElement("div");
        controls.className = "score-controls";

        const minusBtn = document.createElement("button");
        minusBtn.type = "button";
        minusBtn.className = "score-btn score-btn-minus";
        minusBtn.textContent = "－";
        minusBtn.disabled = isLocked;

        const input = document.createElement("input");
        input.type = "number";
        input.className = "score-input";
        input.value = String(score);
        input.disabled = isLocked;

        const plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.className = "score-btn score-btn-plus";
        plusBtn.textContent = "+";
        plusBtn.disabled = isLocked;

        minusBtn.addEventListener("click", () => changeRoundScore(roundIndex, m, -1));
        plusBtn.addEventListener("click", () => changeRoundScore(roundIndex, m, +1));

        input.addEventListener("change", () => {
          setRoundScore(roundIndex, m, input.value);
        });

        controls.appendChild(minusBtn);
        controls.appendChild(input);
        controls.appendChild(plusBtn);
        tdScore.appendChild(controls);

        tr.appendChild(tdName);
        tr.appendChild(tdScore);
        tbody.appendChild(tr);
      });

      table.appendChild(thead);
      table.appendChild(tbody);
      card.appendChild(table);
      roundsContainerEl.appendChild(card);
    });

    renderTotals();
  }

  function resetLiveScores() {
    rounds = [createEmptyRound(members)];
    renderRounds();
    schedulePushLiveState();
  }

  // 進行中ゲームのリアルタイム購読（新規作成時のみ）
  function subscribeLiveGame() {
    if (unsubscribeLiveGame || isEditMode) return;
    unsubscribeLiveGame = liveGameDocRef.onSnapshot((snapshot) => {
      if (!snapshot.exists) {
        resetLiveScores();
        return;
      }
      const snapData = snapshot.data() || {};

      if (Array.isArray(snapData.rounds) && snapData.rounds.length > 0) {
        rounds = snapData.rounds.map((r) => ({ scores: { ...(r?.scores || {}) } }));
      } else {
        // 互換: 旧形式（scoresのみ）
        const scoresFromDb = snapData.scores || {};
        rounds = [{ scores: { ...scoresFromDb } }];
      }
      renderRounds();
    });
  }

  // 過去ゲームのリアルタイム購読（編集モードのみ）
  function subscribeGameDoc() {
    if (!isEditMode || unsubscribeGameDoc) return;
    unsubscribeGameDoc = gameDocRef.onSnapshot((snapshot) => {
      if (!snapshot.exists) {
        gameErrorEl && (gameErrorEl.textContent = "対象のゲームが見つかりません。");
        return;
      }
      const data = snapshot.data() || {};

      isLocked = Boolean(data.ratingConfirmed);
      currentGameCreatedAt = data.createdAt || null;

      const scoresFromDb = data.scores || {};
      let scoreMembers = Object.keys(scoresFromDb);
      if (scoreMembers.length === 0) {
        scoreMembers = groupMembers;
      }
      members = buildStableMemberOrder({
        groupMembers,
        scoreMembers,
        removedMembers,
      });

      if (Array.isArray(data.rounds) && data.rounds.length > 0) {
        rounds = data.rounds.map((r) => ({ scores: { ...(r?.scores || {}) } }));
      } else {
        rounds = [{ scores: { ...scoresFromDb } }];
      }

      if (gameNameInput) gameNameInput.value = data.name || "";
      if (gameMemoInput) gameMemoInput.value = data.memo || "";
      applyLockState();
      renderRounds();
    });
  }

  // ===== グループ情報の取得（リアルタイム購読） =====
  groupDocRef.onSnapshot(
    (doc) => {
      if (!doc.exists) {
        groupInfoEl && (groupInfoEl.textContent = "グループが見つかりませんでした。");
        return;
      }

      const data = doc.data() || {};
      groupMembers = Array.isArray(data.members) ? data.members : [];

      if (!isEditMode || members.length === 0) {
        members = groupMembers.filter((m) => !removedMembers.has(m));
        if (!isEditMode) {
          subscribeLiveGame();
        }
      }

      const groupName = data.name || "無題のイベント";
      groupInfoEl &&
        (groupInfoEl.textContent = `グループ：${groupName}（メンバー：${members.join("、")}）`);
      upsertRecentGroup({ gid: groupId, name: groupName });

      // メンバー変更があった場合に round を補完
      renderRounds();

      if (isEditMode) {
        subscribeGameDoc();
      }
    },
    (err) => {
      console.error("[addgame.js] グループ情報購読エラー", err);
      groupInfoEl && (groupInfoEl.textContent = "グループ情報の取得に失敗しました。");
    }
  );

  // ===== 共有URL（コピー/共有） =====
  if (shareUrlInput) {
    shareUrlInput.value = window.location.href;
  }
  copyShareUrlBtn?.addEventListener("click", async () => {
    if (!shareUrlInput) return;
    shareUrlMessage && (shareUrlMessage.textContent = "");
    const url = shareUrlInput.value;
    const shareData = {
      title: gameNameInput?.value || "ゲーム記録",
      text: "このゲームの記録を共有します。",
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        shareUrlMessage && (shareUrlMessage.textContent = "共有シートを開きました。");
        return;
      } catch (err) {
        console.warn("navigator.share error/cancel", err);
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        shareUrlInput.select();
        document.execCommand("copy");
      }
      shareUrlMessage && (shareUrlMessage.textContent = "共有URLをコピーしました。");
    } catch (err) {
      console.error("share copy error", err);
      shareUrlMessage && (shareUrlMessage.textContent = "コピーに失敗しました。手動でコピーしてください。");
    }
  });

  // ===== 「ゲーム結果を保存」ボタン =====
  saveGameBtn?.addEventListener("click", async () => {
    gameErrorEl && (gameErrorEl.textContent = "");
    gameSuccessEl && (gameSuccessEl.textContent = "");

    let gameName = (gameNameInput?.value || "").trim();
    if (!gameName) gameName = buildDefaultGameName();

    const memo = gameMemoInput ? (gameMemoInput.value || "").trim() : "";

    try {
      syncRoundsWithMembers();
      const totals = computeTotalScores();

      const payload = {
        name: gameName || null,
        memo: memo || "",
        scores: totals, // 互換: 旧実装向け（合計ポイント）
        rounds,
        currentRoundIndex: 0,
        totalScores: totals,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      if (isEditMode && gameDocRef) {
        if (currentGameCreatedAt) payload.createdAt = currentGameCreatedAt;
        await gameDocRef.set(payload, { merge: false });
      } else {
        delete payload.updatedAt;
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();

        await groupDocRef.collection("games").add(payload);

        if (gameNameInput) gameNameInput.value = "";
        if (gameMemoInput) gameMemoInput.value = "";
        resetLiveScores();
      }

      window.location.href = `game.html?gid=${groupId}`;
    } catch (err) {
      console.error("[addgame.js] ゲーム結果保存エラー", err);
      if (gameErrorEl) gameErrorEl.textContent = "ゲーム結果の保存に失敗しました。";
    }
  });
});

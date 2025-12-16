// js/addgame.js

// URLパラメータから gid を取得
function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

// URLパラメータから gameId を取得（編集時に使用）
function getGameIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gameId");
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

document.addEventListener("DOMContentLoaded", async () => {
  const groupId = getGroupIdFromQuery();
  const gameId = getGameIdFromQuery();
  const isEditMode = Boolean(gameId);
  console.log("[addgame.js] groupId =", groupId);
  console.log("[addgame.js] gameId =", gameId, "isEditMode:", isEditMode);

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
  const scoresBody = document.getElementById("scoresBody");
  const gameNameInput = document.getElementById("gameName");
  const gameMemoInput = document.getElementById("gameMemo"); // 無いページもあるので後でnullチェック
  const saveGameBtn = document.getElementById("saveGameBtn");
  const gameErrorEl = document.getElementById("gameError");
  const gameSuccessEl = document.getElementById("gameSuccess");
  const gamesListEl = document.getElementById("gamesList"); // 無いページもある
  const shareUrlInput = document.getElementById("shareUrl");
  const copyShareUrlBtn = document.getElementById("copyShareUrlBtn");
  const shareUrlMessage = document.getElementById("shareUrlMessage");

  // サイドメニュー（存在する場合だけ使う）
  const menuButton = document.getElementById("menuButton");
  const sideMenu = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");
  const navToGroup = document.getElementById("navToGroup");
  const navToGame = document.getElementById("navToGame");
  const navToSettle = document.getElementById("navToSettle");

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
  navToSettle?.addEventListener("click", () => {
    window.location.href = `settlement.html?gid=${groupId}`;
  });

  // データ保持
  let members = [];
  let isLocked = false;
  let groupMembers = [];
  let currentGameCreatedAt = null;
  const removedMembers = new Set();
  let liveScores = {}; // 進行中ゲームのスコア
  const groupDocRef = dbRef.collection("groups").doc(groupId);
  const liveGameDocRef = groupDocRef.collection("liveGame").doc("current");
  const gameDocRef = isEditMode
    ? groupDocRef.collection("games").doc(gameId)
    : null;
  const scoreTargetRef = isEditMode ? gameDocRef : liveGameDocRef;
  let unsubscribeLiveGame = null;
  let unsubscribeGameDoc = null;
  function applyLockState() {
    const disabled = isLocked;
    [gameNameInput, gameMemoInput, saveGameBtn].forEach((el) => {
      if (el) el.disabled = disabled;
    });
    if (gameErrorEl) {
      gameErrorEl.textContent = disabled ? "結果確定済みのため編集できません。" : "";
    }
  }

  function removeMember(name) {
    if (isLocked) return;
    const ok = window.confirm(`「${name}」をこのゲームの記録対象から外しますか？`);
    if (!ok) return;
    removedMembers.add(name);
    members = members.filter((m) => m !== name);
    delete liveScores[name];
    renderScoreTable();
    pushLiveScoresToFirestore();
  }

  // ===== スコアテーブル描画（±ボタン付き） =====
  function renderScoreTable() {
    console.log("[addgame.js] renderScoreTable called, members:", members, "liveScores:", liveScores);
    if (!scoresBody) return;

    scoresBody.innerHTML = "";

    if (!members || members.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "メンバーが登録されていません。";
      tr.appendChild(td);
      scoresBody.appendChild(tr);
      return;
    }

    // ヘッダーを描き直す（削除列を追加）
    const thead = scoresBody.parentElement?.querySelector("thead");
    if (thead && thead.dataset.withDelete !== "true") {
      thead.innerHTML = "";
      const trHead = document.createElement("tr");
      const thMember = document.createElement("th");
      thMember.textContent = "メンバー";
      const thScore = document.createElement("th");
      thScore.textContent = "ポイント";
      const thDelete = document.createElement("th");
      thDelete.textContent = "削除";
      trHead.appendChild(thMember);
      trHead.appendChild(thScore);
      trHead.appendChild(thDelete);
      thead.appendChild(trHead);
      thead.dataset.withDelete = "true";
    }

    members.forEach((m) => {
      const score = typeof liveScores[m] === "number" ? liveScores[m] : 0;

      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      const nameWrap = document.createElement("div");
      nameWrap.style.display = "flex";
      nameWrap.style.alignItems = "center";
      nameWrap.style.gap = "8px";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = m;

      const delBtnInline = document.createElement("button");
      delBtnInline.type = "button";
      delBtnInline.textContent = "－";
      delBtnInline.className = "score-btn score-btn-minus";
      delBtnInline.style.backgroundColor = "#e11d48"; // red
      delBtnInline.style.borderColor = "#e11d48";
      delBtnInline.style.color = "#fff";
      delBtnInline.disabled = isLocked;
      delBtnInline.addEventListener("click", () => removeMember(m));

      nameWrap.appendChild(nameSpan);
      nameWrap.appendChild(delBtnInline);
      tdName.appendChild(nameWrap);

      const tdScore = document.createElement("td");

      // コントロール
      const controls = document.createElement("div");
      controls.className = "score-controls";

      const minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.textContent = "−";
      minusBtn.className = "score-btn score-btn-minus";
      minusBtn.disabled = isLocked;

      const input = document.createElement("input");
      input.type = "number";
      input.className = "score-input";
      input.value = String(score);
      input.setAttribute("data-member", m);
      input.disabled = isLocked;

      const plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.textContent = "+";
      plusBtn.className = "score-btn score-btn-plus";
      plusBtn.disabled = isLocked;

      minusBtn.addEventListener("click", () => changeScore(m, -1));
      plusBtn.addEventListener("click", () => changeScore(m, +1));

      input.addEventListener("change", () => {
        const v = Number(input.value);
        const val = Number.isFinite(v) ? v : 0;
        setScore(m, val);
      });

      controls.appendChild(minusBtn);
      controls.appendChild(input);
      controls.appendChild(plusBtn);

      tdScore.appendChild(controls);
      tr.appendChild(tdName);
      tr.appendChild(tdScore);

      scoresBody.appendChild(tr);
    });
  }

  // ===== Firestoreに liveScores を反映 =====
  async function pushLiveScoresToFirestore() {
    if (!scoreTargetRef) return;
    try {
      // 編集モードでは createdAt や name/memo を壊さないよう merge:true
      const mergeOption = isEditMode ? { merge: true } : { merge: true };
      await scoreTargetRef.set(
        {
          scores: liveScores,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        mergeOption
      );
    } catch (err) {
      console.error("[game.js] live スコア更新エラー", err);
    }
  }

  function setScore(member, value) {
    if (isLocked) return;
    liveScores[member] = value;
    renderScoreTable();
    pushLiveScoresToFirestore();
  }

  function changeScore(member, delta) {
    if (isLocked) return;
    const current = typeof liveScores[member] === "number" ? liveScores[member] : 0;
    liveScores[member] = current + delta;
    renderScoreTable();
    pushLiveScoresToFirestore();
  }

  function resetLiveScores() {
    console.log("[addgame.js] resetLiveScores called");
    liveScores = {};
    members.forEach((m) => (liveScores[m] = 0));
    renderScoreTable();
    pushLiveScoresToFirestore();
  }

  // 進行中ゲームのリアルタイム購読（新規作成時のみ）
  function subscribeLiveGame() {
    if (unsubscribeLiveGame || isEditMode) return;
    unsubscribeLiveGame = liveGameDocRef.onSnapshot((snapshot) => {
      console.log("[addgame.js] liveGame onSnapshot, snapshot.exists:", snapshot.exists);
      if (!snapshot.exists) {
        resetLiveScores();
        return;
      }
      const snapData = snapshot.data() || {};
      const scoresFromDb = snapData.scores || {};
      members.forEach((m) => {
        const v = scoresFromDb[m];
        liveScores[m] = typeof v === "number" ? v : 0;
      });
      renderScoreTable();
    });
  }

  // 過去ゲームのリアルタイム購読（編集モードのみ）
  function subscribeGameDoc() {
    if (!isEditMode || unsubscribeGameDoc) return;
    unsubscribeGameDoc = gameDocRef.onSnapshot((snapshot) => {
      console.log("[addgame.js] gameDoc onSnapshot, snapshot.exists:", snapshot.exists);
      if (!snapshot.exists) {
        gameErrorEl && (gameErrorEl.textContent = "対象のゲームが見つかりません。");
        return;
      }
      const data = snapshot.data() || {};
      isLocked = Boolean(data.ratingConfirmed);
      currentGameCreatedAt = data.createdAt || null;
      const scoresFromDb = data.scores || {};
      // 編集対象ゲームに記録されているメンバーを優先
      let nextMembers = Object.keys(scoresFromDb);
      if (nextMembers.length === 0) {
        nextMembers = groupMembers;
      }
      nextMembers = nextMembers.filter((m) => !removedMembers.has(m));
      members = nextMembers;

      liveScores = {};
      members.forEach((m) => {
        const v = scoresFromDb[m];
        liveScores[m] = typeof v === "number" ? v : 0;
      });
      if (gameNameInput) gameNameInput.value = data.name || "";
      if (gameMemoInput) gameMemoInput.value = data.memo || "";
      applyLockState();
      renderScoreTable();
    });
  }

  // ===== グループ情報の取得（リアルタイム購読に変更） =====
  groupDocRef.onSnapshot(
    (doc) => {
      console.log("[addgame.js] group onSnapshot, exists =", doc.exists);
      if (!doc.exists) {
        groupInfoEl && (groupInfoEl.textContent = "グループが見つかりませんでした。");
        return;
      }

      const data = doc.data() || {};
      groupMembers = Array.isArray(data.members) ? data.members : [];
      if (!isEditMode || members.length === 0) {
        // 新規作成、またはまだゲームドキュメントが未ロードの場合のみ反映
        const nextMembers = groupMembers.filter((m) => !removedMembers.has(m));
        members = nextMembers;
        // 新規作成時は live スコア購読を開始
        if (!isEditMode) {
          subscribeLiveGame();
        }
      }
      const groupName = data.name || "無題のイベント";
      groupInfoEl &&
        (groupInfoEl.textContent = `グループ：${groupName}（メンバー：${members.join("、")}）`);
      renderScoreTable();
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
      shareUrlMessage &&
        (shareUrlMessage.textContent = "コピーに失敗しました。手動でコピーしてください。");
    }
  });

  // ===== 「ゲーム結果を保存」ボタン =====
  saveGameBtn?.addEventListener("click", async () => {
    gameErrorEl && (gameErrorEl.textContent = "");
    gameSuccessEl && (gameSuccessEl.textContent = "");

    // ゲーム名：未入力なら自動命名
    let gameName = (gameNameInput?.value || "").trim();
    if (!gameName) gameName = buildDefaultGameName();

    // メモ：存在する場合だけ
    const memo = gameMemoInput ? (gameMemoInput.value || "").trim() : "";

    // 保存するスコア（members で正規化）
    const scoresToSave = {};
    members.forEach((m) => {
      const v = liveScores[m];
      scoresToSave[m] = typeof v === "number" ? v : 0;
    });

    try {
      if (isEditMode && gameDocRef) {
        const payload = {
          name: gameName || null,
          memo: memo || "",
          scores: scoresToSave,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        if (currentGameCreatedAt) {
          payload.createdAt = currentGameCreatedAt;
        }
        await gameDocRef.set(payload, { merge: false });
      } else {
        await dbRef
          .collection("groups")
          .doc(groupId)
          .collection("games")
          .add({
            name: gameName || null,
            memo: memo || "",
            scores: scoresToSave,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });

        if (gameNameInput) gameNameInput.value = "";
        if (gameMemoInput) gameMemoInput.value = "";
        resetLiveScores();
      }

      // 保存後はゲーム結果一覧へ
      window.location.href = `game.html?gid=${groupId}`;
    } catch (err) {
      console.error("[game.js] ゲーム結果保存エラー", err);
      if (gameErrorEl) gameErrorEl.textContent = "ゲーム結果の保存に失敗しました。";
    }
  });
});

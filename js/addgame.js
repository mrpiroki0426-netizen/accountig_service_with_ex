// js/addgame.js

// URLパラメータから gid を取得
function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
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
  console.log("[addgame.js] groupId =", groupId);

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

  // サイドメニュー（存在する場合だけ使う）
  const menuButton = document.getElementById("menuButton");
  const sideMenu = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");
  const navToGroup = document.getElementById("navToGroup");
  const navToGame = document.getElementById("navToGame");

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

  // データ保持
  let members = [];
  let liveScores = {}; // 進行中ゲームのスコア
  const groupDocRef = dbRef.collection("groups").doc(groupId);
  const liveGameDocRef = groupDocRef.collection("liveGame").doc("current");
  let unsubscribeLiveGame = null;

  // ===== スコアテーブル描画（±ボタン付き） =====
  function renderScoreTable() {
    console.log("[addgame.js] renderScoreTable called, members:", members, "liveScores:", liveScores);
    if (!scoresBody) return;

    scoresBody.innerHTML = "";

    if (!members || members.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.textContent = "メンバーが登録されていません。";
      tr.appendChild(td);
      scoresBody.appendChild(tr);
      return;
    }

    members.forEach((m) => {
      const score = typeof liveScores[m] === "number" ? liveScores[m] : 0;

      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      tdName.textContent = m;

      const tdScore = document.createElement("td");

      // コントロール
      const controls = document.createElement("div");
      controls.className = "score-controls";

      const minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.textContent = "−";
      minusBtn.className = "score-btn score-btn-minus";

      const input = document.createElement("input");
      input.type = "number";
      input.className = "score-input";
      input.value = String(score);
      input.setAttribute("data-member", m);

      const plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.textContent = "+";
      plusBtn.className = "score-btn score-btn-plus";

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
    if (!liveGameDocRef) return;
    try {
      await liveGameDocRef.set(
        {
          scores: liveScores,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.error("[game.js] live スコア更新エラー", err);
    }
  }

  function setScore(member, value) {
    liveScores[member] = value;
    renderScoreTable();
    pushLiveScoresToFirestore();
  }

  function changeScore(member, delta) {
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

  // 進行中ゲームのリアルタイム購読
  function subscribeLiveGame() {
    if (unsubscribeLiveGame) return;
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

  // ===== グループ情報の取得（リアルタイム購読に変更） =====
  groupDocRef.onSnapshot(
    (doc) => {
      console.log("[addgame.js] group onSnapshot, exists =", doc.exists);
      if (!doc.exists) {
        groupInfoEl && (groupInfoEl.textContent = "グループが見つかりませんでした。");
        return;
      }

      const data = doc.data() || {};
      const nextMembers = Array.isArray(data.members) ? data.members : [];
      members = nextMembers;
      const groupName = data.name || "無題のイベント";
      groupInfoEl &&
        (groupInfoEl.textContent = `グループ：${groupName}（メンバー：${members.join("、")}）`);

      // 新しいメンバーが追加されてもスコアに0で載るよう補完
      members.forEach((m) => {
        if (typeof liveScores[m] !== "number") {
          liveScores[m] = 0;
        }
      });

      renderScoreTable();
      subscribeLiveGame();
    },
    (err) => {
      console.error("[addgame.js] グループ情報購読エラー", err);
      groupInfoEl && (groupInfoEl.textContent = "グループ情報の取得に失敗しました。");
    }
  );

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

      // 保存後はゲーム結果画面へ
      window.location.href = `game.html?gid=${groupId}`;
    } catch (err) {
      console.error("[game.js] ゲーム結果保存エラー", err);
      if (gameErrorEl) gameErrorEl.textContent = "ゲーム結果の保存に失敗しました。";
    }
  });
});

// js/game.js

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
  console.log("[game.js] groupId =", groupId);

  if (!groupId) {
    alert("グループIDが指定されていません。（URL に ?gid= が付いているか確認してください）");
    return;
  }

  const groupInfoEl = document.getElementById("groupInfo");
  const scoresBody = document.getElementById("scoresBody");
  const gameNameInput = document.getElementById("gameName");
  const gameMemoInput = document.getElementById("gameMemo");
  const saveGameBtn = document.getElementById("saveGameBtn");
  const gameErrorEl = document.getElementById("gameError");
  const gameSuccessEl = document.getElementById("gameSuccess");

  // 過去ゲーム一覧のDOM
  const gamesListEl = document.getElementById("gamesList");

  let members = [];
  let liveScores = {}; // 進行中ゲームのスコア
  let liveGameDocRef = null;

  // ===== スコアテーブル描画（±ボタン付き） =====
  function renderScoreTable() {
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

    members.forEach(m => {
      const score = typeof liveScores[m] === "number" ? liveScores[m] : 0;

      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      tdName.textContent = m;

      const tdScore = document.createElement("td");
      const controls = document.createElement("div");
      controls.className = "score-controls";

      const minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.textContent = "−";
      minusBtn.className = "score-btn score-btn-minus";

      const input = document.createElement("input");
      input.type = "number";
      input.className = "score-input";
      input.value = score;
      input.setAttribute("data-member", m);

      const plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.textContent = "+";
      plusBtn.className = "score-btn score-btn-plus";

      // イベント
      minusBtn.addEventListener("click", () => {
        changeScore(m, -1);
      });

      plusBtn.addEventListener("click", () => {
        changeScore(m, +1);
      });

      input.addEventListener("change", () => {
        const v = Number(input.value);
        const val = isNaN(v) ? 0 : v;
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

  // Firestoreにスコアを反映
  async function pushLiveScoresToFirestore() {
    if (!liveGameDocRef) return;
    try {
      await liveGameDocRef.set(
        {
          scores: liveScores,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
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
    liveScores = {};
    members.forEach(m => {
      liveScores[m] = 0;
    });
    renderScoreTable();
    pushLiveScoresToFirestore();
  }

  // ===== グループ情報の取得 =====
  try {
    const doc = await db.collection("groups").doc(groupId).get();
    console.log("[game.js] group doc exists =", doc.exists);

    if (!doc.exists) {
      groupInfoEl.textContent = "グループが見つかりませんでした。";
      return;
    }

    const data = doc.data();
    console.log("[game.js] group data =", data);

    members = data.members || [];
    const groupName = data.name || "無題のイベント";
    groupInfoEl.textContent = `グループ：${groupName}（メンバー：${members.join("、")}）`;

    // liveScores 初期化
    members.forEach(m => {
      liveScores[m] = 0;
    });

    // 進行中ゲーム用ドキュメント参照
    liveGameDocRef = db
      .collection("groups")
      .doc(groupId)
      .collection("liveGame")
      .doc("current");

    // 進行中ゲームのリアルタイム購読
    liveGameDocRef.onSnapshot(snapshot => {
      if (!snapshot.exists) {
        // ドキュメントがまだなければ初期化して作成
        resetLiveScores();
        return;
      }

      const data = snapshot.data() || {};
      const scoresFromDb = data.scores || {};

      // Firestore側のデータで上書き（メンバー分だけ見る）
      members.forEach(m => {
        const v = scoresFromDb[m];
        liveScores[m] = typeof v === "number" ? v : 0;
      });

      renderScoreTable();
    });

    // 初回描画
    renderScoreTable();
  } catch (err) {
    console.error("[game.js] グループ情報取得エラー", err);
    groupInfoEl.textContent = "グループ情報の取得に失敗しました。";
    return;
  }

  // ===== 「ゲーム結果を保存」ボタン =====
  saveGameBtn.addEventListener("click", async () => {
    gameErrorEl.textContent = "";
    gameSuccessEl.textContent = "";

    // ゲーム名（null許容）→ 未入力なら自動命名
    let gameName = gameNameInput.value.trim();
    if (!gameName) {
      gameName = buildDefaultGameName();
    }

    const memo = gameMemoInput.value.trim();

    // 現在の liveScores をそのまま保存
    const scoresToSave = { ...liveScores };

    try {
      await db
        .collection("groups")
        .doc(groupId)
        .collection("games")
        .add({
          name: gameName,
          memo: memo || "",
          scores: scoresToSave,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

      // ★ ポップアップを出さずに、そのまま次のゲーム入力へ
      gameSuccessEl.textContent =
        "ゲーム結果を保存しました。次のゲームを入力できます。";

      // 入力欄と進行中スコアをリセット
      gameNameInput.value = "";
      gameMemoInput.value = "";
      resetLiveScores();

      // 画面を先頭付近にスクロール（任意）
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    } catch (err) {
      console.error("[game.js] ゲーム結果保存エラー", err);
      gameErrorEl.textContent =
        "ゲーム結果の保存に失敗しました。時間をおいて再度お試しください。";
    }
  });

  // ===== 過去のゲーム結果をリアルタイム購読 =====
  db.collection("groups")
    .doc(groupId)
    .collection("games")
    .orderBy("createdAt", "desc")
    .onSnapshot(snapshot => {
      gamesListEl.innerHTML = "";

      if (snapshot.empty) {
        const p = document.createElement("p");
        p.className = "helper";
        p.textContent = "まだゲーム結果が登録されていません。";
        gamesListEl.appendChild(p);
        return;
      }

      snapshot.forEach(doc => {
        const data = doc.data();
        const gameName = data.name || "名前なしゲーム";
        const memo = data.memo || "";
        const scores = data.scores || {};
        let dateText = "日時未記録";

        if (data.createdAt && data.createdAt.toDate) {
          const d = data.createdAt.toDate();
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          const hh = String(d.getHours()).padStart(2, "0");
          const mi = String(d.getMinutes()).padStart(2, "0");
          dateText = `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
        }

        const card = document.createElement("div");
        card.className = "game-card";

        const header = document.createElement("div");
        header.className = "game-card-header";

        const titleEl = document.createElement("div");
        titleEl.className = "game-card-title";
        titleEl.textContent = gameName;

        const dateEl = document.createElement("div");
        dateEl.className = "game-card-date";
        dateEl.textContent = dateText;

        header.appendChild(titleEl);
        header.appendChild(dateEl);
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
        trHead.appendChild(thMember);
        trHead.appendChild(thScore);
        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");

        const names = members.length > 0 ? members : Object.keys(scores);
        names.forEach(name => {
          if (!(name in scores)) return;
          const tr = document.createElement("tr");
          const tdName = document.createElement("td");
          const tdScore = document.createElement("td");
          tdName.textContent = name;
          tdScore.textContent = scores[name];
          tr.appendChild(tdName);
          tr.appendChild(tdScore);
          tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        card.appendChild(table);

        gamesListEl.appendChild(card);
      });
    });

  // ===== ハンバーガーメニュー制御 =====
  const menuButton = document.getElementById("menuButton");
  const sideMenu = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");
  const navToGroup = document.getElementById("navToGroup");
  const navToGame = document.getElementById("navToGame");

  function openMenu() {
    if (sideMenu) {
      sideMenu.classList.add("open");
    }
  }

  function closeMenu() {
    if (sideMenu) {
      sideMenu.classList.remove("open");
    }
  }

  if (menuButton) {
    menuButton.addEventListener("click", openMenu);
  }
  if (closeMenuButton) {
    closeMenuButton.addEventListener("click", closeMenu);
  }
  if (sideMenuOverlay) {
    sideMenuOverlay.addEventListener("click", closeMenu);
  }

  if (navToGroup) {
    navToGroup.addEventListener("click", () => {
      window.location.href = `group.html?gid=${groupId}`;
    });
  }

  if (navToGame) {
    navToGame.addEventListener("click", () => {
      // すでにゲーム画面なのでメニューを閉じるだけ
      closeMenu();
    });
  }
});

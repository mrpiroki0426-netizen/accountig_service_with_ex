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

  // ★ 追加：過去ゲーム一覧のDOM
  const gamesListEl = document.getElementById("gamesList");

  let members = [];

  // グループ情報の取得
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

    // メンバーごとのスコア入力行を生成
    renderScoreInputs(members, scoresBody);
  } catch (err) {
    console.error("[game.js] グループ情報取得エラー", err);
    groupInfoEl.textContent = "グループ情報の取得に失敗しました。";
    return;
  }

  // 「ゲーム結果を保存」ボタン
  saveGameBtn.addEventListener("click", async () => {
    gameErrorEl.textContent = "";
    gameSuccessEl.textContent = "";

    // ゲーム名（null許容）→ 未入力なら自動命名
    let gameName = gameNameInput.value.trim();
    if (!gameName) {
      gameName = buildDefaultGameName();
    }

    const memo = gameMemoInput.value.trim();

    // scores オブジェクトを組み立て（未入力は0、NaNも0扱い）
    const scoreInputs = scoresBody.querySelectorAll("input[data-member]");
    const scores = {};
    scoreInputs.forEach(input => {
      const memberName = input.getAttribute("data-member");
      const value = input.value.trim();
      const num = Number(value);
      scores[memberName] = isNaN(num) ? 0 : num;
    });

    try {
      await db
        .collection("groups")
        .doc(groupId)
        .collection("games")
        .add({
          name: gameName,
          memo: memo || "",
          scores,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

      gameSuccessEl.textContent = "ゲーム結果を保存しました。";

      // ★ 保存後は confirm を出さずに即リセットして次の入力へ
      gameSuccessEl.textContent = "ゲーム結果を保存しました。次のゲームを入力できます。";

      gameNameInput.value = "";
      gameMemoInput.value = "";
      resetScoreInputs(scoresBody);

      // 入力位置が下にある場合、自動的に画面をスムーズスクロール
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

  // ★ 追加：過去のゲーム結果をリアルタイム購読
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

        // カードDOMを組み立て
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

        // スコア一覧（テーブル）
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

        // メンバー順で並べたいので、membersをベースに見る
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

// メンバーごとのスコア入力行を生成
function renderScoreInputs(members, tbodyEl) {
  tbodyEl.innerHTML = "";

  if (members.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 2;
    td.textContent = "メンバーが登録されていません。";
    tbodyEl.appendChild(tr);
    tr.appendChild(td);
    return;
  }

  members.forEach(m => {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = m;

    const tdScore = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number";
    input.step = "1";
    input.value = "0"; // 未入力=0扱いのため初期値も0
    input.setAttribute("data-member", m);
    input.style.width = "80px";

    tdScore.appendChild(input);

    tr.appendChild(tdName);
    tr.appendChild(tdScore);
    tbodyEl.appendChild(tr);
  });
}

// スコア入力欄をすべて0にリセット
function resetScoreInputs(tbodyEl) {
  const scoreInputs = tbodyEl.querySelectorAll("input[data-member]");
  scoreInputs.forEach(input => {
    input.value = "0";
  });
}

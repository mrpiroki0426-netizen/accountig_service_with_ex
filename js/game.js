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

      // 保存後の挙動：同じ画面で続けるか、勘定の画面に戻るか選択
      const again = confirm(
        "ゲーム結果を保存しました。\nこのグループで新しいゲームを記録しますか？"
      );

      if (again) {
        // フォームをリセットして、次のゲーム入力へ
        gameNameInput.value = "";
        gameMemoInput.value = "";
        resetScoreInputs(scoresBody);
        gameSuccessEl.textContent = "次のゲームを入力できます。";
      } else {
        // 勘定の画面（group.html）に戻る
        window.location.href = `group.html?gid=${groupId}`;
      }
    } catch (err) {
      console.error("[game.js] ゲーム結果保存エラー", err);
      gameErrorEl.textContent = "ゲーム結果の保存に失敗しました。時間をおいて再度お試しください。";
    }
  });

  // ===== タブ制御 =====
  const tabGroup = document.getElementById("tabGroup");
  const tabGame = document.getElementById("tabGame");

  if (tabGroup && tabGame) {
    // この画面は「ゲーム記録を追加」側なのでこちらをactive
    tabGame.classList.add("active");

    tabGroup.addEventListener("click", () => {
      window.location.href = `group.html?gid=${groupId}`;
    });

    tabGame.addEventListener("click", () => {
      // すでにこの画面なので何もしない
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

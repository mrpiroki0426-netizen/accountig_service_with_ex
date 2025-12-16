// js/games.js

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

  let members = [];

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
    const groupName = data.name || "無題のイベント";
    groupInfoEl.textContent = `グループ：${groupName}（メンバー：${members.join("、")}）`;
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
        const scores = d.scores || {};

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

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.textContent = "編集";
        editBtn.className = "secondary";
        editBtn.addEventListener("click", () => {
          openEditModal(gameDoc.id, d);
        });

        headerRight.appendChild(dateEl);
        headerRight.appendChild(editBtn);

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
        trHead.appendChild(thMember);
        trHead.appendChild(thScore);
        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const names = members.length > 0 ? members : Object.keys(scores);

        names.forEach((name) => {
          if (!(name in scores)) return;
          const tr = document.createElement("tr");
          const tdName = document.createElement("td");
          const tdScore = document.createElement("td");
          tdName.textContent = name;
          tdScore.textContent = String(scores[name]);
          tr.appendChild(tdName);
          tr.appendChild(tdScore);
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

  // ===== 編集モーダル =====
  function openEditModal(docId, gameData) {
    const scores = gameData.scores || {};
    const names = members.length > 0 ? members : Object.keys(scores);

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.45)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "1000";

    const modal = document.createElement("div");
    modal.style.background = "#fff";
    modal.style.padding = "16px";
    modal.style.borderRadius = "8px";
    modal.style.width = "min(520px, 90%)";
    modal.style.boxShadow = "0 10px 30px rgba(0,0,0,0.12)";
    modal.style.maxHeight = "90vh";
    modal.style.overflowY = "auto";

    const title = document.createElement("h3");
    title.textContent = "ゲーム結果を編集";
    modal.appendChild(title);

    const nameGroup = document.createElement("div");
    nameGroup.className = "form-group";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "ゲーム名";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = gameData.name || "";
    nameInput.style.width = "100%";
    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(nameInput);
    modal.appendChild(nameGroup);

    const memoGroup = document.createElement("div");
    memoGroup.className = "form-group";
    const memoLabel = document.createElement("label");
    memoLabel.textContent = "メモ";
    const memoInput = document.createElement("textarea");
    memoInput.value = gameData.memo || "";
    memoInput.rows = 2;
    memoInput.style.width = "100%";
    memoGroup.appendChild(memoLabel);
    memoGroup.appendChild(memoInput);
    modal.appendChild(memoGroup);

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
    names.forEach((name) => {
      const tr = document.createElement("tr");
      const tdName = document.createElement("td");
      tdName.textContent = name;
      const tdScore = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.value = String(typeof scores[name] === "number" ? scores[name] : 0);
      input.style.width = "100%";
      input.setAttribute("data-member", name);
      tdScore.appendChild(input);
      tr.appendChild(tdName);
      tr.appendChild(tdScore);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    modal.appendChild(table);

    const message = document.createElement("p");
    message.className = "helper";
    message.style.marginTop = "8px";
    modal.appendChild(message);

    const actionRow = document.createElement("div");
    actionRow.style.display = "flex";
    actionRow.style.gap = "8px";
    actionRow.style.justifyContent = "flex-end";
    actionRow.style.marginTop = "12px";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "キャンセル";
    cancelBtn.className = "secondary";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "保存";

    actionRow.appendChild(cancelBtn);
    actionRow.appendChild(saveBtn);
    modal.appendChild(actionRow);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function cleanup() {
      overlay.remove();
    }

    cancelBtn.addEventListener("click", cleanup);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup();
    });

    saveBtn.addEventListener("click", async () => {
      message.textContent = "";
      saveBtn.disabled = true;
      cancelBtn.disabled = true;

      const nameVal = nameInput.value.trim();
      const memoVal = memoInput.value.trim();
      const inputs = tbody.querySelectorAll("input[data-member]");
      const newScores = {};
      inputs.forEach((inp) => {
        const mem = inp.getAttribute("data-member");
        const val = Number(inp.value);
        newScores[mem] = Number.isFinite(val) ? val : 0;
      });

      try {
        await dbRef
          .collection("groups")
          .doc(groupId)
          .collection("games")
          .doc(docId)
          .set(
            {
              name: nameVal || null,
              memo: memoVal || "",
              scores: newScores,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        cleanup();
      } catch (err) {
        console.error("[games.js] ゲーム結果更新エラー", err);
        message.textContent = "更新に失敗しました。もう一度お試しください。";
      } finally {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });
  }
});

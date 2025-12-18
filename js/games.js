// js/games.js

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
    upsertRecentGroup({ gid: groupId, name: groupName });
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

  navToGame?.addEventListener("click", closeMenu);

  navToSettle?.addEventListener("click", () => {
    window.location.href = `settlement.html?gid=${groupId}`;
  });

  // ===== 結果確定処理 =====
  async function confirmGameResult(docId) {
    await dbRef
      .collection("groups")
      .doc(groupId)
      .collection("games")
      .doc(docId)
      .set(
        {
          ratingConfirmed: true,
          ratingAppliedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }
});

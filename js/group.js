// js/group.js

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
  const next = [{ gid, name: normalizedName, lastUsedAt: now }, ...current.filter((i) => i.gid !== gid)].slice(
    0,
    MAX_RECENT_GROUPS
  );
  saveRecentGroups(next);
}

function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

document.addEventListener("DOMContentLoaded", async () => {
  const groupId = getGroupIdFromQuery();
  if (!groupId) {
    alert("グループIDが指定されていません。URLに ?gid= が付いているか確認してください。");
    return;
  }

  const groupNameEl = document.getElementById("groupName");
  const membersListEl = document.getElementById("membersList");
  const paidBySelect = document.getElementById("paidBy");
  const targetMembersDiv = document.getElementById("targetMembers");
  const selectAllBtn = document.getElementById("selectAllBtn");
  const expensesBody = document.getElementById("expensesBody");
  const expenseError = document.getElementById("expenseError");
  const goToSettleBtn = document.getElementById("goToSettleBtn");

  const titleInput = document.getElementById("title");
  const amountInput = document.getElementById("amount");
  const addExpenseBtn = document.getElementById("addExpenseBtn");

  const menuButton = document.getElementById("menuButton");
  const sideMenu = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");
  const navToGroup = document.getElementById("navToGroup");
  const navToGame = document.getElementById("navToGame");
  const navToSosou = document.getElementById("navToSosou");
  const navToSettle = document.getElementById("navToSettle");
  const navToManage = document.getElementById("navToManage");

  let members = [];

  // サイドメニュー
  function openMenu() {
    sideMenu?.classList.add("open");
  }
  function closeMenu() {
    sideMenu?.classList.remove("open");
  }
  menuButton?.addEventListener("click", openMenu);
  closeMenuButton?.addEventListener("click", closeMenu);
  sideMenuOverlay?.addEventListener("click", closeMenu);

  navToGroup?.addEventListener("click", closeMenu);
  navToGame?.addEventListener("click", () => (window.location.href = `game.html?gid=${groupId}`));
  navToSosou?.addEventListener("click", () => (window.location.href = `sosou.html?gid=${groupId}`));
  navToSettle?.addEventListener("click", () => (window.location.href = `settlement.html?gid=${groupId}`));
  navToManage?.addEventListener("click", () => (window.location.href = `manage.html?gid=${groupId}`));

  goToSettleBtn?.addEventListener("click", () => {
    window.location.href = `settlement.html?gid=${groupId}`;
  });

  // グループ情報取得
  try {
    const doc = await window.db.collection("groups").doc(groupId).get();
    if (!doc.exists) {
      groupNameEl.textContent = "グループが見つかりませんでした。";
      return;
    }
    const data = doc.data() || {};
    members = data.members || [];
    const groupName = data.name || "無題のイベント";
    groupNameEl.textContent = groupName;
    membersListEl.textContent = `メンバー: ${members.join("、")}`;
    upsertRecentGroup({ gid: groupId, name: groupName });

    members.forEach((m) => {
      const option = document.createElement("option");
      option.value = m;
      option.textContent = m;
      paidBySelect.appendChild(option);

      const label = document.createElement("label");
      label.style.display = "inline-block";
      label.style.marginRight = "8px";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = m;
      checkbox.checked = true;

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(m));
      targetMembersDiv.appendChild(label);
    });
  } catch (err) {
    console.error("[group.js] グループ情報取得エラー", err);
    groupNameEl.textContent = "グループ情報の取得に失敗しました。";
    return;
  }

  function toMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.toDate === "function") return ts.toDate().getTime();
    if (ts instanceof Date) return ts.getTime();
    return 0;
  }

  async function renderExpensesWithPenalties(baseSnap) {
    if (!expensesBody) return;
    const rows = [];

    baseSnap.forEach((doc) => {
      const data = doc.data();
      rows.push({
        title: data.title || "",
        amount: data.amount || 0,
        paidBy: data.paidBy || "",
        targets: data.targets || [],
        createdAt: toMillis(data.createdAt),
      });
    });

    try {
      const sosouSnap = await window.db
        .collection("groups")
        .doc(groupId)
        .collection("sosou")
        .where("penaltyType", "==", "fine")
        .get();

      sosouSnap.forEach((doc) => {
        const p = doc.data() || {};
        const amount = typeof p.amount === "number" ? p.amount : null;
        const member = p.member || "";
        if (!amount || !member) return;
        rows.push({
          title: p.title ? `粗相: ${p.title}` : "粗相",
          amount,
          paidBy: member,
          targets: [member],
          createdAt: toMillis(p.createdAt),
        });
      });
    } catch (err) {
      console.warn("[group.js] sosou fine load error", err);
    }

    rows.sort((a, b) => a.createdAt - b.createdAt);
    expensesBody.innerHTML = "";
    rows.forEach((exp) => {
      const tr = document.createElement("tr");
      const tdTitle = document.createElement("td");
      const tdAmount = document.createElement("td");
      const tdPaidBy = document.createElement("td");
      const tdTargets = document.createElement("td");

      tdTitle.textContent = exp.title;
      tdAmount.textContent = `${Number(exp.amount || 0).toLocaleString()}円`;
      tdPaidBy.textContent = exp.paidBy || "";
      tdTargets.textContent = (exp.targets || []).join("、");

      tr.appendChild(tdTitle);
      tr.appendChild(tdAmount);
      tr.appendChild(tdPaidBy);
      tr.appendChild(tdTargets);
      expensesBody.appendChild(tr);
    });
  }

  // 支払一覧の購読
  window.db
    .collection("groups")
    .doc(groupId)
    .collection("expenses")
    .orderBy("createdAt", "asc")
    .onSnapshot((snapshot) => {
      renderExpensesWithPenalties(snapshot);
    });

  selectAllBtn?.addEventListener("click", () => {
    targetMembersDiv.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = true;
    });
  });

  // 支払の記録
  addExpenseBtn?.addEventListener("click", async () => {
    expenseError.textContent = "";

    const title = (titleInput.value || "").trim();
    const amount = Number(amountInput.value);
    const paidBy = paidBySelect.value;
    const targets = Array.from(targetMembersDiv.querySelectorAll("input[type=checkbox]"))
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);

    if (!title) {
      expenseError.textContent = "項目名を入力してください。";
      return;
    }
    if (!amount || amount <= 0) {
      expenseError.textContent = "金額を正しく入力してください。";
      return;
    }
    if (!paidBy) {
      expenseError.textContent = "立て替えた人を選択してください。";
      return;
    }
    if (targets.length === 0) {
      expenseError.textContent = "対象メンバーを1人以上選択してください。";
      return;
    }

    try {
      await window.db
        .collection("groups")
        .doc(groupId)
        .collection("expenses")
        .add({
          title,
          amount,
          paidBy,
          targets,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

      titleInput.value = "";
      amountInput.value = "";
    } catch (err) {
      console.error("[group.js] 立て替え追加エラー", err);
      expenseError.textContent = "立て替えの登録に失敗しました。";
    }
  });
});


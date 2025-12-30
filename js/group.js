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

  // 編集モーダル要素
  const editExpenseModal = document.getElementById("editExpenseModal");
  const editExpenseSubtitle = document.getElementById("editExpenseSubtitle");
  const editTitleInput = document.getElementById("editTitle");
  const editAmountInput = document.getElementById("editAmount");
  const editPaidBySelect = document.getElementById("editPaidBy");
  const editTargetsDiv = document.getElementById("editTargets");
  const editExpenseError = document.getElementById("editExpenseError");
  const saveExpenseBtn = document.getElementById("saveExpenseBtn");
  const deleteExpenseBtn = document.getElementById("deleteExpenseBtn");
  const closeEditExpenseBtn = document.getElementById("closeEditExpenseBtn");

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
  let currentEditing = { id: null, type: null };
  let lastExpensesSnapshot = null;

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

      const editOption = document.createElement("option");
      editOption.value = m;
      editOption.textContent = m;
      editPaidBySelect.appendChild(editOption);

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

      const editLabel = document.createElement("label");
      editLabel.style.display = "inline-block";
      editLabel.style.marginRight = "8px";

      const editCheckbox = document.createElement("input");
      editCheckbox.type = "checkbox";
      editCheckbox.value = m;

      editLabel.appendChild(editCheckbox);
      editLabel.appendChild(document.createTextNode(m));
      editTargetsDiv.appendChild(editLabel);
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

  function openEditModal() {
    editExpenseModal?.classList.add("open");
    editExpenseModal?.setAttribute("aria-hidden", "false");
  }

  function closeEditModal() {
    currentEditing = { id: null, type: null };
    editExpenseModal?.classList.remove("open");
    editExpenseModal?.setAttribute("aria-hidden", "true");
    editExpenseError.textContent = "";
  }

  editExpenseModal?.querySelectorAll("[data-close-modal], .modal-overlay").forEach((el) => {
    el.addEventListener("click", closeEditModal);
  });
  closeEditExpenseBtn?.addEventListener("click", closeEditModal);

  async function renderExpensesWithPenalties(baseSnap) {
    if (!expensesBody) return;
    const rows = [];

    baseSnap.forEach((doc) => {
      const data = doc.data();
      rows.push({
        id: doc.id,
        type: "expense",
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
          id: doc.id,
          type: "penalty",
          penaltyType: p.penaltyType,
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
      const tdActions = document.createElement("td");

      tdTitle.textContent = exp.title;
      tdAmount.textContent = `${Number(exp.amount || 0).toLocaleString()}円`;
      tdPaidBy.textContent = exp.paidBy || "";
      tdTargets.textContent = (exp.targets || []).join("、");

      if ((exp.type === "expense" || exp.type === "penalty") && exp.id) {
        const editBtn = document.createElement("button");
        editBtn.textContent = "編集";
        editBtn.className = "table-action-btn";
        editBtn.addEventListener("click", () => {
          currentEditing = { id: exp.id, type: exp.type, penaltyType: exp.penaltyType };
          editExpenseSubtitle.textContent = `項目: ${exp.title || "無題"}`;
          editTitleInput.value = exp.title || "";
          editAmountInput.value = exp.amount || "";
          editPaidBySelect.value = exp.paidBy || "";
          // ターゲットのチェック状態を反映
          const selectedTargets = new Set(exp.targets || []);
          editTargetsDiv.querySelectorAll("input[type=checkbox]").forEach((cb) => {
            cb.checked = selectedTargets.has(cb.value);
          });
          openEditModal();
        });
        tdActions.appendChild(editBtn);
      }

      tr.appendChild(tdTitle);
      tr.appendChild(tdAmount);
      tr.appendChild(tdPaidBy);
      tr.appendChild(tdTargets);
      tr.appendChild(tdActions);
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
      lastExpensesSnapshot = snapshot;
      renderExpensesWithPenalties(snapshot);
    });

  // 粗相(罰金)も一覧をリアルタイム更新
  window.db
    .collection("groups")
    .doc(groupId)
    .collection("sosou")
    .where("penaltyType", "==", "fine")
    .onSnapshot(
      () => {
        if (lastExpensesSnapshot) {
          renderExpensesWithPenalties(lastExpensesSnapshot);
        }
      },
      (err) => {
        console.warn("[group.js] sosou fine snapshot error", err);
      }
    );

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

  // 編集保存
  saveExpenseBtn?.addEventListener("click", async () => {
    if (!currentEditing.id || !currentEditing.type) return;
    editExpenseError.textContent = "";

    const title = (editTitleInput.value || "").trim();
    const amount = Number(editAmountInput.value);
    const paidBy = editPaidBySelect.value;
    const targets = Array.from(editTargetsDiv.querySelectorAll("input[type=checkbox]"))
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);

    if (!title) {
      editExpenseError.textContent = "項目名を入力してください。";
      return;
    }
    if (!amount || amount <= 0) {
      editExpenseError.textContent = "金額を正しく入力してください。";
      return;
    }
    if (!paidBy) {
      editExpenseError.textContent = "立て替えた人を選択してください。";
      return;
    }
    if (targets.length === 0) {
      editExpenseError.textContent = "対象メンバーを1人以上選択してください。";
      return;
    }

    try {
      if (currentEditing.type === "expense") {
        await window.db
          .collection("groups")
          .doc(groupId)
          .collection("expenses")
          .doc(currentEditing.id)
          .update({ title, amount, paidBy, targets });
      } else if (currentEditing.type === "penalty") {
        await window.db
          .collection("groups")
          .doc(groupId)
          .collection("sosou")
          .doc(currentEditing.id)
          .update({ title: title.replace(/^粗相: /, ""), amount, member: paidBy });
      }
      closeEditModal();
    } catch (err) {
      console.error("[group.js] 支払更新エラー", err);
      editExpenseError.textContent = "更新に失敗しました。通信状況を確認してください。";
    }
  });

  // 編集削除
  deleteExpenseBtn?.addEventListener("click", async () => {
    if (!currentEditing.id || !currentEditing.type) return;
    editExpenseError.textContent = "";
    const title = (editTitleInput.value || "").trim() || "無題";
    const confirmed = window.confirm(`「${title}」の支払を削除しますか？`);
    if (!confirmed) return;
    try {
      if (currentEditing.type === "expense") {
        await window.db
          .collection("groups")
          .doc(groupId)
          .collection("expenses")
          .doc(currentEditing.id)
          .delete();
      } else if (currentEditing.type === "penalty") {
        await window.db
          .collection("groups")
          .doc(groupId)
          .collection("sosou")
          .doc(currentEditing.id)
          .delete();
      }
      closeEditModal();
    } catch (err) {
      console.error("[group.js] 支払削除エラー", err);
      editExpenseError.textContent = "削除に失敗しました。通信状況を確認してください。";
    }
  });
});


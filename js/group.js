// js/group.js

// URLパラメータから gid を取得
function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

// 割り勘計算ロジック
function calculateSettlement(members, expenses) {
  const paid = {};
  const shouldPay = {};

  members.forEach(m => {
    paid[m] = 0;
    shouldPay[m] = 0;
  });

  expenses.forEach(exp => {
    const { amount, paidBy, targets } = exp;
    const share = amount / targets.length;

    paid[paidBy] += amount;
    targets.forEach(t => {
      shouldPay[t] += share;
    });
  });

  const balances = members.map(m => ({
    name: m,
    balance: paid[m] - shouldPay[m]
  }));

  let plus = balances.filter(b => b.balance > 1);
  let minus = balances.filter(b => b.balance < -1);
  const result = [];

  while (plus.length > 0 && minus.length > 0) {
    plus.sort((a, b) => b.balance - a.balance);
    minus.sort((a, b) => a.balance - b.balance);

    const p = plus[0];
    const m = minus[0];

    const amount = Math.min(p.balance, -m.balance);
    const rounded = Math.round(amount);

    if (rounded > 0) {
      result.push({ from: m.name, to: p.name, amount: rounded });
    }

    p.balance -= amount;
    m.balance += amount;

    if (p.balance <= 1) plus.shift();
    if (m.balance >= -1) minus.shift();
  }

  return result;
}

document.addEventListener("DOMContentLoaded", async () => {
  const groupId = getGroupIdFromQuery();
  console.log("[group.js] groupId =", groupId);

  if (!groupId) {
    alert("グループIDが指定されていません。（URL に ?gid= が付いているか確認してください）");
    return;
  }

  const groupNameEl = document.getElementById("groupName");
  const membersListEl = document.getElementById("membersList");
  const paidBySelect = document.getElementById("paidBy");
  const targetMembersDiv = document.getElementById("targetMembers");
  const selectAllBtn = document.getElementById("selectAllBtn");
  const expensesBody = document.getElementById("expensesBody");
  const settlementList = document.getElementById("settlementList");
  const expenseError = document.getElementById("expenseError");

  const titleInput = document.getElementById("title");
  const amountInput = document.getElementById("amount");
  const addExpenseBtn = document.getElementById("addExpenseBtn");

  // 共有URL関連
  const shareUrlInput = document.getElementById("shareUrl");
  const copyShareUrlBtn = document.getElementById("copyShareUrlBtn");
  const shareUrlMessage = document.getElementById("shareUrlMessage");

  // 今開いているURLそのものを共有URLとして使う
  const shareUrl = window.location.href;
  if (shareUrlInput) {
    shareUrlInput.value = shareUrl;
  }

  // navigator.share が使える環境ではボタンのラベルを変更（任意）
  if (navigator.share && copyShareUrlBtn) {
    copyShareUrlBtn.textContent = "共有する";
  }

  let members = [];
  let expenses = [];

  // グループ情報の取得
  try {
    const doc = await window.db.collection("groups").doc(groupId).get();
    console.log("[group.js] group doc exists =", doc.exists);

    if (!doc.exists) {
      groupNameEl.textContent = "グループが見つかりませんでした。";
      return;
    }

    const data = doc.data();
    console.log("[group.js] group data =", data);

    members = data.members || [];
    groupNameEl.textContent = data.name || "無題のイベント";
    membersListEl.textContent = `メンバー: ${members.join("、")}`;

    // 支払った人セレクト & 対象メンバーのチェックボックス
    members.forEach(m => {
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

  // 立て替え一覧を読み込み & 監視
  window.db.collection("groups")
    .doc(groupId)
    .collection("expenses")
    .orderBy("createdAt", "asc")
    .onSnapshot(snapshot => {
      expenses = [];
      expensesBody.innerHTML = "";

      snapshot.forEach(doc => {
        const data = doc.data();
        const exp = {
          id: doc.id,
          title: data.title,
          amount: data.amount,
          paidBy: data.paidBy,
          targets: data.targets || []
        };
        expenses.push(exp);

        const tr = document.createElement("tr");

        const tdTitle = document.createElement("td");
        const tdAmount = document.createElement("td");
        const tdPaidBy = document.createElement("td");
        const tdTargets = document.createElement("td");

        tdTitle.textContent = exp.title;
        tdAmount.textContent = exp.amount.toLocaleString() + "円";
        tdPaidBy.textContent = exp.paidBy;
        tdTargets.textContent = exp.targets.join("、");

        tr.appendChild(tdTitle);
        tr.appendChild(tdAmount);
        tr.appendChild(tdPaidBy);
        tr.appendChild(tdTargets);

        expensesBody.appendChild(tr);
      });

      settlementList.innerHTML = "";
      if (expenses.length === 0) {
        const li = document.createElement("li");
        li.textContent = "まだ立て替えが登録されていません。";
        settlementList.appendChild(li);
      } else {
        const settlement = calculateSettlement(members, expenses);
        if (settlement.length === 0) {
          const li = document.createElement("li");
          li.textContent = "すでに公平な状態です。誰も支払う必要はありません。";
          settlementList.appendChild(li);
        } else {
          settlement.forEach(s => {
            const li = document.createElement("li");
            li.textContent = `${s.from} → ${s.to} に ${s.amount.toLocaleString()}円 支払う`;
            settlementList.appendChild(li);
          });
        }
      }
    });

  // 全員選択ボタン
  selectAllBtn.addEventListener("click", () => {
    const checkboxes = targetMembersDiv.querySelectorAll("input[type=checkbox]");
    checkboxes.forEach(cb => {
      cb.checked = true;
    });
  });

  // 共有URLコピー or 共有シート
  copyShareUrlBtn.addEventListener("click", async () => {
    shareUrlMessage.textContent = "";

    const url = shareUrlInput.value;
    const shareData = {
      title: groupNameEl.textContent || "割り勘グループ",
      text: "この割り勘グループを共有します。",
      url
    };

    // Web Share API が使える（主にスマホ）の場合
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        shareUrlMessage.textContent = "共有シートを開きました。";
        return;
      } catch (err) {
        console.warn("navigator.share でキャンセルまたはエラー", err);
      }
    }

    // フォールバック：URLコピー
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        shareUrlInput.select();
        document.execCommand("copy");
      }
      shareUrlMessage.textContent = "共有URLをコピーしました。";
    } catch (err) {
      console.error("URLコピー失敗", err);
      shareUrlMessage.textContent =
        "コピーに失敗しました。手動で選択してコピーしてください。";
    }
  });

  // 立て替え追加
  addExpenseBtn.addEventListener("click", async () => {
    expenseError.textContent = "";

    const title = titleInput.value.trim();
    const amount = Number(amountInput.value);
    const paidBy = paidBySelect.value;

    const checkboxes = targetMembersDiv.querySelectorAll("input[type=checkbox]");
    const targets = Array.from(checkboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    if (!title) {
      expenseError.textContent = "項目名を入力してください。";
      return;
    }
    if (!amount || amount <= 0) {
      expenseError.textContent = "金額を正しく入力してください。";
      return;
    }
    if (!paidBy) {
      expenseError.textContent = "支払った人を選択してください。";
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
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

      titleInput.value = "";
      amountInput.value = "";
    } catch (err) {
      console.error("[group.js] 立て替え追加エラー", err);
      expenseError.textContent = "立て替えの登録に失敗しました。";
    }
  });
// js/group.js

function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

/* （途中の割り勘ロジック・Firestore処理は変更なし） */
/* ……あなたの今のコードそのまま …… */

  // ===== ハンバーガーメニュー制御 =====
  const menuButton = document.getElementById("menuButton");
  const sideMenu = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");

  const navToGroup = document.getElementById("navToGroup");
  const navToGame = document.getElementById("navToGame");
  const navToAbout = document.getElementById("navToAbout");
  const navToContact = document.getElementById("navToContact");
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

  navToGroup?.addEventListener("click", closeMenu);

  navToGame?.addEventListener("click", () => {
    window.location.href = `game.html?gid=${groupId}`;
  });

  navToSettle?.addEventListener("click", () => {
    window.location.href = `settlement.html?gid=${groupId}`;
  });

  // navToAbout and navToContact removed
});

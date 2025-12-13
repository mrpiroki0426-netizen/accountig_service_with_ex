// js/group.js

// URLパラメータから gid を取得
function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

// 割り勘計算ロジック
function calculateSettlement(members, expenses) {
  // 1. 各メンバーの「実際に払った金額」と「本来払うべき金額」を計算
  const paid = {};
  const shouldPay = {};

  members.forEach(m => {
    paid[m] = 0;
    shouldPay[m] = 0;
  });

  expenses.forEach(exp => {
    const { title, amount, paidBy, targets } = exp;
    const share = amount / targets.length;

    // 実際に払った人
    paid[paidBy] += amount;

    // 対象メンバーの本来の負担
    targets.forEach(t => {
      shouldPay[t] += share;
    });
  });

  // 2. 残高 = 実際に払った - 本来払うべき
  const balances = members.map(m => ({
    name: m,
    balance: paid[m] - shouldPay[m]
  }));

  // 3. プラスとマイナスに分ける
  let plus = balances.filter(b => b.balance > 1);   // 1円以下誤差は無視
  let minus = balances.filter(b => b.balance < -1);

  const result = [];

  // 4. 貪欲にマッチング
  while (plus.length > 0 && minus.length > 0) {
    // 残高が一番大きい人/小さい人を探す
    plus.sort((a, b) => b.balance - a.balance);
    minus.sort((a, b) => a.balance - b.balance);

    const p = plus[0];
    const m = minus[0];

    const amount = Math.min(p.balance, -m.balance);
    const rounded = Math.round(amount); // 円に丸める

    if (rounded > 0) {
      result.push({
        from: m.name,
        to: p.name,
        amount: rounded
      });
    }

    p.balance -= amount;
    m.balance += amount;

    // 残高が0付近になったら配列から除外
    if (p.balance <= 1) plus.shift();
    if (m.balance >= -1) minus.shift();
  }

  return result;
}

document.addEventListener("DOMContentLoaded", async () => {
  const groupId = getGroupIdFromQuery();
  if (!groupId) {
    alert("グループIDが指定されていません。");
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

  let members = [];
  let expenses = [];

  // グループ情報の取得
  try {
    const doc = await db.collection("groups").doc(groupId).get();
    if (!doc.exists) {
      groupNameEl.textContent = "グループが見つかりませんでした。";
      return;
    }

    const data = doc.data();
    members = data.members || [];
    groupNameEl.textContent = data.name || "無題のイベント";
    membersListEl.textContent = `メンバー: ${members.join("、")}`;

    // 支払った人のセレクトボックス & 対象メンバーのチェックボックスを作成
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
    console.error(err);
    groupNameEl.textContent = "グループ情報の取得に失敗しました。";
    return;
  }

  // 立て替え一覧を読み込み & 監視
  db.collection("groups")
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

      // 精算結果を再計算
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
      await db
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

      // 入力フォームをリセット（一部だけ）
      titleInput.value = "";
      amountInput.value = "";
    } catch (err) {
      console.error(err);
      expenseError.textContent = "立て替えの登録に失敗しました。";
    }
  });
});

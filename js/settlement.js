// js/settlement.js

const RECENT_GROUPS_KEY = "yamican.recentGroups.v1";
const MAX_RECENT_GROUPS = 8;

const PAYMENT_WEIGHT_MIN = 0.5;
const PAYMENT_WEIGHT_MAX = 2.0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeMeanOne(map, members) {
  // NOTE: 以前は平均=1に正規化していたが、要望により廃止（互換のため関数は残す）
  return map;
}

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

function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

// 割り勘計算ロジック（支払いレートで負担を調整）
// レートが高いほど負担が小さくなるよう、配分は「1/レート」で重み付けする
function calculateSettlement(members, expenses, rates = {}) {
  const paid = {};
  const shouldPay = {};

  members.forEach((m) => {
    paid[m] = 0;
    shouldPay[m] = 0;
  });

  expenses.forEach((exp) => {
    const { amount, paidBy, targets } = exp;
    if (!amount || !paidBy || !targets || targets.length === 0) return;
    const weights = targets.map((t) => {
      const r = rates[t];
      const rate = typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 1;
      return 1 / rate;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0) || targets.length;

    paid[paidBy] = (paid[paidBy] || 0) + amount;
    targets.forEach((t) => {
      const r = rates[t];
      const rate = typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 1;
      const w = 1 / rate;
      const share = (amount * w) / totalWeight;
      shouldPay[t] = (shouldPay[t] || 0) + share;
    });
  });

  const balances = members.map((m) => ({
    name: m,
    balance: paid[m] - shouldPay[m],
  }));

  let plus = balances.filter((b) => b.balance > 1);
  let minus = balances.filter((b) => b.balance < -1);
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
  if (!groupId) {
    alert("グループIDが指定されていません。（URL に ?gid= が付いているか確認してください）");
    return;
  }

  const groupInfoEl = document.getElementById("groupInfo");
  const expensesBody = document.getElementById("expensesBody");
  const settlementList = document.getElementById("settlementList");
  const totalsBody = document.getElementById("totalsBody");
  const ratingsBody = document.getElementById("ratingsBody");
  const ratingInfo = document.getElementById("ratingInfo");
  const shareUrlInput = document.getElementById("shareUrl");
  const copyShareUrlBtn = document.getElementById("copyShareUrlBtn");
  const shareUrlMessage = document.getElementById("shareUrlMessage");

  const menuButton = document.getElementById("menuButton");
  const sideMenu = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");
  const navToGroup = document.getElementById("navToGroup");
  const navToGame = document.getElementById("navToGame");
  const navToSettle = document.getElementById("navToSettle");
  const navToManage = document.getElementById("navToManage");

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
    window.location.href = `game.html?gid=${groupId}`;
  });
  navToSettle?.addEventListener("click", closeMenu);
  navToManage?.addEventListener("click", () => {
    window.location.href = `manage.html?gid=${groupId}`;
  });

  if (shareUrlInput) {
    shareUrlInput.value = window.location.href;
  }
  copyShareUrlBtn?.addEventListener("click", async () => {
    if (!shareUrlInput) return;
    shareUrlMessage && (shareUrlMessage.textContent = "");
    const url = shareUrlInput.value;
    const shareData = {
      title: "精算状況",
      text: "このグループの精算状況を共有します。",
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        shareUrlMessage && (shareUrlMessage.textContent = "共有シートを開きました。");
        return;
      } catch (err) {
        console.warn("navigator.share error/cancel", err);
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        shareUrlInput.select();
        document.execCommand("copy");
      }
      shareUrlMessage && (shareUrlMessage.textContent = "共有URLをコピーしました。");
    } catch (err) {
      console.error("share copy error", err);
      shareUrlMessage &&
        (shareUrlMessage.textContent = "コピーに失敗しました。手動でコピーしてください。");
    }
  });

  function renderPaymentWeights({ paymentWeights, sourceLabel, members }) {
    const capped = {};
    members.forEach((m) => {
      const v = typeof paymentWeights?.[m] === "number" && Number.isFinite(paymentWeights[m]) ? paymentWeights[m] : 1;
      capped[m] = clamp(v, PAYMENT_WEIGHT_MIN, PAYMENT_WEIGHT_MAX);
    });

    if (ratingsBody) {
      ratingsBody.innerHTML = "";
      members.forEach((m) => {
        const tr = document.createElement("tr");
        const tdName = document.createElement("td");
        const tdRate = document.createElement("td");
        tdName.textContent = m;
        tdRate.textContent = capped[m].toFixed(2);
        tr.appendChild(tdName);
        tr.appendChild(tdRate);
        ratingsBody.appendChild(tr);
      });
    }

    if (ratingInfo) {
      ratingInfo.textContent = `${sourceLabel}（レートが高いほど負担が小さくなります）`;
    }

    return capped;
  }

  try {
    const doc = await window.db.collection("groups").doc(groupId).get();
    if (!doc.exists) {
      groupInfoEl.textContent = "グループが見つかりませんでした。";
      return;
    }
    const data = doc.data();
    const members = data.members || [];
    const groupName = data.name || "無題のイベント";
    groupInfoEl.textContent = `グループ：${groupName}（メンバー：${members.join("、")}）`;
    upsertRecentGroup({ gid: groupId, name: groupName });
    const paymentWeights = data.paymentWeights || {};
    const sourceName = data.paymentWeightsSourceGameName || "";
    const sourceLabel = sourceName
      ? `最後に反映したゲーム: ${sourceName}`
      : "まだ確定済みゲームがありません";
    const rates = renderPaymentWeights({ paymentWeights, sourceLabel, members });

    window.db
      .collection("groups")
      .doc(groupId)
      .collection("expenses")
      .orderBy("createdAt", "asc")
      .onSnapshot((snapshot) => {
        const expenses = [];
        expensesBody.innerHTML = "";

        snapshot.forEach((d) => {
          const exp = d.data();
          const record = {
            title: exp.title || "",
            amount: exp.amount || 0,
            paidBy: exp.paidBy || "",
            targets: exp.targets || [],
          };
          expenses.push(record);

          const tr = document.createElement("tr");
          const tdTitle = document.createElement("td");
          const tdAmount = document.createElement("td");
          const tdPaidBy = document.createElement("td");
          const tdTargets = document.createElement("td");

          tdTitle.textContent = record.title;
          tdAmount.textContent = `${record.amount.toLocaleString()}円`;
          tdPaidBy.textContent = record.paidBy;
          tdTargets.textContent = record.targets.join("、");

          tr.appendChild(tdTitle);
          tr.appendChild(tdAmount);
          tr.appendChild(tdPaidBy);
          tr.appendChild(tdTargets);
          expensesBody.appendChild(tr);
        });

        // メンバー別の合計を描画（レートが高いほど負担が小さい）
        if (totalsBody) {
          totalsBody.innerHTML = "";
          const paid = {};
          const shouldPayBeforeRate = {};
          const shouldPayAfterRate = {};
          members.forEach((m) => {
            paid[m] = 0;
            shouldPayBeforeRate[m] = 0;
            shouldPayAfterRate[m] = 0;
          });
          expenses.forEach((exp) => {
            if (!exp.targets || exp.targets.length === 0) return;
            const targetCount = exp.targets.length;
            const shareBefore = targetCount ? exp.amount / targetCount : 0;

            const weightsAfter = exp.targets.map((t) => {
              const r = rates[t];
              const rate = typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 1;
              return 1 / rate;
            });
            const totalWeightAfter = weightsAfter.reduce((a, b) => a + b, 0) || targetCount;

            if (exp.paidBy) {
              paid[exp.paidBy] = (paid[exp.paidBy] || 0) + (exp.amount || 0);
            }
            exp.targets.forEach((t) => {
              shouldPayBeforeRate[t] = (shouldPayBeforeRate[t] || 0) + shareBefore;

              const r = rates[t];
              const rate = typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 1;
              const w = 1 / rate;
              const shareAfter = totalWeightAfter ? (exp.amount * w) / totalWeightAfter : shareBefore;
              shouldPayAfterRate[t] = (shouldPayAfterRate[t] || 0) + shareAfter;
            });
          });
          members.forEach((m) => {
            const tr = document.createElement("tr");
            const tdName = document.createElement("td");
            const tdPaid = document.createElement("td");
            const tdShouldBefore = document.createElement("td");
            const tdShouldAfter = document.createElement("td");
            const tdBalance = document.createElement("td");
            const balance = (paid[m] || 0) - (shouldPayAfterRate[m] || 0);
            tdName.textContent = m;
            tdPaid.textContent = `${Math.round(paid[m] || 0).toLocaleString()}円`;
            tdShouldBefore.textContent = `${Math.round(shouldPayBeforeRate[m] || 0).toLocaleString()}円`;
            tdShouldAfter.textContent = `${Math.round(shouldPayAfterRate[m] || 0).toLocaleString()}円`;
            tdBalance.textContent = `${balance >= 0 ? "+" : ""}${Math.round(balance).toLocaleString()}円`;
            tr.appendChild(tdName);
            tr.appendChild(tdPaid);
            tr.appendChild(tdShouldBefore);
            tr.appendChild(tdShouldAfter);
            tr.appendChild(tdBalance);
            totalsBody.appendChild(tr);
          });
        }

        settlementList.innerHTML = "";
        if (expenses.length === 0) {
          const li = document.createElement("li");
          li.textContent = "まだ立て替えが登録されていません。";
          settlementList.appendChild(li);
        } else {
          const settlement = calculateSettlement(members, expenses, rates);
          if (settlement.length === 0) {
            const li = document.createElement("li");
            li.textContent = "すでに公平な状態です。誰も支払う必要はありません。";
            settlementList.appendChild(li);
          } else {
            settlement.forEach((s) => {
              const li = document.createElement("li");
              li.textContent = `${s.from} → ${s.to} に ${s.amount.toLocaleString()}円 支払う`;
              settlementList.appendChild(li);
            });
          }
        }
      });
  } catch (err) {
    console.error("[settlement.js] グループ情報取得エラー", err);
    groupInfoEl.textContent = "グループ情報の取得に失敗しました。";
  }
});

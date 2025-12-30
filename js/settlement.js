// js/settlement.js (UTF-8 clean)

const RECENT_GROUPS_KEY = "yamican.recentGroups.v1";
const MAX_RECENT_GROUPS = 8;
const PAYMENT_WEIGHT_MIN = 0.5;
const PAYMENT_WEIGHT_MAX = 2.0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyRateBadge(el, rateValue) {
  if (!el) return;
  const rate = typeof rateValue === "number" && Number.isFinite(rateValue) ? rateValue : 1;
  const diff = rate - 1;
  const intensity = clamp(Math.abs(diff) / 0.8, 0, 1);
  const alpha = 0.12 + 0.42 * intensity;
  if (Math.abs(diff) < 1e-6) {
    el.style.backgroundColor = "rgba(234, 179, 8, 0.22)";
    el.style.border = "1px solid rgba(202, 138, 4, 0.45)";
    el.style.color = "#854d0e";
  } else if (diff >= 0) {
    el.style.backgroundColor = `rgba(239, 68, 68, ${alpha})`;
    el.style.border = `1px solid rgba(239, 68, 68, ${0.18 + 0.35 * intensity})`;
    el.style.color = intensity >= 0.55 ? "#7f1d1d" : "#991b1b";
  } else {
    el.style.backgroundColor = `rgba(34, 197, 94, ${alpha})`;
    el.style.border = `1px solid rgba(34, 197, 94, ${0.18 + 0.35 * intensity})`;
    el.style.color = intensity >= 0.55 ? "#052e16" : "#14532d";
  }
  el.classList.add("rate-badge");
}

function resolvePenaltyMultiplier(penaltyValue) {
  if (typeof penaltyValue === "number" && Number.isFinite(penaltyValue)) {
    if (penaltyValue > 0 && penaltyValue < 1) return 1 - penaltyValue;
    if (penaltyValue > 0) return penaltyValue;
  }
  return 1;
}

function normalizeMeanOne(map, members) {
  // 互換のためそのまま返す（現状レートはそのまま使用）
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
  const next = [{ gid, name: normalizedName, lastUsedAt: now }, ...current.filter(i => i.gid !== gid)].slice(
    0,
    MAX_RECENT_GROUPS
  );
  saveRecentGroups(next);
}

function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

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
      return rate;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0) || targets.length;

    paid[paidBy] = (paid[paidBy] || 0) + amount;
    targets.forEach((t, idx) => {
      const r = rates[t];
      const rate = typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 1;
      const w = weights[idx];
      const share = (amount * w) / totalWeight;
      shouldPay[t] = (shouldPay[t] || 0) + share;
    });
  });

  const balances = members.map((m) => ({ name: m, balance: paid[m] - shouldPay[m] }));
  let plus = balances.filter((b) => b.balance > 1);
  let minus = balances.filter((b) => b.balance < -1);
  const result = [];

  while (plus.length && minus.length) {
    plus.sort((a, b) => b.balance - a.balance);
    minus.sort((a, b) => a.balance - b.balance);
    const p = plus[0];
    const m = minus[0];
    const amount = Math.min(p.balance, -m.balance);
    const rounded = Math.round(amount);
    if (rounded > 0) result.push({ from: m.name, to: p.name, amount: rounded });
    p.balance -= amount;
    m.balance += amount;
    if (p.balance <= 1) plus.shift();
    if (m.balance >= -1) minus.shift();
  }
  return result;
}

function applyPenaltyRates(baseRates, penalties) {
  const merged = { ...baseRates };
  penalties.forEach((p) => {
    if (p.type === "rate" && p.member) {
      const mult = typeof p.rateMultiplier === "number" && Number.isFinite(p.rateMultiplier) ? p.rateMultiplier : 1;
      const current = typeof merged[p.member] === "number" && Number.isFinite(merged[p.member]) ? merged[p.member] : 1;
      merged[p.member] = current * mult;
    }
  });
  return merged;
}

function formatYen(n) {
  return `${Math.round(n || 0).toLocaleString()}円`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const groupId = getGroupIdFromQuery();
  if (!groupId) {
    alert("グループIDが指定されていません。URL に ?gid= を付けてください。");
    return;
  }

  const groupInfoEl = document.getElementById("groupInfo");
  const settlementBody = document.getElementById("settlementBody");
  const totalsBody = document.getElementById("totalsBody");
  const totalsSection = document.getElementById("totalsSection");
  const showTotalsBtn = document.getElementById("showTotalsBtn");
  const hideTotalsBtn = document.getElementById("hideTotalsBtn");
  const ratingsBody = document.getElementById("ratingsBody");
  const ratingInfo = document.getElementById("ratingInfo");
  const rateToggle = document.getElementById("rateToggle");
  const rateToggleLabel = document.getElementById("rateToggleLabel");

  // side menu
  const menuButton = document.getElementById("menuButton");
  const sideMenu = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");
  const navToGroup = document.getElementById("navToGroup");
  const navToGame = document.getElementById("navToGame");
  const navToSosou = document.getElementById("navToSosou");
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

  navToGroup?.addEventListener("click", () => (window.location.href = `group.html?gid=${groupId}`));
  navToGame?.addEventListener("click", () => (window.location.href = `game.html?gid=${groupId}`));
  navToSosou?.addEventListener("click", () => (window.location.href = `sosou.html?gid=${groupId}`));
  navToSettle?.addEventListener("click", closeMenu);
  navToManage?.addEventListener("click", () => (window.location.href = `manage.html?gid=${groupId}`));

  showTotalsBtn?.addEventListener("click", () => {
    if (totalsSection) {
      totalsSection.style.display = "block";
    }
    showTotalsBtn.style.display = "none";
  });
  hideTotalsBtn?.addEventListener("click", () => {
    if (totalsSection) {
      totalsSection.style.display = "none";
    }
    if (showTotalsBtn) {
      showTotalsBtn.style.display = "inline-block";
    }
  });

  let useRates = true;
  const latestState = {
    members: [],
    baseRates: {},
    penaltyRates: [],
    expenses: [],
    penaltyExpenses: [],
  };

  function updateToggleLabel() {
    if (!rateToggleLabel) return;
    rateToggleLabel.textContent = useRates ? "レートを加味した清算" : "レートを加味しない清算";
  }

  function buildEffectiveRates(members) {
    if (!useRates) {
      const ones = {};
      members.forEach((m) => (ones[m] = 1));
      return ones;
    }
    const merged = applyPenaltyRates(latestState.baseRates, latestState.penaltyRates);
    const capped = {};
    members.forEach((m) => {
      const v = typeof merged?.[m] === "number" && Number.isFinite(merged[m]) ? merged[m] : 1;
      capped[m] = clamp(v, PAYMENT_WEIGHT_MIN, PAYMENT_WEIGHT_MAX);
    });
    return capped;
  }

  function renderSettlementAndTotals() {
    const members = latestState.members;
    if (!members || members.length === 0) return;

    const effectiveRates = buildEffectiveRates(members);
    const expenses = [...latestState.expenses, ...latestState.penaltyExpenses];

    // メンバー別集計
    if (totalsBody) {
      totalsBody.innerHTML = "";
      const paid = {};
      const shouldPayBeforeRate = {};
      const shouldPayAfterRate = {};
      const effectiveRateByMember = {};
      members.forEach((m) => {
        paid[m] = 0;
        shouldPayBeforeRate[m] = 0;
        shouldPayAfterRate[m] = 0;
        effectiveRateByMember[m] = typeof effectiveRates[m] === "number" && Number.isFinite(effectiveRates[m])
          ? effectiveRates[m]
          : 1;
      });
      expenses.forEach((exp) => {
        if (!exp.targets || exp.targets.length === 0) return;
        const targetCount = exp.targets.length;
        const shareBefore = targetCount ? exp.amount / targetCount : 0;

        const weightsAfter = exp.targets.map((t) => {
          const r = effectiveRates[t];
          const rate = typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 1;
          return rate;
        });
        const totalWeightAfter = weightsAfter.reduce((a, b) => a + b, 0) || targetCount;

        if (exp.paidBy) {
          paid[exp.paidBy] = (paid[exp.paidBy] || 0) + (exp.amount || 0);
        }
        exp.targets.forEach((t, idx) => {
          shouldPayBeforeRate[t] = (shouldPayBeforeRate[t] || 0) + shareBefore;

          const r = effectiveRates[t];
          const rate = typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 1;
          const w = weightsAfter[idx];
          const shareAfter = totalWeightAfter ? (exp.amount * w) / totalWeightAfter : shareBefore;
          shouldPayAfterRate[t] = (shouldPayAfterRate[t] || 0) + shareAfter;
        });
      });
      members.forEach((m) => {
        const tr = document.createElement("tr");
        const tdName = document.createElement("td");
        const tdPaid = document.createElement("td");
        const tdShouldBefore = document.createElement("td");
        const tdRate = document.createElement("td");
        const tdShouldAfter = document.createElement("td");
        const tdNet = document.createElement("td");
        tdName.textContent = m;
        tdPaid.textContent = formatYen(paid[m] || 0);
        tdShouldBefore.textContent = formatYen(shouldPayBeforeRate[m] || 0);
        const rateVal = effectiveRateByMember[m];
        const rateBadge = document.createElement("span");
        rateBadge.textContent = rateVal.toFixed(2);
        applyRateBadge(rateBadge, rateVal);
        tdRate.appendChild(rateBadge);
        tdShouldAfter.textContent = formatYen(shouldPayAfterRate[m] || 0);
        const net = (paid[m] || 0) - (shouldPayAfterRate[m] || 0);
        tdNet.textContent = `${net >= 0 ? "+" : ""}${formatYen(net)}`;
        tr.appendChild(tdName);
        tr.appendChild(tdPaid);
        tr.appendChild(tdShouldBefore);
        tr.appendChild(tdRate);
        tr.appendChild(tdShouldAfter);
        tr.appendChild(tdNet);
        totalsBody.appendChild(tr);
      });
    }

    // 清算リスト
    settlementBody.innerHTML = "";
    if (expenses.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.textContent = "まだ立て替えが登録されていません。";
      tr.appendChild(td);
      settlementBody.appendChild(tr);
    } else {
      const settlement = calculateSettlement(members, expenses, effectiveRates);
      if (settlement.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 2;
        td.textContent = "すでに公平な状態です。誰も支払う必要はありません。";
        tr.appendChild(td);
        settlementBody.appendChild(tr);
      } else {
        settlement.forEach((s) => {
          const tr = document.createElement("tr");
          const tdDesc = document.createElement("td");
          const tdAmount = document.createElement("td");

          tdDesc.textContent = `${s.from} → ${s.to}`;
          tdAmount.textContent = formatYen(s.amount);

          tr.appendChild(tdDesc);
          tr.appendChild(tdAmount);
          settlementBody.appendChild(tr);
        });
      }
    }
    updateToggleLabel();
  }


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
        const badge = document.createElement("span");
        badge.textContent = capped[m].toFixed(2);
        applyRateBadge(badge, capped[m]);
        tdRate.appendChild(badge);
        tr.appendChild(tdName);
        tr.appendChild(tdRate);
        ratingsBody.appendChild(tr);
      });
    }
    if (ratingInfo) {
      ratingInfo.textContent = `${sourceLabel}（レートが高いほど支払額が多くなります）`;
    }
    return capped;
  }

  try {
    const doc = await window.db.collection("groups").doc(groupId).get();
    if (!doc.exists) {
      groupInfoEl.textContent = "グループが見つかりませんでした。";
      return;
    }
    const data = doc.data() || {};
    const members = data.members || [];
    const groupName = data.name || "無題のイベント";
    groupInfoEl.textContent = `グループ: ${groupName}（メンバー: ${members.join("、")}）`;
    upsertRecentGroup({ gid: groupId, name: groupName });

    const paymentWeights = data.paymentWeights || {};
    const sourceName = data.paymentWeightsSourceGameName || "";
    const sourceLabel = sourceName
      ? `最後に反映したゲーム: ${sourceName}`
      : "まだ確定済みゲームがありません";
    const baseRates = renderPaymentWeights({ paymentWeights, sourceLabel, members });

    latestState.members = members;
    latestState.baseRates = baseRates;

    window.db
      .collection("groups")
      .doc(groupId)
      .collection("expenses")
      .orderBy("createdAt", "asc")
      .onSnapshot(async (snapshot) => {
        const expenses = [];
        // 支払一覧は非表示のためテーブル操作はスキップ

        snapshot.forEach((d) => {
          const exp = d.data() || {};
          const record = {
            title: exp.title || "",
            amount: exp.amount || 0,
            paidBy: exp.paidBy || "",
            targets: exp.targets || [],
          };
          expenses.push(record);

        });

        // 粗相ペナルティ取得
        const penaltyRates = [];
        const penaltyExpenses = [];
        try {
          const sosouSnap = await window.db.collection("groups").doc(groupId).collection("sosou").get();
          sosouSnap.forEach((doc) => {
            const p = doc.data() || {};
            const member = p.member || "";
            if (p.penaltyType === "fine") {
              const amt = typeof p.amount === "number" && Number.isFinite(p.amount) ? p.amount : null;
              if (amt && member) {
                penaltyExpenses.push({
                  title: p.title ? `ペナルティ: ${p.title}` : "ペナルティ",
                  amount: amt,
                  paidBy: "",
                  targets: [member],
                });
              }
            } else if (p.penaltyType === "rate") {
              const mult =
                typeof p.rateMultiplier === "number" && Number.isFinite(p.rateMultiplier)
                  ? p.rateMultiplier
                  : resolvePenaltyMultiplier(p.penaltyValue);
              if (member && mult > 0) {
                penaltyRates.push({ member, rateMultiplier: mult, type: "rate" });
              }
            }
          });
        } catch (err) {
          console.error("[settlement] sosou fetch error", err);
        }

        latestState.expenses = expenses;
        latestState.penaltyRates = penaltyRates;
        latestState.penaltyExpenses = penaltyExpenses;
        renderSettlementAndTotals();
      });

    rateToggle?.addEventListener("change", () => {
      useRates = !!rateToggle.checked;
      renderSettlementAndTotals();
    });

    updateToggleLabel();
  } catch (err) {
    console.error("[settlement.js] グループ情報取得エラー", err);
    groupInfoEl.textContent = "グループ情報の取得に失敗しました。";
  }
});

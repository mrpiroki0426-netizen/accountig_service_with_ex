// js/sosou.js (clean)

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
      .filter((v) => v && typeof v.gid === "string" && v.gid.trim())
      .map((v) => ({
        gid: v.gid,
        name: typeof v.name === "string" ? v.name : "グループ",
        lastUsedAt: typeof v.lastUsedAt === "number" ? v.lastUsedAt : 0,
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

function formatTimestamp(ts) {
  if (!ts) return "";
  const date = ts instanceof Date ? ts : ts.toDate ? ts.toDate() : null;
  if (!date) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

function toggleClass(el, className, on) {
  if (!el) return;
  if (on) el.classList.add(className);
  else el.classList.remove(className);
}

document.addEventListener("DOMContentLoaded", () => {
  const groupId = getGroupIdFromQuery();
  const dbRef = (typeof window !== "undefined" && window.db) || (typeof db !== "undefined" ? db : null);
  if (!dbRef) {
    alert("Firestore(db) が見つかりません。js/firebase.js を確認してください。");
    return;
  }
  if (!groupId) {
    alert("グループIDが指定されていません。URLに ?gid= を付けてください。");
    return;
  }

  const groupInfoEl = document.getElementById("groupInfo");
  const sosouTitle = document.getElementById("sosouTitle");
  const sosouMember = document.getElementById("sosouMember");
  const addSosouBtn = document.getElementById("addSosouBtn");
  const sosouError = document.getElementById("sosouError");
  const sosouSuccess = document.getElementById("sosouSuccess");
  const sosouBody = document.getElementById("sosouBody");

  const rouletteModal = document.getElementById("rouletteModal");
  const rouletteOverlay = document.getElementById("rouletteOverlay");
  const rouletteCloseBtn = document.getElementById("rouletteCloseBtn");
  const rouletteCancelBtn = document.getElementById("rouletteCancelBtn");
  const rouletteSpinBtn = document.getElementById("rouletteSpinBtn");
  const rouletteResult = document.getElementById("rouletteResult");
  const rouletteHelper = document.getElementById("rouletteHelper");
  const rouletteWheel = document.getElementById("rouletteWheel");

  // サイドメニュー
  const menuButton = document.getElementById("menuButton");
  const sideMenu = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");
  const navToGroup = document.getElementById("navToGroup");
  const navToGame = document.getElementById("navToGame");
  const navToSosou = document.getElementById("navToSosou");
  const navToSettle = document.getElementById("navToSettle");
  const navToManage = document.getElementById("navToManage");
  const navToCreate = document.getElementById("navToCreate");

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
  navToSosou?.addEventListener("click", closeMenu);
  navToSettle?.addEventListener("click", () => (window.location.href = `settlement.html?gid=${groupId}`));
  navToManage?.addEventListener("click", () => (window.location.href = `manage.html?gid=${groupId}`));
  navToCreate?.addEventListener("click", () => (window.location.href = `app.html`));

  const groupDocRef = dbRef.collection("groups").doc(groupId);
  const sosouColRef = groupDocRef.collection("sosou");

  let members = [];
  let groupName = "無題のイベント";
  let pendingEntry = null;
  let pendingOutcome = null;
  let isSpinning = false;
  let currentRotation = 0;
  let hasSpun = false;

  function renderMemberSelect() {
    if (!sosouMember) return;
    sosouMember.innerHTML = "";
    if (!members.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "メンバーが登録されていません";
      opt.disabled = true;
      opt.selected = true;
      sosouMember.appendChild(opt);
    } else {
      members.forEach((m, idx) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (idx === 0) opt.selected = true;
        sosouMember.appendChild(opt);
      });
    }
  }

  groupDocRef.onSnapshot(
    (doc) => {
      if (!doc.exists) {
        if (groupInfoEl) {
          groupInfoEl.hidden = false;
          setText(groupInfoEl, "グループが見つかりませんでした。");
        }
        return;
      }
      const data = doc.data() || {};
      members = Array.isArray(data.members) ? data.members : [];
      groupName = data.name || "無題のイベント";
      if (groupInfoEl) {
        groupInfoEl.hidden = false;
        setText(groupInfoEl, `グループ: ${groupName}（メンバー: ${members.join("、")}）`);
      }
      upsertRecentGroup({ gid: groupId, name: groupName });
      renderMemberSelect();
    },
    (err) => {
      console.error("[sosou] group snapshot error", err);
      if (groupInfoEl) {
        groupInfoEl.hidden = false;
        setText(groupInfoEl, "グループ情報の取得に失敗しました。");
      }
    }
  );

  // 履歴表示
  sosouColRef
    .orderBy("createdAt", "desc")
    .limit(200)
    .onSnapshot(
      (snap) => {
        if (!sosouBody) return;
        sosouBody.innerHTML = "";
        if (snap.empty) {
          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = 4;
          td.className = "helper";
          td.textContent = "まだ記録がありません。";
          tr.appendChild(td);
          sosouBody.appendChild(tr);
          return;
        }

        snap.forEach((doc) => {
          const d = doc.data() || {};
          const title = d.title || "";
          const member = d.member || "";
          const amount = typeof d.amount === "number" && Number.isFinite(d.amount) ? d.amount : null;
          const occurredAt = d.occurredAt || d.createdAt || null;
          const penaltyType = d.penaltyType || "";
          const penaltyValue = d.penaltyValue;

          const tr = document.createElement("tr");

          const tdAt = document.createElement("td");
          tdAt.textContent = formatTimestamp(occurredAt) || "—";

          const tdMember = document.createElement("td");
          tdMember.textContent = member || "—";

          const tdTitle = document.createElement("td");
          tdTitle.textContent = title || "—";

          const tdAmount = document.createElement("td");
          if (penaltyType === "rate") {
            const mult = typeof d.rateMultiplier === "number" ? d.rateMultiplier : (1 - (penaltyValue || 0));
            tdAmount.textContent = `レート ×${mult.toFixed(1)}`;
          } else {
            tdAmount.textContent = amount === null ? "—" : `-${Math.round(amount)}`;
          }

          tr.appendChild(tdMember);
          tr.appendChild(tdTitle);
          tr.appendChild(tdAmount);
          tr.appendChild(tdAt);
          
          sosouBody.appendChild(tr);
        });
      },
      (err) => {
        console.error("[sosou] list snapshot error", err);
      }
    );

  // ルーレット
  function openRouletteModal() {
    setText(rouletteResult, "");
    setText(rouletteHelper, "ボタンを回すと、レート低下または罰金が決まります。");
    pendingOutcome = null;
    hasSpun = false;
    if (rouletteSpinBtn) rouletteSpinBtn.disabled = false;
    rouletteModal?.classList.add("open");
  }
  function closeRouletteModal() {
    rouletteModal?.classList.remove("open");
  }
  rouletteOverlay?.addEventListener("click", closeRouletteModal);
  rouletteCloseBtn?.addEventListener("click", closeRouletteModal);
  rouletteCancelBtn?.addEventListener("click", closeRouletteModal);

  const roulettePool = [
    { type: "rate", value: 0.1, label: "×0.9" },
    { type: "rate", value: 0.2, label: "×0.8" },
    { type: "rate", value: 0.3, label: "×0.7" },
    { type: "fine", value: 100, label: "-100円" },
    { type: "fine", value: 300, label: "-300円" },
    { type: "fine", value: 500, label: "-500円" },
  ];

  // ルーレット内のラベル配置
  (function renderRouletteLabels() {
    if (!rouletteWheel) return;
    rouletteWheel.innerHTML = "";
    const segmentAngle = 360 / roulettePool.length; // 60deg
    roulettePool.forEach((seg, idx) => {
      const angle = segmentAngle * idx + segmentAngle / 2;
      const span = document.createElement("span");
      span.className = "roulette-label";
      span.style.setProperty("--angle", `${angle}deg`);
      span.textContent = seg.label;
      rouletteWheel.appendChild(span);
    });
  })();

  rouletteSpinBtn?.addEventListener("click", () => {
    if (isSpinning || hasSpun) return;
    isSpinning = true;
    pendingOutcome = null;
    setText(rouletteResult, "");
    setText(rouletteHelper, "回転中...");

    const pick = roulettePool[Math.floor(Math.random() * roulettePool.length)];
    pendingOutcome = pick;

    const segmentAngle = 360 / roulettePool.length; // 60deg
    const segmentIndex = roulettePool.indexOf(pick);
    const segmentCenter = segmentIndex * segmentAngle + segmentAngle / 2;
    const extraTurns = 5 + Math.floor(Math.random() * 3); // 5-7回転
    currentRotation = currentRotation % 360;
    const targetRotation = currentRotation + extraTurns * 360 + (360 - segmentCenter);
    currentRotation = targetRotation;

    if (rouletteWheel) {
      rouletteWheel.style.transform = `rotate(${targetRotation}deg)`;
    }

    window.setTimeout(() => {
      setText(rouletteResult, `結果: ${pick.label}`);
      setText(rouletteHelper, "結果を反映しました。");
      hasSpun = true;
      if (rouletteSpinBtn) rouletteSpinBtn.disabled = true;
      isSpinning = false;
      saveSosouWithOutcome();
    }, 2100);
  });

  async function saveSosouWithOutcome() {
    if (!pendingEntry || !pendingOutcome) return;
    const isRate = pendingOutcome.type === "rate";
    const payload = {
      title: pendingEntry.title,
      member: pendingEntry.member,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      penaltyType: pendingOutcome.type,
      penaltyValue: pendingOutcome.value,
    };
    if (pendingOutcome.type === "fine") {
      payload.amount = pendingOutcome.value;
      payload.memo = `罰金 -${pendingOutcome.value} 円`;
    } else {
      payload.memo = `レート ×${(1 - pendingOutcome.value).toFixed(1)}`;
      payload.rateMultiplier = Number((1 - pendingOutcome.value).toFixed(1));
    }

    try {
      await sosouColRef.add(payload);
      if (sosouTitle) sosouTitle.value = "";
      setText(sosouSuccess, "記録しました。");
      window.setTimeout(() => setText(sosouSuccess, ""), 1500);
    } catch (err) {
      console.error("[sosou] add error", err);
      setText(sosouError, "記録に失敗しました。");
    } finally {
      closeRouletteModal();
      pendingEntry = null;
      pendingOutcome = null;
    }
  }

  addSosouBtn?.addEventListener("click", () => {
    setText(sosouError, "");
    setText(sosouSuccess, "");

    const title = (sosouTitle?.value || "").trim();
    const member = (sosouMember?.value || "").trim();

    if (!title) {
      setText(sosouError, "内容を入力してください。");
      return;
    }
    if (!member) {
      setText(sosouError, "対象メンバーを選択してください。");
      return;
    }

    pendingEntry = { title, member };
    openRouletteModal();
  });
});



// js/sosou.js

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
  const next = [{ gid, name: normalizedName, lastUsedAt: now }, ...current.filter((i) => i.gid !== gid)]
    .slice(0, MAX_RECENT_GROUPS);

  saveRecentGroups(next);
}

function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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

document.addEventListener("DOMContentLoaded", async () => {
  const groupId = getGroupIdFromQuery();

  const dbRef = (typeof window !== "undefined" && window.db) || (typeof db !== "undefined" ? db : null);
  if (!dbRef) {
    alert("Firestore(db) が見つかりません。js/firebase.js の読み込み順を確認してください。");
    return;
  }
  if (!groupId) {
    alert("グループIDが指定されていません。（URL に ?gid= が付いているか確認してください）");
    return;
  }

  const groupInfoEl = document.getElementById("groupInfo");
  const sosouTitle = document.getElementById("sosouTitle");
  const sosouMember = document.getElementById("sosouMember");
  const sosouAmount = document.getElementById("sosouAmount");
  const sosouOccurredAt = document.getElementById("sosouOccurredAt");
  const sosouMemo = document.getElementById("sosouMemo");
  const addSosouBtn = document.getElementById("addSosouBtn");
  const sosouError = document.getElementById("sosouError");
  const sosouSuccess = document.getElementById("sosouSuccess");
  const sosouBody = document.getElementById("sosouBody");

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
  navToSosou?.addEventListener("click", () => {
    closeMenu();
  });
  navToSettle?.addEventListener("click", () => {
    window.location.href = `settlement.html?gid=${groupId}`;
  });
  navToManage?.addEventListener("click", () => {
    window.location.href = `manage.html?gid=${groupId}`;
  });

  const groupDocRef = dbRef.collection("groups").doc(groupId);
  const sosouColRef = groupDocRef.collection("sosou");

  let members = [];
  let groupName = "無題のイベント";

  function renderMemberSelect() {
    if (!sosouMember) return;
    sosouMember.innerHTML = "";
    members.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      sosouMember.appendChild(opt);
    });
  }

  // グループ情報
  groupDocRef.onSnapshot(
    (doc) => {
      if (!doc.exists) {
        groupInfoEl && (groupInfoEl.textContent = "グループが見つかりませんでした。");
        return;
      }
      const data = doc.data() || {};
      members = Array.isArray(data.members) ? data.members : [];
      groupName = data.name || "無題のイベント";
      groupInfoEl && (groupInfoEl.textContent = `グループ：${groupName}（メンバー：${members.join("、")}）`);
      upsertRecentGroup({ gid: groupId, name: groupName });
      renderMemberSelect();
    },
    (err) => {
      console.error("[sosou.js] group onSnapshot error", err);
      groupInfoEl && (groupInfoEl.textContent = "グループ情報の取得に失敗しました。");
    }
  );

  // 一覧
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
          td.colSpan = 6;
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
          const memo = d.memo || "";
          const amount = typeof d.amount === "number" && Number.isFinite(d.amount) ? d.amount : null;
          const occurredAt = d.occurredAt || d.createdAt || null;

          const tr = document.createElement("tr");

          const tdAt = document.createElement("td");
          tdAt.textContent = formatTimestamp(occurredAt) || "—";

          const tdMember = document.createElement("td");
          tdMember.textContent = member || "—";

          const tdTitle = document.createElement("td");
          tdTitle.textContent = title || "—";

          const tdAmount = document.createElement("td");
          tdAmount.textContent = amount === null ? "—" : String(Math.round(amount));

          const tdMemo = document.createElement("td");
          tdMemo.textContent = memo || "";

          const tdActions = document.createElement("td");
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "secondary";
          delBtn.textContent = "削除";
          delBtn.addEventListener("click", async () => {
            const ok = window.confirm("この記録を削除しますか？");
            if (!ok) return;
            try {
              await sosouColRef.doc(doc.id).delete();
            } catch (err) {
              console.error("[sosou.js] delete error", err);
              alert("削除に失敗しました。");
            }
          });
          tdActions.appendChild(delBtn);

          tr.appendChild(tdAt);
          tr.appendChild(tdMember);
          tr.appendChild(tdTitle);
          tr.appendChild(tdAmount);
          tr.appendChild(tdMemo);
          tr.appendChild(tdActions);
          sosouBody.appendChild(tr);
        });
      },
      (err) => {
        console.error("[sosou.js] list onSnapshot error", err);
      }
    );

  addSosouBtn?.addEventListener("click", async () => {
    sosouError && (sosouError.textContent = "");
    sosouSuccess && (sosouSuccess.textContent = "");

    const title = (sosouTitle?.value || "").trim();
    const member = (sosouMember?.value || "").trim();
    const memo = (sosouMemo?.value || "").trim();
    const amount = toNumber(sosouAmount?.value, NaN);

    if (!title) {
      sosouError && (sosouError.textContent = "内容を入力してください。");
      return;
    }
    if (!member) {
      sosouError && (sosouError.textContent = "対象メンバーを選択してください。");
      return;
    }

    let occurredAt = null;
    const rawDate = (sosouOccurredAt?.value || "").trim();
    if (rawDate) {
      const d = new Date(rawDate);
      if (!Number.isNaN(d.getTime())) {
        occurredAt = firebase.firestore.Timestamp.fromDate(d);
      }
    }

    const payload = {
      title,
      member,
      memo,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (occurredAt) payload.occurredAt = occurredAt;
    if (Number.isFinite(amount)) payload.amount = amount;

    try {
      await sosouColRef.add(payload);

      if (sosouTitle) sosouTitle.value = "";
      if (sosouMemo) sosouMemo.value = "";
      if (sosouAmount) sosouAmount.value = "";
      if (sosouOccurredAt) sosouOccurredAt.value = "";

      sosouSuccess && (sosouSuccess.textContent = "登録しました。");
      window.setTimeout(() => {
        sosouSuccess && (sosouSuccess.textContent = "");
      }, 1500);
    } catch (err) {
      console.error("[sosou.js] add error", err);
      sosouError && (sosouError.textContent = "登録に失敗しました。");
    }
  });
});


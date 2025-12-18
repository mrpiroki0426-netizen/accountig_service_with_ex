// js/manage.js

const PAYMENT_WEIGHT_MIN = 0.5;
const PAYMENT_WEIGHT_MAX = 2.0;

function getGroupIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("gid");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getBasePath() {
  return window.location.pathname.replace(/[^/]*$/, "");
}

function buildGroupUrl(groupId) {
  return `${window.location.origin}${getBasePath()}group.html?gid=${encodeURIComponent(groupId)}`;
}

async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temp = document.createElement("textarea");
  temp.value = text;
  temp.style.position = "fixed";
  temp.style.left = "-9999px";
  document.body.appendChild(temp);
  temp.select();
  document.execCommand("copy");
  document.body.removeChild(temp);
}

function normalizeMemberName(value) {
  return (value || "").trim();
}

function replaceAll(list, from, to) {
  return list.map((v) => (v === from ? to : v));
}

function unique(list) {
  return Array.from(new Set(list));
}

async function commitInBatches({ db, ops }) {
  const BATCH_LIMIT = 450;
  let batch = db.batch();
  let count = 0;

  async function flush() {
    if (count === 0) return;
    await batch.commit();
    batch = db.batch();
    count = 0;
  }

  for (const op of ops) {
    if (op.type === "set") {
      batch.set(op.ref, op.data, op.options || {});
    } else if (op.type === "update") {
      batch.update(op.ref, op.data);
    } else if (op.type === "delete") {
      batch.delete(op.ref);
    }
    count++;
    if (count >= BATCH_LIMIT) {
      await flush();
    }
  }

  await flush();
}

async function renameMemberEverywhere({ db, groupRef, groupId, fromName, toName }) {
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) throw new Error("group not found");
  const groupData = groupSnap.data() || {};

  const members = Array.isArray(groupData.members) ? groupData.members : [];
  if (!members.includes(fromName)) throw new Error("member not found");
  if (members.includes(toName)) throw new Error("member already exists");

  const nextMembers = replaceAll(members, fromName, toName);

  const nextPaymentWeights = { ...(groupData.paymentWeights || {}) };
  if (Object.prototype.hasOwnProperty.call(nextPaymentWeights, fromName)) {
    nextPaymentWeights[toName] = nextPaymentWeights[fromName];
    delete nextPaymentWeights[fromName];
  } else {
    nextPaymentWeights[toName] = 1;
  }

  // Subcollections
  const expensesSnap = await groupRef.collection("expenses").get();
  const gamesSnap = await groupRef.collection("games").get();
  const liveGameRef = groupRef.collection("liveGame").doc("current");
  const liveGameSnap = await liveGameRef.get();

  const ops = [];

  // group doc update
  ops.push({
    type: "set",
    ref: groupRef,
    data: {
      members: nextMembers,
      paymentWeights: nextPaymentWeights,
    },
    options: { merge: true },
  });

  expensesSnap.forEach((doc) => {
    const data = doc.data() || {};
    const update = {};
    let changed = false;

    if (data.paidBy === fromName) {
      update.paidBy = toName;
      changed = true;
    }

    if (Array.isArray(data.targets) && data.targets.includes(fromName)) {
      update.targets = replaceAll(data.targets, fromName, toName);
      changed = true;
    }

    if (changed) {
      ops.push({ type: "update", ref: doc.ref, data: update });
    }
  });

  gamesSnap.forEach((doc) => {
    const data = doc.data() || {};
    const update = {};
    let changed = false;

    function renameKey(obj) {
      if (!obj || typeof obj !== "object") return null;
      if (!Object.prototype.hasOwnProperty.call(obj, fromName)) return null;
      const next = { ...obj };
      next[toName] = next[fromName];
      delete next[fromName];
      return next;
    }

    const nextScores = renameKey(data.scores);
    if (nextScores) {
      update.scores = nextScores;
      changed = true;
    }

    const nextFactors = renameKey(data.ratingFactors);
    if (nextFactors) {
      update.ratingFactors = nextFactors;
      changed = true;
    }

    const nextApplied = renameKey(data.ratingWeightsApplied);
    if (nextApplied) {
      update.ratingWeightsApplied = nextApplied;
      changed = true;
    }

    const nextTotals = renameKey(data.totalScores);
    if (nextTotals) {
      update.totalScores = nextTotals;
      changed = true;
    }

    if (Array.isArray(data.rounds) && data.rounds.length > 0) {
      const nextRounds = data.rounds.map((r) => {
        const scores = r?.scores;
        const nextScores = renameKey(scores);
        return nextScores ? { ...r, scores: nextScores } : r;
      });
      update.rounds = nextRounds;
      changed = true;
    }

    if (changed) {
      ops.push({ type: "update", ref: doc.ref, data: update });
    }
  });

  if (liveGameSnap.exists) {
    const data = liveGameSnap.data() || {};
    if (data.scores && typeof data.scores === "object" && Object.prototype.hasOwnProperty.call(data.scores, fromName)) {
      const next = { ...data.scores };
      next[toName] = next[fromName];
      delete next[fromName];
      ops.push({ type: "update", ref: liveGameRef, data: { scores: next } });
    }
  }

  await commitInBatches({ db, ops });
}

async function addMemberToGroup({ db, groupRef, name }) {
  const snap = await groupRef.get();
  if (!snap.exists) throw new Error("group not found");
  const data = snap.data() || {};
  const members = Array.isArray(data.members) ? data.members : [];
  if (members.includes(name)) throw new Error("member already exists");

  const paymentWeights = { ...(data.paymentWeights || {}) };
  paymentWeights[name] = clamp(paymentWeights[name] ?? 1, PAYMENT_WEIGHT_MIN, PAYMENT_WEIGHT_MAX);

  await groupRef.set(
    {
      members: [...members, name],
      paymentWeights,
    },
    { merge: true }
  );
}

async function deleteMemberEverywhere({ db, groupRef, groupId, name }) {
  const snap = await groupRef.get();
  if (!snap.exists) throw new Error("group not found");
  const data = snap.data() || {};
  const members = Array.isArray(data.members) ? data.members : [];
  if (!members.includes(name)) throw new Error("member not found");
  if (members.length <= 1) throw new Error("last member cannot be deleted");

  // paidBy に使われていたら危険なのでブロック（置換してから削除してもらう）
  const expensesSnap = await groupRef.collection("expenses").get();
  for (const doc of expensesSnap.docs) {
    const exp = doc.data() || {};
    if (exp.paidBy === name) {
      throw new Error("member is used as paidBy");
    }
  }

  const nextMembers = members.filter((m) => m !== name);

  const nextPaymentWeights = { ...(data.paymentWeights || {}) };
  delete nextPaymentWeights[name];

  const gamesSnap = await groupRef.collection("games").get();
  const liveGameRef = groupRef.collection("liveGame").doc("current");
  const liveGameSnap = await liveGameRef.get();

  const ops = [];
  ops.push({
    type: "set",
    ref: groupRef,
    data: { members: nextMembers, paymentWeights: nextPaymentWeights },
    options: { merge: true },
  });

  // expenses: targets から削除
  expensesSnap.forEach((doc) => {
    const exp = doc.data() || {};
    if (!Array.isArray(exp.targets) || !exp.targets.includes(name)) return;
    const nextTargets = exp.targets.filter((t) => t !== name);
    ops.push({ type: "update", ref: doc.ref, data: { targets: nextTargets } });
  });

  // games/liveGame: scores から削除
  function removeKey(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (!Object.prototype.hasOwnProperty.call(obj, name)) return null;
    const next = { ...obj };
    delete next[name];
    return next;
  }

  gamesSnap.forEach((doc) => {
    const game = doc.data() || {};
    const update = {};
    let changed = false;

    const nextScores = removeKey(game.scores);
    if (nextScores) {
      update.scores = nextScores;
      changed = true;
    }
    const nextFactors = removeKey(game.ratingFactors);
    if (nextFactors) {
      update.ratingFactors = nextFactors;
      changed = true;
    }
    const nextApplied = removeKey(game.ratingWeightsApplied);
    if (nextApplied) {
      update.ratingWeightsApplied = nextApplied;
      changed = true;
    }

    const nextTotals = removeKey(game.totalScores);
    if (nextTotals) {
      update.totalScores = nextTotals;
      changed = true;
    }

    if (Array.isArray(game.rounds) && game.rounds.length > 0) {
      const nextRounds = game.rounds.map((r) => {
        const scores = r?.scores;
        const nextScores = removeKey(scores);
        return nextScores ? { ...r, scores: nextScores } : r;
      });
      update.rounds = nextRounds;
      changed = true;
    }
    if (changed) {
      ops.push({ type: "update", ref: doc.ref, data: update });
    }
  });

  if (liveGameSnap.exists) {
    const live = liveGameSnap.data() || {};
    const nextScores = removeKey(live.scores);
    if (nextScores) {
      ops.push({ type: "update", ref: liveGameRef, data: { scores: nextScores } });
    }
  }

  await commitInBatches({ db, ops });
}

document.addEventListener("DOMContentLoaded", async () => {
  const groupId = getGroupIdFromQuery();
  if (!groupId) {
    alert("グループIDが指定されていません。（URL に ?gid= が付いているか確認してください）");
    return;
  }

  const dbRef =
    (typeof window !== "undefined" && window.db) ||
    (typeof db !== "undefined" ? db : null);

  if (!dbRef) {
    alert("Firestore(db) が見つかりません。js/firebase.js の読み込み順を確認してください。");
    return;
  }

  const groupRef = dbRef.collection("groups").doc(groupId);

  const groupInfoEl = document.getElementById("groupInfo");
  const membersListEl = document.getElementById("membersList");
  const newMemberNameEl = document.getElementById("newMemberName");
  const addMemberBtn = document.getElementById("addMemberBtn");
  const memberErrorEl = document.getElementById("memberError");
  const memberSuccessEl = document.getElementById("memberSuccess");

  const shareUrlInput = document.getElementById("shareUrl");
  const shareUrlMessage = document.getElementById("shareUrlMessage");
  const copyShareUrlBtn = document.getElementById("copyShareUrlBtn");
  const shareShareUrlBtn = document.getElementById("shareShareUrlBtn");

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
  navToSettle?.addEventListener("click", () => {
    window.location.href = `settlement.html?gid=${groupId}`;
  });
  navToManage?.addEventListener("click", closeMenu);

  const shareUrl = buildGroupUrl(groupId);
  if (shareUrlInput) shareUrlInput.value = shareUrl;

  copyShareUrlBtn?.addEventListener("click", async () => {
    if (!shareUrlInput) return;
    shareUrlMessage && (shareUrlMessage.textContent = "");
    try {
      await copyToClipboard(shareUrlInput.value);
      shareUrlMessage && (shareUrlMessage.textContent = "コピーしました。");
    } catch (err) {
      console.error("[manage.js] copy error", err);
      shareUrlMessage && (shareUrlMessage.textContent = "コピーに失敗しました。");
    }
  });

  shareShareUrlBtn?.addEventListener("click", async () => {
    if (!shareUrlInput) return;
    shareUrlMessage && (shareUrlMessage.textContent = "");
    const url = shareUrlInput.value;
    const shareData = {
      title: "グループ共有URL",
      text: "このグループを共有します。",
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        shareUrlMessage && (shareUrlMessage.textContent = "共有シートを開きました。");
        return;
      } catch (err) {
        console.warn("[manage.js] navigator.share error/cancel", err);
      }
    }
    try {
      await copyToClipboard(url);
      shareUrlMessage && (shareUrlMessage.textContent = "コピーしました。");
    } catch (err) {
      console.error("[manage.js] share fallback copy error", err);
      shareUrlMessage && (shareUrlMessage.textContent = "コピーに失敗しました。");
    }
  });

  function setMessage({ error, success }) {
    if (memberErrorEl) memberErrorEl.textContent = error || "";
    if (memberSuccessEl) memberSuccessEl.textContent = success || "";
  }

  function renderMembers({ members }) {
    if (!membersListEl) return;
    membersListEl.innerHTML = "";

    members.forEach((name) => {
      const li = document.createElement("li");
      li.className = "manage-member-item";

      const input = document.createElement("input");
      input.type = "text";
      input.value = name;
      input.setAttribute("aria-label", `メンバー名 ${name}`);

      const actions = document.createElement("div");
      actions.className = "manage-member-actions";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "secondary";
      saveBtn.textContent = "保存";
      saveBtn.addEventListener("click", async () => {
        setMessage({ error: "", success: "" });
        const next = normalizeMemberName(input.value);
        if (!next) {
          setMessage({ error: "メンバー名を入力してください。", success: "" });
          input.value = name;
          return;
        }
        if (next === name) {
          setMessage({ error: "", success: "変更はありません。" });
          return;
        }
        try {
          await renameMemberEverywhere({ db: dbRef, groupRef, groupId, fromName: name, toName: next });
          setMessage({ error: "", success: "変更しました。" });
        } catch (err) {
          console.error("[manage.js] rename error", err);
          setMessage({
            error:
              err?.message === "member already exists"
                ? "同じ名前のメンバーが既にいます。"
                : "変更に失敗しました。",
            success: "",
          });
        }
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "secondary";
      deleteBtn.textContent = "削除";
      deleteBtn.addEventListener("click", async () => {
        setMessage({ error: "", success: "" });
        const ok = window.confirm(`「${name}」を削除しますか？`);
        if (!ok) return;
        try {
          await deleteMemberEverywhere({ db: dbRef, groupRef, groupId, name });
          setMessage({ error: "", success: "削除しました。" });
        } catch (err) {
          console.error("[manage.js] delete error", err);
          const msg =
            err?.message === "member is used as paidBy"
              ? "このメンバーは「支払った人」で使われています。先に支払いレコードの支払った人を変更してください。"
              : "削除に失敗しました。";
          setMessage({ error: msg, success: "" });
        }
      });

      actions.appendChild(saveBtn);
      actions.appendChild(deleteBtn);

      li.appendChild(input);
      li.appendChild(actions);
      membersListEl.appendChild(li);
    });
  }

  async function refresh() {
    setMessage({ error: "", success: "" });
    const snap = await groupRef.get();
    if (!snap.exists) {
      groupInfoEl && (groupInfoEl.textContent = "グループが見つかりませんでした。");
      return;
    }
    const data = snap.data() || {};
    const groupName = data.name || "無題のイベント";
    const members = Array.isArray(data.members) ? data.members : [];
    groupInfoEl && (groupInfoEl.textContent = `グループ：${groupName}（メンバー：${members.join("、")}）`);
    renderMembers({ members });
  }

  addMemberBtn?.addEventListener("click", async () => {
    setMessage({ error: "", success: "" });
    const name = normalizeMemberName(newMemberNameEl?.value);
    if (!name) {
      setMessage({ error: "メンバー名を入力してください。", success: "" });
      return;
    }
    try {
      await addMemberToGroup({ db: dbRef, groupRef, name });
      if (newMemberNameEl) newMemberNameEl.value = "";
      setMessage({ error: "", success: "追加しました。" });
      await refresh();
    } catch (err) {
      console.error("[manage.js] add member error", err);
      setMessage({
        error: err?.message === "member already exists" ? "同じ名前のメンバーが既にいます。" : "追加に失敗しました。",
        success: "",
      });
    }
  });

  newMemberNameEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addMemberBtn?.click();
    }
  });

  await refresh();
});

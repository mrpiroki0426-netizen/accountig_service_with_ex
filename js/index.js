// js/index.js

document.addEventListener("DOMContentLoaded", () => {
  const RECENT_GROUPS_KEY = "yamican.recentGroups.v1";
  const MAX_RECENT_GROUPS = 8;

  const eventNameInput = document.getElementById("eventName");

  const memberNameInput = document.getElementById("memberName");
  const addMemberBtn = document.getElementById("addMemberBtn");
  const memberListEl = document.getElementById("memberList");

  const createGroupBtn = document.getElementById("createGroupBtn");
  const errorMessage = document.getElementById("errorMessage");

  const recentGroupsListEl = document.getElementById("recentGroupsList");
  const recentGroupsEmptyEl = document.getElementById("recentGroupsEmpty");
  const clearRecentGroupsBtn = document.getElementById("clearRecentGroupsBtn");

  const shareModalEl = document.getElementById("shareModal");
  const shareModalOverlayEl = document.getElementById("shareModalOverlay");
  const shareModalCloseBtn = document.getElementById("shareModalCloseBtn");
  const shareModalUrlEl = document.getElementById("shareModalUrl");
  const shareModalMessageEl = document.getElementById("shareModalMessage");
  const shareModalCopyBtn = document.getElementById("shareModalCopyBtn");
  const shareModalOpenBtn = document.getElementById("shareModalOpenBtn");

  const members = [];

  function buildGroupUrl(groupId) {
    const basePath = window.location.pathname.replace(/[^/]*$/, "");
    return `${window.location.origin}${basePath}group.html?gid=${encodeURIComponent(groupId)}`;
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
    renderRecentGroups(next);
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

  function openShareModal({ url, onOpen }) {
    if (!shareModalEl || !shareModalUrlEl) return false;
    shareModalEl.classList.add("open");
    shareModalEl.setAttribute("aria-hidden", "false");
    if (shareModalMessageEl) shareModalMessageEl.textContent = "";
    shareModalUrlEl.value = url;

    const close = () => {
      shareModalEl.classList.remove("open");
      shareModalEl.setAttribute("aria-hidden", "true");
    };

    const handleOverlay = () => close();
    const handleClose = () => close();
    const handleCopy = async () => {
      if (!shareModalUrlEl) return;
      if (shareModalMessageEl) shareModalMessageEl.textContent = "";
      try {
        await copyToClipboard(shareModalUrlEl.value);
        if (shareModalMessageEl) shareModalMessageEl.textContent = "コピーしました。";
      } catch (e) {
        console.error("[index.js] copy failed", e);
        if (shareModalMessageEl) shareModalMessageEl.textContent = "コピーに失敗しました。";
      }
    };
    const handleOpen = () => {
      close();
      onOpen?.();
    };

    shareModalOverlayEl?.addEventListener("click", handleOverlay, { once: true });
    shareModalCloseBtn?.addEventListener("click", handleClose, { once: true });
    shareModalCopyBtn?.addEventListener("click", handleCopy);
    shareModalOpenBtn?.addEventListener("click", handleOpen, { once: true });

    // Escapeで閉じる（1回だけ）
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown, { once: true });

    return true;
  }

  function formatRelativeTime(ms) {
    if (!ms) return "";
    const diffSec = Math.floor((Date.now() - ms) / 1000);
    if (diffSec < 60) return "たった今";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}時間前`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}日前`;
  }

  function renderRecentGroups(groups = loadRecentGroups()) {
    if (!recentGroupsListEl || !recentGroupsEmptyEl) return;

    recentGroupsListEl.innerHTML = "";

    const hasAny = groups.length > 0;
    recentGroupsEmptyEl.style.display = hasAny ? "none" : "block";
    if (clearRecentGroupsBtn) {
      clearRecentGroupsBtn.style.display = hasAny ? "inline-block" : "none";
    }

    groups.forEach(group => {
      const li = document.createElement("li");
      li.className = "recent-group-item";

      const left = document.createElement("div");
      left.style.minWidth = "0";

      const a = document.createElement("a");
      a.className = "recent-group-link";
      a.href = `manage.html?gid=${encodeURIComponent(group.gid)}`;
      a.textContent = group.name || "グループ";

      const meta = document.createElement("div");
      meta.className = "recent-group-meta";
      meta.textContent = formatRelativeTime(group.lastUsedAt);

      left.appendChild(a);
      if (meta.textContent) left.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "recent-group-actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "secondary";
      copyBtn.textContent = "URLコピー";
      copyBtn.addEventListener("click", async () => {
        try {
          await copyToClipboard(buildGroupUrl(group.gid));
          copyBtn.textContent = "コピーしました";
          setTimeout(() => {
            copyBtn.textContent = "URLコピー";
          }, 1200);
        } catch (e) {
          console.error("[index.js] copy failed", e);
          copyBtn.textContent = "失敗しました";
          setTimeout(() => {
            copyBtn.textContent = "URLコピー";
          }, 1200);
        }
      });

      actions.appendChild(copyBtn);

      li.appendChild(left);
      li.appendChild(actions);

      recentGroupsListEl.appendChild(li);
    });
  }

  function renderMembers() {
    memberListEl.innerHTML = "";

    if (members.length === 0) {
      const li = document.createElement("li");
      li.textContent = "まだメンバーが追加されていません";
      li.style.color = "#6b7280";
      memberListEl.appendChild(li);
      return;
    }

    members.forEach(name => {
      const li = document.createElement("li");
      li.textContent = name;
      memberListEl.appendChild(li);
    });
  }

  renderMembers();
  renderRecentGroups();

  clearRecentGroupsBtn?.addEventListener("click", () => {
    saveRecentGroups([]);
    renderRecentGroups([]);
  });

  addMemberBtn.addEventListener("click", () => {
    const name = memberNameInput.value.trim();
    errorMessage.textContent = "";

    if (!name) {
      errorMessage.textContent = "メンバー名を入力してください。";
      return;
    }

    if (members.includes(name)) {
      errorMessage.textContent = "同じメンバーがすでに追加されています。";
      return;
    }

    members.push(name);
    memberNameInput.value = "";
    renderMembers();
  });

  memberNameInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      addMemberBtn.click();
    }
  });

  createGroupBtn.addEventListener("click", async () => {
    errorMessage.textContent = "";

    const name = eventNameInput.value.trim();

    if (!name) {
      errorMessage.textContent = "イベント名を入力してください。";
      return;
    }

    if (members.length === 0) {
      errorMessage.textContent = "メンバーを1人以上追加してください。";
      return;
    }

    try {
      // authReady は js/firebase.js でセットされる匿名サインイン完了待ち
      if (window.authReady) {
        try {
          await window.authReady;
        } catch (e) {
          console.warn("[index.js] authReady wait failed, continue as is", e);
        }
      }

      const docRef = await window.db.collection("groups").add({
        name,
        members,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      upsertRecentGroup({ gid: docRef.id, name });

      const groupUrl = buildGroupUrl(docRef.id);
      const opened = openShareModal({
        url: groupUrl,
        onOpen: () => {
          window.location.href = `manage.html?gid=${docRef.id}`;
        }
      });

      if (!opened) {
        window.location.href = `manage.html?gid=${docRef.id}`;
      }
    } catch (err) {
      console.error(err);
      errorMessage.textContent =
        "グループ作成に失敗しました。時間をおいて再度お試しください。";
    }
  });

  // ===== ハンバーガーメニュー =====
  const menuButton = document.getElementById("menuButton");
  const sideMenu = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");

  const navToGroup = document.getElementById("navToGroup");
  const navToGame = document.getElementById("navToGame");
  const navToAbout = document.getElementById("navToAbout");
  const navToContact = document.getElementById("navToContact");

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
  navToGame?.addEventListener("click", closeMenu);
  navToAbout?.addEventListener("click", () => {
    window.location.href = "about.html";
  });
  // navToContact removed
});

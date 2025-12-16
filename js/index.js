// js/index.js

document.addEventListener("DOMContentLoaded", () => {
  const eventNameInput = document.getElementById("eventName");

  const memberNameInput = document.getElementById("memberName");
  const addMemberBtn = document.getElementById("addMemberBtn");
  const memberListEl = document.getElementById("memberList");

  const createGroupBtn = document.getElementById("createGroupBtn");
  const errorMessage = document.getElementById("errorMessage");

  const members = [];

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
      const docRef = await window.db.collection("groups").add({
        name,
        members,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      window.location.href = `group.html?gid=${docRef.id}`;
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

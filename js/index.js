// js/index.js

document.addEventListener("DOMContentLoaded", () => {
  const eventNameInput = document.getElementById("eventName");

  // ★ 追加：メンバー関連の要素
  const memberNameInput = document.getElementById("memberName");
  const addMemberBtn = document.getElementById("addMemberBtn");
  const memberListEl = document.getElementById("memberList");

  const createGroupBtn = document.getElementById("createGroupBtn");
  const errorMessage = document.getElementById("errorMessage");

  // ★ 追加：メンバーを配列で管理
  const members = [];

  // メンバー一覧の描画関数
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

  // ページ読み込み時に一度描画
  renderMembers();

  // 「メンバー追加」ボタン
  addMemberBtn.addEventListener("click", () => {
    const name = memberNameInput.value.trim();
    errorMessage.textContent = "";

    if (!name) {
      errorMessage.textContent = "メンバー名を入力してください。";
      return;
    }

    // 重複チェック（必要なければifごと消してOK）
    if (members.includes(name)) {
      errorMessage.textContent = "同じメンバーがすでに追加されています。";
      return;
    }

    members.push(name);
    memberNameInput.value = "";
    renderMembers();
  });

  // Enterキーで追加できるようにする（お好みで）
  memberNameInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      addMemberBtn.click();
    }
  });

  // 「グループ作成」ボタン
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
      // Firestore に groups ドキュメントを作成
      const docRef = await db.collection("groups").add({
        name,
        members,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      const groupId = docRef.id;
      console.log("[index.js] グループ作成成功 groupId =", groupId);

      // 今は挙動確認しやすいように alert
      // 問題なければ group.html に飛ばす
      window.location.href = `group.html?gid=${groupId}`;
    } catch (err) {
      console.error("[index.js] グループ作成エラー", err);
      errorMessage.textContent =
        "グループ作成に失敗しました。時間をおいて再度お試しください。";
    }
  });
});

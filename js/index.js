// js/index.js

document.addEventListener("DOMContentLoaded", () => {
  const eventNameInput = document.getElementById("eventName");
  const membersTextarea = document.getElementById("members");
  const createGroupBtn = document.getElementById("createGroupBtn");
  const errorMessage = document.getElementById("errorMessage");

  createGroupBtn.addEventListener("click", async () => {
    errorMessage.textContent = "";

    const name = eventNameInput.value.trim();
    const membersText = membersTextarea.value.trim();

    if (!name) {
      errorMessage.textContent = "イベント名を入力してください。";
      return;
    }
    if (!membersText) {
      errorMessage.textContent = "メンバーを1人以上入力してください。";
      return;
    }

    const members = membersText
      .split("\n")
      .map(m => m.trim())
      .filter(m => m.length > 0);

    if (members.length === 0) {
      errorMessage.textContent = "メンバーを1人以上入力してください。";
      return;
    }

    try {
      // groups コレクションに新規ドキュメントを作成
      const docRef = await db.collection("groups").add({
        name,
        members,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      const groupId = docRef.id;

      // group.html に遷移（クエリパラメータでIDを渡す）
      window.location.href = `group.html?gid=${groupId}`;
    } catch (err) {
      console.error(err);
      errorMessage.textContent = "グループ作成に失敗しました。時間をおいて再度お試しください。";
    }
  });
});

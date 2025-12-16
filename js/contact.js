// js/contact.js

document.addEventListener("DOMContentLoaded", () => {
  const nameInput    = document.getElementById("contactName");
  const emailInput   = document.getElementById("contactEmail");
  const messageInput = document.getElementById("contactMessage");
  const submitBtn    = document.getElementById("contactSubmitBtn");
  const errorEl      = document.getElementById("contactError");
  const successEl    = document.getElementById("contactSuccess");

  // ===== フォーム送信 =====
  submitBtn.addEventListener("click", async () => {
    errorEl.textContent   = "";
    successEl.textContent = "";

    const name    = nameInput.value.trim();
    const email   = emailInput.value.trim();
    const message = messageInput.value.trim();

    if (!message) {
      errorEl.textContent = "お問い合わせ内容を入力してください。";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "送信中...";

    try {
      await window.db.collection("contacts").add({
        name,
        email,
        message,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      successEl.textContent = "送信しました。ご連絡ありがとうございます！";
      nameInput.value = "";
      emailInput.value = "";
      messageInput.value = "";
    } catch (err) {
      console.error("[contact.js] お問い合わせ送信エラー", err);
      errorEl.textContent = "送信に失敗しました。時間をおいて再度お試しください。";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送信する";
    }
  });

  // ===== ハンバーガーメニュー制御 & ナビゲーション =====
  const menuButton      = document.getElementById("menuButton");
  const sideMenu        = document.getElementById("sideMenu");
  const sideMenuOverlay = document.getElementById("sideMenuOverlay");
  const closeMenuButton = document.getElementById("closeMenuButton");

  const navToGroup   = document.getElementById("navToGroup");
  const navToGame    = document.getElementById("navToGame");
  const navToAbout   = document.getElementById("navToAbout");
  const navToContact = document.getElementById("navToContact");

  function openMenu()  { sideMenu?.classList.add("open"); }
  function closeMenu() { sideMenu?.classList.remove("open"); }

  menuButton?.addEventListener("click", openMenu);
  closeMenuButton?.addEventListener("click", closeMenu);
  sideMenuOverlay?.addEventListener("click", closeMenu);

  navToGroup?.addEventListener("click", () => { window.location.href = "index.html"; });
  navToGame?.addEventListener("click", ()  => { window.location.href = "index.html"; });
  // navToAbout and navToContact removed
});

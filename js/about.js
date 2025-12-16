// js/about.js

document.addEventListener("DOMContentLoaded", () => {
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

  // このページからは gid が分からないので、勘定/ゲームはトップへ飛ばす
  navToGroup?.addEventListener("click", () => { window.location.href = "index.html"; });
  navToGame?.addEventListener("click", ()  => { window.location.href = "index.html"; });
  navToAbout?.addEventListener("click", () => { closeMenu(); });
  navToContact?.addEventListener("click", () => { window.location.href = "contact.html"; });
});

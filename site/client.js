// 既読/未読は localStorage のみで管理する(サーバー側には持たせない)。
// NFR-32: ブラウザ(端末)ごとに独立するため、将来同じページを他の人に見せても影響しない。

function getSeenIds() {
  try {
    return JSON.parse(localStorage.getItem("seenTileIds") || "[]");
  } catch {
    return [];
  }
}

function markSeenInStorage(tileId) {
  try {
    const seenIds = getSeenIds();
    if (!seenIds.includes(tileId)) {
      seenIds.push(tileId);
      localStorage.setItem("seenTileIds", JSON.stringify(seenIds));
    }
  } catch {
    /* localStorageが使えない場合は何もしない(未読表示のまま) */
  }
}

function markSeenInDom(el) {
  el.classList.remove("is-new");
  el.classList.add("is-seen");
  const chip = el.querySelector(".new-chip");
  if (chip) chip.remove();
}

function initTiles() {
  const seenIds = getSeenIds();

  document.querySelectorAll(".tile[data-tile-id]").forEach((el) => {
    if (seenIds.includes(el.dataset.tileId)) {
      markSeenInDom(el);
    }

    el.addEventListener("click", () => {
      markSeenInStorage(el.dataset.tileId);
      markSeenInDom(el);
      const url = el.dataset.url;
      if (url) {
        location.href = url;
      }
    });
  });
}

function initCollapseSections() {
  const seenIds = getSeenIds();

  document.querySelectorAll(".collapse-toggle").forEach((btn) => {
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;

    const unreadCount = Array.from(
      target.querySelectorAll(".tile[data-tile-id]")
    ).filter((el) => !seenIds.includes(el.dataset.tileId)).length;

    const badge = btn.querySelector(".unread-badge");
    if (badge && unreadCount > 0) {
      badge.textContent = `(未読 ${unreadCount}件)`;
      badge.hidden = false;
    }

    btn.addEventListener("click", () => {
      const collapsed = target.classList.toggle("is-collapsed");
      const icon = btn.querySelector(".toggle-icon");
      if (icon) icon.textContent = collapsed ? "▼" : "▲";
    });
  });
}

initTiles();
initCollapseSections();

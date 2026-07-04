let lockedY = 0;
let lockCount = 0;

/** Bloque le scroll de la page quand un panneau plein écran est ouvert. */
export function lockPageScroll() {
  if (lockCount === 0) {
    lockedY = window.scrollY;
    document.body.style.top = `-${lockedY}px`;
    document.body.classList.add("panel-open");
  }
  lockCount += 1;
}

export function unlockPageScroll() {
  if (lockCount <= 0) return;
  lockCount -= 1;
  if (lockCount > 0) return;
  document.body.classList.remove("panel-open");
  document.body.style.top = "";
  window.scrollTo(0, lockedY);
}

/** Redirige la molette vers le conteneur scrollable du panneau. */
export function bindPanelWheel(panel: HTMLElement, getScroller: () => HTMLElement | null) {
  const onWheel = (e: WheelEvent) => {
    const scroller = getScroller();
    if (!scroller) {
      e.preventDefault();
      return;
    }

    const max = scroller.scrollHeight - scroller.clientHeight;
    if (max <= 1) {
      e.preventDefault();
      return;
    }

    const next = scroller.scrollTop + e.deltaY;
    const atTop = scroller.scrollTop <= 0 && e.deltaY < 0;
    const atBottom = scroller.scrollTop >= max && e.deltaY > 0;
    if (atTop || atBottom) {
      e.preventDefault();
      return;
    }

    scroller.scrollTop = Math.max(0, Math.min(max, next));
    e.preventDefault();
  };

  panel.addEventListener("wheel", onWheel, { passive: false });
  return () => panel.removeEventListener("wheel", onWheel);
}

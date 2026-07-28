/**
 * Calculateur de fuite — tableau détaillé Aujourd'hui / Avec système.
 * Modèle conservateur : close système volontairement baissé, jamais sous le mix actuel.
 */
export function bindLeakCalc(root: HTMLElement | null) {
  if (!root) return;

  const leadsEl = root.querySelector<HTMLInputElement>("#calc-leads");
  const basketEl = root.querySelector<HTMLInputElement>("#calc-basket");
  const fastEl = root.querySelector<HTMLInputElement>("#calc-fast");
  const closeHotEl = root.querySelector<HTMLInputElement>("#calc-close-hot");
  const closeCoolEl = root.querySelector<HTMLInputElement>("#calc-close-cool");
  if (!leadsEl || !basketEl || !fastEl || !closeHotEl || !closeCoolEl) return;

  const out = {
    leads: root.querySelector("#calc-leads-val"),
    basket: root.querySelector("#calc-basket-val"),
    fast: root.querySelector("#calc-fast-val"),
    closeHot: root.querySelector("#calc-close-hot-val"),
    closeCool: root.querySelector("#calc-close-cool-val"),
    closeSys: root.querySelector("#calc-close-sys"),
    rowLeadsNow: root.querySelector("#calc-row-leads-now"),
    rowLeadsSys: root.querySelector("#calc-row-leads-sys"),
    rowFastNow: root.querySelector("#calc-row-fast-now"),
    rowFastSys: root.querySelector("#calc-row-fast-sys"),
    rowLateNow: root.querySelector("#calc-row-late-now"),
    rowLateSys: root.querySelector("#calc-row-late-sys"),
    rowHotNow: root.querySelector("#calc-row-hot-now"),
    rowHotSys: root.querySelector("#calc-row-hot-sys"),
    rowCoolNow: root.querySelector("#calc-row-cool-now"),
    rowClientsNow: root.querySelector("#calc-row-clients-now"),
    rowClientsSys: root.querySelector("#calc-row-clients-sys"),
    rowBasketNow: root.querySelector("#calc-row-basket-now"),
    rowBasketSys: root.querySelector("#calc-row-basket-sys"),
    rowCaNow: root.querySelector("#calc-row-ca-now"),
    rowCaSys: root.querySelector("#calc-row-ca-sys"),
    delta: root.querySelector("#calc-delta"),
    deltaYear: root.querySelector("#calc-delta-year"),
  };

  const SYSTEM_CLOSE_RATIO = 0.75;
  const COOL_VS_HOT_MAX = 0.4;
  const MIN_UPLIFT_VS_BLEND = 1.05;

  const fmtEuro = (n: number) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(Math.round(n));

  const fmtNum = (n: number, digits = 0) =>
    new Intl.NumberFormat("fr-FR", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(n);

  const fmtPct = (n: number) => {
    const p = n * 100;
    const digits = Math.abs(p - Math.round(p)) < 0.05 ? 0 : 1;
    return `${fmtNum(p, digits)} %`;
  };

  const syncCoolCeiling = () => {
    const hotPct = Number(closeHotEl.value);
    const maxCool = Math.max(1, Math.floor(hotPct * COOL_VS_HOT_MAX));
    closeCoolEl.max = String(maxCool);
    if (Number(closeCoolEl.value) > maxCool) closeCoolEl.value = String(maxCool);
  };

  const render = () => {
    syncCoolCeiling();

    const leads = Number(leadsEl.value);
    const basket = Number(basketEl.value);
    const fastPct = Number(fastEl.value) / 100;
    const closeHot = Number(closeHotEl.value) / 100;
    const closeCool = Number(closeCoolEl.value) / 100;

    const fastNow = Math.round(leads * fastPct);
    const lateNow = leads - fastNow;
    const clientsNow = fastNow * closeHot + lateNow * closeCool;
    const blended = leads > 0 ? clientsNow / leads : 0;
    const closeSys = Math.min(
      closeHot,
      Math.max(closeHot * SYSTEM_CLOSE_RATIO, blended * MIN_UPLIFT_VS_BLEND),
    );
    const clientsSys = leads * closeSys;
    const caNow = clientsNow * basket;
    const caSys = clientsSys * basket;
    const delta = Math.max(0, caSys - caNow);

    if (out.leads) out.leads.textContent = String(leads);
    if (out.basket) out.basket.textContent = fmtEuro(basket);
    if (out.fast) out.fast.textContent = fmtPct(fastPct);
    if (out.closeHot) out.closeHot.textContent = fmtPct(closeHot);
    if (out.closeCool) out.closeCool.textContent = fmtPct(closeCool);
    if (out.closeSys) out.closeSys.textContent = fmtPct(closeSys);

    if (out.rowLeadsNow) out.rowLeadsNow.textContent = String(leads);
    if (out.rowLeadsSys) out.rowLeadsSys.textContent = String(leads);
    if (out.rowFastNow) out.rowFastNow.textContent = String(fastNow);
    if (out.rowFastSys) out.rowFastSys.textContent = String(leads);
    if (out.rowLateNow) out.rowLateNow.textContent = String(lateNow);
    if (out.rowLateSys) out.rowLateSys.textContent = "0";
    if (out.rowHotNow) out.rowHotNow.textContent = fmtPct(closeHot);
    if (out.rowHotSys) out.rowHotSys.textContent = `${fmtPct(closeSys)}*`;
    if (out.rowCoolNow) out.rowCoolNow.textContent = fmtPct(closeCool);
    if (out.rowClientsNow) out.rowClientsNow.textContent = fmtNum(clientsNow, 1);
    if (out.rowClientsSys) out.rowClientsSys.textContent = fmtNum(clientsSys, 1);
    if (out.rowBasketNow) out.rowBasketNow.textContent = fmtEuro(basket);
    if (out.rowBasketSys) out.rowBasketSys.textContent = fmtEuro(basket);
    if (out.rowCaNow) out.rowCaNow.textContent = fmtEuro(caNow);
    if (out.rowCaSys) out.rowCaSys.textContent = fmtEuro(caSys);

    if (out.delta) out.delta.textContent = `+ ${fmtEuro(delta)} / mois`;
    if (out.deltaYear) out.deltaYear.textContent = `+ ${fmtEuro(delta * 12)} / an`;
  };

  [leadsEl, basketEl, fastEl, closeHotEl, closeCoolEl].forEach((el) => {
    el.addEventListener("input", render);
  });
  render();
}

/**
 * Calculateur simple : leads + panier + part contactée vite.
 * Closes internes fixes (modèle conservateur).
 */
export function bindLeakCalc(root: HTMLElement | null) {
  if (!root) return;

  const leadsEl = root.querySelector<HTMLInputElement>("#calc-leads");
  const basketEl = root.querySelector<HTMLInputElement>("#calc-basket");
  const fastEl = root.querySelector<HTMLInputElement>("#calc-fast");
  if (!leadsEl || !basketEl || !fastEl) return;

  const out = {
    leads: root.querySelector("#calc-leads-val"),
    basket: root.querySelector("#calc-basket-val"),
    fast: root.querySelector("#calc-fast-val"),
    caNow: root.querySelector("#calc-ca-now"),
    caSys: root.querySelector("#calc-ca-sys"),
    clientsNow: root.querySelector("#calc-clients-now"),
    clientsSys: root.querySelector("#calc-clients-sys"),
    delta: root.querySelector("#calc-delta"),
    deltaYear: root.querySelector("#calc-delta-year"),
  };

  const CLOSE_HOT = 0.2;
  const CLOSE_COOL = 0.05;
  const SYSTEM_CLOSE_RATIO = 0.75;
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

  const fmtPct = (n: number) => `${Math.round(n * 100)} %`;

  const render = () => {
    const leads = Number(leadsEl.value);
    const basket = Number(basketEl.value);
    const fastPct = Number(fastEl.value) / 100;

    const fastNow = Math.round(leads * fastPct);
    const lateNow = leads - fastNow;
    const clientsNow = fastNow * CLOSE_HOT + lateNow * CLOSE_COOL;
    const blended = leads > 0 ? clientsNow / leads : 0;
    const closeSys = Math.min(
      CLOSE_HOT,
      Math.max(CLOSE_HOT * SYSTEM_CLOSE_RATIO, blended * MIN_UPLIFT_VS_BLEND),
    );
    const clientsSys = leads * closeSys;
    const caNow = clientsNow * basket;
    const caSys = clientsSys * basket;
    const delta = Math.max(0, caSys - caNow);

    if (out.leads) out.leads.textContent = String(leads);
    if (out.basket) out.basket.textContent = fmtEuro(basket);
    if (out.fast) out.fast.textContent = fmtPct(fastPct);
    if (out.caNow) out.caNow.textContent = fmtEuro(caNow);
    if (out.caSys) out.caSys.textContent = fmtEuro(caSys);
    if (out.clientsNow) out.clientsNow.textContent = fmtNum(clientsNow, 1);
    if (out.clientsSys) out.clientsSys.textContent = fmtNum(clientsSys, 1);
    if (out.delta) out.delta.textContent = `+ ${fmtEuro(delta)} / mois`;
    if (out.deltaYear) out.deltaYear.textContent = `+ ${fmtEuro(delta * 12)} / an`;
  };

  [leadsEl, basketEl, fastEl].forEach((el) => el.addEventListener("input", render));
  render();
}

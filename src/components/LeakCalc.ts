/**
 * Calculateur de fuite — comparateur temps réel.
 * Stat iClosed : un lead contacté en < 5 min a ~+300% de chances d'être closé (×4).
 */
export function bindLeakCalc(root: HTMLElement | null) {
  if (!root) return;

  const leadsEl = root.querySelector<HTMLInputElement>("#calc-leads");
  const basketEl = root.querySelector<HTMLInputElement>("#calc-basket");
  const closeEl = root.querySelector<HTMLInputElement>("#calc-close");
  if (!leadsEl || !basketEl || !closeEl) return;

  const out = {
    leads: root.querySelector("#calc-leads-val"),
    basket: root.querySelector("#calc-basket-val"),
    close: root.querySelector("#calc-close-val"),
    closeHot: root.querySelector("#calc-close-hot"),
    caNow: root.querySelector("#calc-ca-now"),
    caHorizon: root.querySelector("#calc-ca-horizon"),
    clientsNow: root.querySelector("#calc-clients-now"),
    clientsHorizon: root.querySelector("#calc-clients-horizon"),
    delta: root.querySelector("#calc-delta"),
    deltaYear: root.querySelector("#calc-delta-year"),
    barNow: root.querySelector<HTMLElement>("#calc-bar-now"),
    barHorizon: root.querySelector<HTMLElement>("#calc-bar-horizon"),
  };

  const HOT_MULT = 4; // +300% = ×4 (iClosed)

  const fmtEuro = (n: number) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(Math.round(n));

  const fmtPct = (n: number) => `${(n * 100).toFixed(n * 100 >= 10 ? 0 : 1)} %`;

  const render = () => {
    const leads = Number(leadsEl.value);
    const basket = Number(basketEl.value);
    const closeLate = Number(closeEl.value) / 100;
    const closeHot = Math.min(closeLate * HOT_MULT, 0.95);

    const clientsNow = leads * closeLate;
    const clientsHorizon = leads * closeHot;
    const caNow = clientsNow * basket;
    const caHorizon = clientsHorizon * basket;
    const delta = caHorizon - caNow;
    const maxCa = Math.max(caNow, caHorizon, 1);

    if (out.leads) out.leads.textContent = String(leads);
    if (out.basket) out.basket.textContent = fmtEuro(basket);
    if (out.close) out.close.textContent = fmtPct(closeLate);
    if (out.closeHot) out.closeHot.textContent = fmtPct(closeHot);
    if (out.caNow) out.caNow.textContent = fmtEuro(caNow);
    if (out.caHorizon) out.caHorizon.textContent = fmtEuro(caHorizon);
    if (out.clientsNow) out.clientsNow.textContent = clientsNow.toFixed(1);
    if (out.clientsHorizon) out.clientsHorizon.textContent = clientsHorizon.toFixed(1);
    if (out.delta) out.delta.textContent = `+ ${fmtEuro(delta)} / mois`;
    if (out.deltaYear) out.deltaYear.textContent = `+ ${fmtEuro(delta * 12)} / an`;
    if (out.barNow) out.barNow.style.width = `${(caNow / maxCa) * 100}%`;
    if (out.barHorizon) out.barHorizon.style.width = `${(caHorizon / maxCa) * 100}%`;
  };

  [leadsEl, basketEl, closeEl].forEach((el) => {
    el.addEventListener("input", render);
  });
  render();
}

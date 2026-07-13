// Helper sliders fins pour l'overlay UI.
const panel = () => document.getElementById("controls");

interface SliderOpts {
  label: string;
  min?: number;
  max?: number;
  value?: number;
  step?: number;
  format?: (v: number) => string;
  onInput?: (v: number) => void;
}

export function addSlider({
  label,
  min = 0,
  max = 1,
  value = 0.5,
  step = 0.01,
  format = (v: number) => v.toFixed(2),
  onInput = (_v: number) => {},
}: SliderOpts) {
  const p = panel()!;
  const row = document.createElement("div");
  row.className = "ctrl__row";

  const lab = document.createElement("label");
  lab.className = "ctrl__label";
  const name = document.createElement("span");
  name.textContent = label;
  const val = document.createElement("span");
  val.className = "ctrl__val";
  val.textContent = format(value);
  lab.append(name, val);

  const input = document.createElement("input");
  input.type = "range";
  input.className = "ctrl__range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    val.textContent = format(v);
    onInput(v);
  });

  row.append(lab, input);
  p.appendChild(row);
  onInput(value);
  return () => parseFloat(input.value);
}

// Bouton cycleur : un clic → valeur suivante (ex. mode de rendu).
export function addCycleButton({
  label,
  value,
  onCycle,
}: {
  label: string;
  value: string;
  onCycle: () => string;
}) {
  const p = panel()!;
  const row = document.createElement("div");
  row.className = "ctrl__row";

  const lab = document.createElement("label");
  lab.className = "ctrl__label";
  const name = document.createElement("span");
  name.textContent = label;
  lab.append(name);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ctrl__cycle";
  btn.textContent = value;
  btn.addEventListener("click", () => {
    btn.textContent = onCycle();
  });

  row.append(lab, btn);
  p.appendChild(row);
  return (text: string) => {
    btn.textContent = text;
  };
}

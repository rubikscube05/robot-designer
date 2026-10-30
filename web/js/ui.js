// Small DOM helpers and the actuator catalogue panel.

/** Build a DOM element: h("div", { class: "x", onclick: fn }, child, "text", ...) */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid);
  }
  return el;
}

const SORTS = {
  name: { label: "Name", fn: (a, b) => a.name.localeCompare(b.name) },
  torque: { label: "Peak torque (high first)", fn: (a, b) => b.tau_peak_Nm - a.tau_peak_Nm },
  mass: { label: "Mass (light first)", fn: (a, b) => a.mass_kg - b.mass_kg },
  density: {
    label: "Torque density (high first)",
    fn: (a, b) => b.tau_peak_Nm / b.mass_kg - a.tau_peak_Nm / a.mass_kg,
  },
};

const fmt = (n, digits = 1) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(digits));

/** Searchable, sortable list of catalogue actuators. Clicking one calls onAdd(entry). */
export function createCatalogPanel(root, entries, onAdd) {
  const search = h("input", { type: "search", placeholder: "Search name or vendor…" });
  const category = h("select", {},
    h("option", { value: "" }, "All types"),
    ...["QDD", "MidGear", "Harmonic"].map((c) => h("option", { value: c }, c)));
  const sort = h("select", {},
    ...Object.entries(SORTS).map(([k, s]) => h("option", { value: k }, s.label)));
  const count = h("div", { class: "muted small" });
  const list = h("div", { class: "catalog-list" });

  function render() {
    const q = search.value.trim().toLowerCase();
    const rows = entries
      .filter((e) => !category.value || e.category === category.value)
      .filter((e) => !q || `${e.name} ${e.vendor}`.toLowerCase().includes(q))
      .sort(SORTS[sort.value].fn);
    count.textContent = `${rows.length} of ${entries.length} actuators · click to add`;
    list.replaceChildren(...rows.map((e) =>
      h("button", { class: "catalog-item", title: `Add ${e.name} to the scene`, onclick: () => onAdd(e) },
        h("span", { class: `dot ${e.category}` }),
        h("span", { class: "name" }, e.name),
        h("span", { class: "meta" },
          `${e.vendor} · ${fmt(e.tau_peak_Nm)} N·m · ${fmt(e.mass_kg, 2)} kg · Ø${fmt(e.OD_mm, 0)}×${fmt(e.L_mm, 0)}`))));
  }
  [search, category, sort].forEach((el) => el.addEventListener("input", render));
  root.replaceChildren(h("h2", {}, "Actuators"),
    h("div", { class: "filters" }, search, h("div", { class: "row" }, category, sort)), count, list);
  render();
}

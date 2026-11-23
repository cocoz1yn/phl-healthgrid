(() => {
  const { fields, rows } = window.PHL_TRACTS;
  const tracts = rows.map(row => Object.fromEntries(fields.map((key, index) => [key, row[index]])));
  const get = id => document.getElementById(id);
  const area = get("tract-polygons");
  const metricPicker = get("metric-picker");
  const tractPicker = get("tract-picker");
  const comparison = get("tract-comparison");
  const hover = get("map-hover");
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const colors = ["#eff6e0", "#d5e1cf", "#aec3b0", "#598392", "#124559"];
  const missing = "#d5d9d8";
  const measures = {
    septa_primary: ["SEPTA to primary care at 9 a.m.", " min", [10, 15, 20, 30]],
    no_vehicle_pct: ["Households without a vehicle", "%", [15, 25, 40, 60]],
    age_65_plus_pct: ["Residents age 65 and older", "%", [10, 15, 20, 30]],
    uninsured_pct: ["Residents without health insurance", "%", [3, 6, 9, 15]],
    population: ["Population", "", [1000, 2500, 4000, 6000]],
  };
  const requestedTract = new URLSearchParams(location.search).get("tract");
  const byId = new Map();
  const medians = Object.fromEntries(Object.keys(measures).map(key => {
    const values = tracts.filter(tract => tract.population > 0 && Number.isFinite(tract[key]))
      .map(tract => tract[key]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return [key, median];
  }));
  let active;

  function format(value, unit) {
    if (!Number.isFinite(value)) return "—";
    return number.format(value) + unit;
  }

  function node(tag, label) {
    const element = document.createElement(tag);
    if (label !== undefined) element.textContent = label;
    return element;
  }

  function comparisonBar(value, unit, max, series, name) {
    const row = node("div");
    row.classList.add("comparison-bar", series);
    const track = node("span");
    track.className = "comparison-track";
    track.setAttribute("aria-hidden", "true");
    const hasValue = Number.isFinite(value);
    if (hasValue) {
      const fill = node("span");
      fill.style.width = `${100 * value / max}%`;
      track.append(fill);
    } else {
      track.classList.add("is-unavailable");
    }
    const label = node("span", hasValue ? format(value, unit) : "Unavailable");
    label.className = "comparison-value";
    const seriesLabel = node("span", `${name}: `);
    seriesLabel.className = "comparison-series-label";
    label.prepend(seriesLabel);
    row.append(track, label);
    return row;
  }

  function selectedValues(entry) {
    const selected = entry.tract;
    if (active) active.path.classList.remove("is-selected");
    active = entry;
    area.append(active.path);
    active.path.classList.add("is-selected");
    tractPicker.value = selected.geoid;
    comparison.replaceChildren(...Object.entries(measures).map(([key, [label, unit]]) => {
      const row = node("div");
      row.className = "comparison-metric";
      const values = [selected[key], medians[key]].filter(Number.isFinite);
      const max = Math.max(0, ...values) || 1;
      row.append(
        node("h4", label),
        comparisonBar(selected[key], unit, max, "selected-series", "Selected tract"),
        comparisonBar(medians[key], unit, max, "median-series", "Median tract"),
      );
      return row;
    }));
  }

  function changeMetric() {
    const key = metricPicker.value;
    const [label, unit, cuts] = measures[key];
    for (const { tract, path, title } of byId.values()) {
      const value = tract[key];
      const bin = cuts.findIndex(limit => value <= limit);
      path.setAttribute("fill", Number.isFinite(value) ? colors[bin < 0 ? cuts.length : bin] : missing);
      title.textContent = `Tract ${tract.geoid} · ${label} · ${format(value, unit)}`;
    }
    const intervals = [
      cuts[0] === 0 ? "0" : `Up to ${format(cuts[0], unit)}`,
      ...cuts.slice(1).map((cut, i) => `Over ${format(cuts[i], unit)} to ${format(cut, unit)}`),
      `Over ${format(cuts.at(-1), unit)}`,
      "Unavailable",
    ];
    get("map-legend").replaceChildren(...intervals.map((label, index) => {
      const item = node("li");
      const swatch = node("span");
      swatch.style.backgroundColor = colors[index] ?? missing;
      swatch.setAttribute("aria-hidden", "true");
      item.append(swatch, label);
      return item;
    }));
    hover.textContent = "Point to a tract to see its ID and value.";
  }

  for (const [key, [label]] of Object.entries(measures)) {
    metricPicker.add(new Option(label, key));
  }
  for (const tract of tracts) {
    tractPicker.add(new Option(tract.geoid, tract.geoid));
    const ns = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(ns, "path");
    const title = document.createElementNS(ns, "title");
    path.setAttribute("d", tract.path);
    path.setAttribute("class", "tract-shape");
    path.append(title);
    const entry = { tract, path, title };
    byId.set(tract.geoid, entry);
    path.addEventListener("click", () => selectedValues(entry));
    path.addEventListener("pointerenter", () => { hover.textContent = title.textContent; });
    area.append(path);
  }
  metricPicker.value = "no_vehicle_pct";
  metricPicker.addEventListener("change", changeMetric);
  tractPicker.addEventListener("change", () => selectedValues(byId.get(tractPicker.value)));
  changeMetric();
  selectedValues(byId.get(requestedTract) ?? byId.get("42101009100") ?? byId.values().next().value);
})();

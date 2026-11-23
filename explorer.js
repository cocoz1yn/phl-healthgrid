(() => {
  const facilities = window.PHL_FACILITIES;
  const byId = new Map(facilities.map(facility => [facility.id, facility]));
  const facilityPhotos = new Map(window.PHL_FACILITY_PHOTOS.flatMap(
    record => record.facilityIds.map(id => [id, record])
  ));
  const {types: typeNames, core, specialties} = window.PHL_DIRECTORY_LABELS;
  const serviceNames = {...core, ...specialties, undocumented: "Services not documented"};
  const ownershipNames = {
    public: "Government-run",
    nonprofit: "Nonprofit",
    for_profit: "For-profit",
    unknown: "Ownership unknown",
  };
  const filterGroups = {
    types: {label: "facility types", inputs: []},
    services: {label: "services", inputs: []},
    owners: {label: "ownership types", inputs: []},
  };
  const get = id => document.getElementById(id);
  const results = get("results");
  const search = get("search");
  const photo = get("facility-photo");
  const photoHero = photo.closest(".facility-hero");
  const photoCredit = get("photo-credit");
  const parcelStatus = get("parcel-status");
  let selected = byId.get("phl-dfc65f25adc43e4f") ?? facilities[0];
  let visible;
  const map = window.createHealthMap({
    canvas: get("map"),
    onSelect: id => select(id, false),
    onParcelStatus(message) {
      if (parcelStatus.textContent !== message) parcelStatus.textContent = message;
    },
  });

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function addOptions(container, labels, group, valuesFor) {
    for (const [value, name] of Object.entries(labels)) {
      const label = element("label");
      const input = element("input");
      input.type = "checkbox";
      input.value = value;
      input.checked = true;
      input.addEventListener("change", refresh);
      filterGroups[group].inputs.push(input);
      const count = facilities.filter(facility => valuesFor(facility).includes(value)).length;
      label.append(input, element("span", name), element("span", String(count), "option-count"));
      container.append(label);
    }
  }

  function checkedOptions(group) {
    return new Set(filterGroups[group].inputs.filter(input => input.checked).map(input => input.value));
  }

  function servicesFor(facility) {
    return facility.services.length ? facility.services : ["undocumented"];
  }

  function searchableText(value) {
    return value.toLowerCase().replace(/[.’']/g, "").replace(/[,-]/g, " ").trim();
  }

  function refresh() {
    const services = checkedOptions("services");
    const owners = checkedOptions("owners");
    const types = checkedOptions("types");
    const terms = searchableText(search.value).split(/\s+/).filter(Boolean);
    visible = facilities.filter(facility => {
      const searchable = searchableText(
        [facility.name, ...facility.aliases, facility.operator, facility.address, facility.zip_code].join(" ")
      );
      return types.has(facility.category)
        && servicesFor(facility).some(service => services.has(service))
        && owners.has(facility.ownership)
        && terms.every(term => searchable.includes(term));
    }).sort((a, b) => a.name.localeCompare(b.name));

    for (const toggle of document.querySelectorAll(".filter-toggle")) {
      const group = filterGroups[toggle.dataset.filter];
      const anyChecked = group.inputs.some(input => input.checked);
      toggle.textContent = `${anyChecked ? "Clear" : "Select"} all ${group.label}`;
    }
    const count = visible.length;
    get("list-heading").textContent = `Locations (${count})`;
    get("map-count").textContent = `${count} ${count === 1 ? "location" : "locations"} shown`;
    if (!visible.includes(selected)) selected = visible[0];
    const buttons = visible.map(facility => {
      const button = element("button", facility.name, "result");
      button.type = "button";
      button.dataset.id = facility.id;
      button.append(element("small", [typeNames[facility.category], facility.address].filter(Boolean).join(" · ")));
      button.addEventListener("click", () => select(facility.id, true));
      return button;
    });
    results.replaceChildren(...(count ? buttons : [element("p", "No locations match your filters.")]));
    renderSelection();
  }

  function select(id, recenter) {
    selected = byId.get(id);
    if (recenter) map.centerOn(selected.xy);
    renderSelection();
    if (!recenter) {
      const active = results.querySelector("[aria-pressed=true]");
      if (active) results.scrollTop = active.offsetTop - results.firstElementChild.offsetTop;
    }
  }

  function validUrl(value, protocols) {
    try {
      const url = new URL(value);
      if (protocols.includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch {
      return null;
    }
    return null;
  }

  function renderSelection() {
    for (const button of results.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.id === selected?.id));
    }
    map.update(visible, selected?.id);
    const category = get("facility-category");
    const fields = get("facility-fields");
    const official = get("official-site");
    category.hidden = !selected;
    category.textContent = typeNames[selected?.category] ?? "";
    get("facility-name").textContent = selected?.name ?? "Select a location";
    fields.replaceChildren();
    const website = validUrl(selected?.website, ["http:", "https:"]);
    official.hidden = !website;
    official.removeAttribute("href");
    if (website) official.href = website;

    if (selected) {
      const address = [selected.address, selected.zip_code ? `Philadelphia, PA ${selected.zip_code}` : ""]
        .filter(Boolean).join(", ");
      const entries = [
        ["Address", address],
        ["Phone", selected.phone],
        ["Operator", selected.operator],
        ["Ownership", ownershipNames[selected.ownership]],
        ["Location information", selected.note],
      ];
      for (const [label, value] of entries) {
        if (!value) continue;
        const description = element("dd", value);
        if (label === "Ownership") {
          const source = validUrl(selected.ownership_source, ["http:", "https:"]);
          if (selected.ownership_detail) description.append(element("small", selected.ownership_detail, "evidence-basis"));
          if (source) description.append(creditLink("Ownership source", source));
        }
        fields.append(element("dt", label), description);
      }
    }

    const directions = get("facility-directions");
    const hasCoordinates = Number.isFinite(selected?.lat) && Number.isFinite(selected?.lon);
    directions.hidden = !hasCoordinates;
    directions.removeAttribute("href");
    if (hasCoordinates) {
      const url = new URL("https://www.google.com/maps/dir/");
      url.searchParams.set("api", "1");
      url.searchParams.set("destination", `${selected.lat},${selected.lon}`);
      directions.href = url.href;
    }
    showPhoto();
  }

  function showPhoto() {
    const source = facilityPhotos.get(selected?.id)?.url;
    photo.hidden = true;
    photo.removeAttribute("src");
    photoHero.classList.remove("has-photo");
    photoCredit.hidden = true;
    photoCredit.replaceChildren();
    if (source) {
      photo.alt = `Photo of ${selected.name}`;
      photo.src = source;
    }
  }

  function creditLink(text, url) {
    const link = element("a", text);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  photo.addEventListener("load", () => {
    photo.hidden = false;
    photoHero.classList.add("has-photo");
    const verified = facilityPhotos.get(selected?.id);
    if (verified?.url === photo.getAttribute("src")) {
      photoCredit.replaceChildren(
        "Photo: ",
        creditLink(verified.title.replace(/\.jpg$/i, ""), verified.source),
        ` by ${verified.author} · `,
        creditLink(verified.license, verified.licenseUrl),
        " · Cropped for display"
      );
      photoCredit.hidden = false;
    }
  });
  photo.addEventListener("error", () => {
    if (!photo.hasAttribute("src")) return;
    photo.hidden = true;
    photoHero.classList.remove("has-photo");
    photoCredit.hidden = true;
  });

  addOptions(get("types"), typeNames, "types", facility => [facility.category]);
  addOptions(get("common-services"), core, "services", servicesFor);
  addOptions(get("specialty-services"), {...specialties, undocumented: serviceNames.undocumented}, "services", servicesFor);
  addOptions(get("owners"), ownershipNames, "owners", facility => [facility.ownership]);
  for (const toggle of document.querySelectorAll(".filter-toggle")) {
    toggle.addEventListener("click", () => {
      const {inputs} = filterGroups[toggle.dataset.filter];
      const checked = !inputs.some(input => input.checked);
      for (const input of inputs) input.checked = checked;
      refresh();
    });
  }
  get("search-form").addEventListener("submit", event => {
    event.preventDefault();
    refresh();
    if (selected && search.value.trim()) map.centerOn(selected.xy);
  });
  search.addEventListener("input", refresh);
  get("reset").addEventListener("click", () => {
    search.value = "";
    for (const box of document.querySelectorAll(".options input")) box.checked = true;
    selected = byId.get("phl-dfc65f25adc43e4f") ?? facilities[0];
    map.reset();
    refresh();
  });
  get("zoom-in").addEventListener("click", () => map.zoomBy(1.5));
  get("zoom-out").addEventListener("click", () => map.zoomBy(1 / 1.5));
  get("map-home").addEventListener("click", map.reset);
  get("show-parcels").addEventListener("change", event => map.setParcelsVisible(event.target.checked));
  refresh();
})();

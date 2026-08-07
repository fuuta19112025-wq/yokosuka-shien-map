let shelters = [];
let needs = [];
let hazards = [];
let pets = [];
let infos = [];
let currentFilter = "all";
let map, markers = [];

const INFO_EMOJI = { "給水": "💧", "トイレ": "🚻", "充電": "🔌", "炊き出し": "🍚" };

async function loadData() {
  const [sRes, nRes, hRes, pRes, iRes] = await Promise.all([
    fetch("shelters.json"),
    fetch("needs-sample.json"),
    fetch("hazards-sample.json"),
    fetch("pets-sample.json"),
    fetch("info-sample.json")
  ]);
  shelters = await sRes.json();
  needs = await nRes.json();
  hazards = await hRes.json();
  pets = await pRes.json();
  infos = await iRes.json();
}

function shelterName(id) {
  const s = shelters.find(s => s.id === id);
  return s ? s.name : "エリア全体";
}

function initMap() {
  map = L.map("map").setView([35.252, 139.720], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  shelters.forEach(s => {
    const needCount = needs.filter(n => n.shelter_id === s.id && n.type === "欲しい").length;
    const marker = L.marker([s.lat, s.lon]).addTo(map);
    marker.bindPopup(
      `<strong>${s.name}</strong><br>${s.addr}<br>現在の「欲しい」投稿: ${needCount}件`
    );
    markers.push(marker);
  });

  const hazardIcon = kind => L.divIcon({
    className: "",
    html: `<div style="background:#e8720c;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 0 0 2px #fff;">⚠</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });

  hazards.forEach(h => {
    const marker = L.marker([h.lat, h.lon], { icon: hazardIcon(h.kind) }).addTo(map);
    marker.bindPopup(
      `<strong>⚠ ${h.kind}</strong><br>${h.place}<br>${h.note}<br><span style="color:#888;font-size:12px;">${h.time}</span>`
    );
    markers.push(marker);
  });

  const petIcon = () => L.divIcon({
    className: "",
    html: `<div style="background:#8854d0;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 0 0 2px #fff;">🐾</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });

  pets.forEach(p => {
    const marker = L.marker([p.lat, p.lon], { icon: petIcon() }).addTo(map);
    marker.bindPopup(
      `<strong>🐾 ${p.status}: ${p.animal}</strong><br>${p.feature}<br>${p.place}<br><span style="color:#888;font-size:12px;">${p.time}</span>`
    );
    markers.push(marker);
  });

  const infoIcon = kind => L.divIcon({
    className: "",
    html: `<div style="background:#0b8793;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 0 0 2px #fff;">${INFO_EMOJI[kind] || "ℹ"}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });

  infos.forEach(i => {
    const marker = L.marker([i.lat, i.lon], { icon: infoIcon(i.kind) }).addTo(map);
    marker.bindPopup(
      `<strong>${INFO_EMOJI[i.kind] || ""} ${i.kind}: ${i.place}</strong><br>${i.note}<br><span style="color:#888;font-size:12px;">${i.time}</span>`
    );
    markers.push(marker);
  });
}

function allItems() {
  const hazardItems = hazards.map(h => ({
    id: `h${h.id}`,
    shelter_id: null,
    type: "道路情報",
    item: `${h.kind}: ${h.place}`,
    qty: "",
    poster: "投稿者",
    note: h.note,
    time: h.time
  }));
  const petItems = pets.map(p => ({
    id: `p${p.id}`,
    shelter_id: null,
    type: "迷子ペット",
    item: `${p.status}: ${p.animal}`,
    qty: "",
    poster: p.contact,
    note: `${p.feature} / ${p.place}`,
    time: p.time
  }));
  const infoItems = infos.map(i => ({
    id: `i${i.id}`,
    shelter_id: null,
    type: "お知らせ",
    item: `${INFO_EMOJI[i.kind] || ""} ${i.kind}: ${i.place}`,
    qty: "",
    poster: "避難所スタッフ",
    note: i.note,
    time: i.time
  }));
  return [...needs, ...hazardItems, ...petItems, ...infoItems];
}

function renderList() {
  const list = document.getElementById("list");
  list.innerHTML = "";

  const items = allItems();
  const filtered = currentFilter === "all"
    ? items
    : items.filter(n => n.type === currentFilter);

  if (filtered.length === 0) {
    list.innerHTML = `<p style="text-align:center;color:#888;">該当する投稿はまだありません。</p>`;
    return;
  }

  filtered
    .slice()
    .sort((a, b) => (a.time < b.time ? 1 : -1))
    .forEach(n => {
      const card = document.createElement("div");
      card.className = `card type-${n.type}`;
      card.innerHTML = `
        <div class="card-top">
          <span class="badge type-${n.type}">${n.type}</span>
          <span class="meta">${n.time}</span>
        </div>
        <div class="item">${n.item}${n.qty ? "(" + n.qty + ")" : ""}</div>
        <div class="meta">${n.type === "道路情報" ? "道路・通行情報" : n.type === "迷子ペット" ? "迷子ペット情報" : n.type === "お知らせ" ? "生活情報" : shelterName(n.shelter_id)} ・ ${n.poster}</div>
        ${n.note ? `<div class="note">${n.note}</div>` : ""}
      `;
      list.appendChild(card);
    });
}

function setupFilters() {
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.type;
      renderList();
    });
  });
}

(async function main() {
  await loadData();
  initMap();
  setupFilters();
  renderList();
})();

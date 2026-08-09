let shelters = [];
let liveItems = [];      // 実データ(スプレッドシート) または サンプルデータ
let usingLiveSheet = false;
let currentFilter = "all";
let map, markers = [];

const INFO_EMOJI = { "給水": "💧", "トイレ": "🚻", "充電": "🔌", "炊き出し": "🍚" };
const TYPE_EMOJI = {
  "欲しい": "🙏",
  "ある": "📦",
  "運べる": "🚗",
  "道路情報": "⚠",
  "迷子ペット": "🐾",
  "お知らせ": "ℹ"
};
const TYPE_LABEL = {
  "欲しい": s => shelterLabel(s),
  "ある": s => shelterLabel(s),
  "運べる": s => shelterLabel(s),
  "道路情報": () => "道路・通行情報",
  "迷子ペット": () => "迷子ペット情報",
  "お知らせ": () => "生活情報"
};

function shelterLabel(shelter) {
  return shelter ? shelter.name : "エリア全体";
}

function findShelterByName(name) {
  if (!name) return null;
  return shelters.find(s => name.includes(s.name)) || null;
}

async function loadShelters() {
  shelters = await (await fetch("shelters.json")).json();
}

// --- サンプルデータ読み込み(スプレッドシート未接続のとき) ---
async function loadSampleData() {
  const [nRes, hRes, pRes, iRes] = await Promise.all([
    fetch("needs-sample.json"),
    fetch("hazards-sample.json"),
    fetch("pets-sample.json"),
    fetch("info-sample.json")
  ]);
  const needs = await nRes.json();
  const hazards = await hRes.json();
  const pets = await pRes.json();
  const infos = await iRes.json();

  const needItems = needs.map(n => ({
    type: n.type,
    shelter: shelters.find(s => s.id === n.shelter_id) || null,
    item: n.item,
    qty: n.qty,
    poster: n.poster,
    note: n.note,
    time: n.time
  }));
  const hazardItems = hazards.map(h => ({
    type: "道路情報",
    shelter: null,
    item: `${h.kind}: ${h.place}`,
    qty: "",
    poster: "投稿者",
    note: h.note,
    time: h.time
  }));
  const petItems = pets.map(p => ({
    type: "迷子ペット",
    shelter: null,
    item: `${p.status}: ${p.animal}`,
    qty: "",
    poster: p.contact,
    note: `${p.feature} / ${p.place}`,
    time: p.time
  }));
  const infoItems = infos.map(i => ({
    type: "お知らせ",
    shelter: shelters.find(s => s.name === i.place) || null,
    item: `${INFO_EMOJI[i.kind] || ""} ${i.kind}: ${i.place}`,
    qty: "",
    poster: "避難所スタッフ",
    note: i.note,
    time: i.time
  }));

  liveItems = [...needItems, ...hazardItems, ...petItems, ...infoItems];
  usingLiveSheet = false;
}

// --- Googleスプレッドシート(CSV公開)から読み込み ---
// 列の並び: タイムスタンプ, 投稿の種類, 近くの避難所, 品目・内容, 数量・詳細, 具体的な場所, 投稿者, 備考
function loadFromSheet(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: false,
      skipEmptyLines: true,
      complete: results => {
        const rows = results.data.slice(1); // 1行目はヘッダー
        liveItems = rows.map(cols => {
          const [time, type, shelterName, item, qty, place, poster, note] = cols;
          const shelter = findShelterByName(shelterName);
          return {
            type: (type || "").trim(),
            shelter,
            item: item || "",
            qty: qty || "",
            poster: poster || "投稿者",
            note: [place, note].filter(Boolean).join(" / "),
            time: time || ""
          };
        }).filter(it => it.type && it.item);
        usingLiveSheet = true;
        resolve();
      },
      error: err => reject(err)
    });
  });
}

async function loadData() {
  await loadShelters();
  if (typeof SHEET_CSV_URL === "string" && SHEET_CSV_URL.trim()) {
    try {
      await loadFromSheet(SHEET_CSV_URL.trim());
      return;
    } catch (e) {
      console.error("スプレッドシート読み込み失敗、サンプルデータで表示します", e);
    }
  }
  await loadSampleData();
}

function initMap() {
  map = L.map("map").setView([35.252, 139.720], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // 種類ごとに単独ピンを立てると同じ避難所に何件も重なって見づらくなるため、
  // すべての投稿は避難所のピン1つに集約し、種類ごとの件数をポップアップに表示する
  shelters.forEach(s => {
    const counts = {};
    liveItems
      .filter(it => it.shelter && it.shelter.id === s.id)
      .forEach(it => { counts[it.type] = (counts[it.type] || 0) + 1; });

    const countLines = Object.entries(counts)
      .map(([type, n]) => `${TYPE_EMOJI[type] || ""} ${type}: ${n}件`)
      .join("<br>");

    const marker = L.marker([s.lat, s.lon]).addTo(map);
    marker.bindPopup(
      `<strong>${s.name}</strong><br>${s.addr}<br>${countLines || "投稿はまだありません"}`
    );
    markers.push(marker);
  });
}

function renderList() {
  const list = document.getElementById("list");
  list.innerHTML = "";

  const filtered = currentFilter === "all"
    ? liveItems
    : liveItems.filter(it => it.type === currentFilter);

  if (filtered.length === 0) {
    list.innerHTML = `<p style="text-align:center;color:#888;">該当する投稿はまだありません。</p>`;
    return;
  }

  filtered
    .slice()
    .sort((a, b) => (a.time < b.time ? 1 : -1))
    .forEach(it => {
      const card = document.createElement("div");
      card.className = `card type-${it.type}`;
      const labelFn = TYPE_LABEL[it.type] || (() => "");
      card.innerHTML = `
        <div class="card-top">
          <span class="badge type-${it.type}">${it.type}</span>
          <span class="meta">${it.time}</span>
        </div>
        <div class="item">${it.item}${it.qty ? "(" + it.qty + ")" : ""}</div>
        <div class="meta">${labelFn(it.shelter)} ・ ${it.poster}</div>
        ${it.note ? `<div class="note">${it.note}</div>` : ""}
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

function updateNotice() {
  const notice = document.querySelector(".notice");
  if (!notice) return;
  if (usingLiveSheet) {
    notice.innerHTML = `<strong>実際の投稿を表示しています。</strong> 避難所の位置情報は横須賀市公式資料(令和7年4月時点)を元にしています。内容の正確性は投稿者の申告によるものです。`;
  }
}

(async function main() {
  await loadData();
  initMap();
  setupFilters();
  renderList();
  updateNotice();
})();

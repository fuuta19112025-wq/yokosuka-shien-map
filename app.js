let shelters = [];
let liveItems = [];      // 実データ(Supabase) または サンプルデータ
let usingLiveData = false;
let currentFilter = "all";
let map, markers = [];
let supabaseClient = null;
let currentUserId = null;

const INFO_EMOJI = { "給水": "💧", "トイレ": "🚻", "充電": "🔌", "炊き出し": "🍚" };
const TYPE_EMOJI = {
  "欲しい": "🙏",
  "ある": "📦",
  "運べる": "🚗",
  "道路情報": "⚠",
  "迷子ペット": "🐾",
  "お知らせ": "ℹ",
  "解決済み": "✅"
};
const TYPE_LABEL = {
  "欲しい": s => shelterLabel(s),
  "ある": s => shelterLabel(s),
  "運べる": s => shelterLabel(s),
  "道路情報": () => "道路・通行情報",
  "迷子ペット": () => "迷子ペット情報",
  "お知らせ": () => "生活情報",
  "解決済み": () => "見つかった・解決した報告"
};

function shelterLabel(shelter) {
  return shelter ? shelter.name : "エリア全体";
}

function findShelterById(id) {
  if (!id) return null;
  return shelters.find(s => s.id === id) || null;
}

async function loadShelters() {
  shelters = await (await fetch("shelters.json")).json();
}

// --- サンプルデータ読み込み(Supabase未接続 or 通信失敗時のフォールバック) ---
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
    id: null,
    type: n.type,
    shelter: shelters.find(s => s.id === n.shelter_id) || null,
    item: n.item,
    qty: n.qty,
    poster: n.poster,
    note: n.note,
    time: n.time,
    owner_id: null
  }));
  const hazardItems = hazards.map(h => ({
    id: null,
    type: "道路情報",
    shelter: null,
    item: `${h.kind}: ${h.place}`,
    qty: "",
    poster: "投稿者",
    note: h.note,
    time: h.time,
    owner_id: null
  }));
  const petItems = pets.map(p => ({
    id: null,
    type: "迷子ペット",
    shelter: null,
    item: `${p.status}: ${p.animal}`,
    qty: "",
    poster: p.contact,
    note: `${p.feature} / ${p.place}`,
    time: p.time,
    owner_id: null
  }));
  const infoItems = infos.map(i => ({
    id: null,
    type: "お知らせ",
    shelter: shelters.find(s => s.name === i.place) || null,
    item: `${INFO_EMOJI[i.kind] || ""} ${i.kind}: ${i.place}`,
    qty: "",
    poster: "避難所スタッフ",
    note: i.note,
    time: i.time,
    owner_id: null
  }));

  liveItems = [...needItems, ...hazardItems, ...petItems, ...infoItems];
  usingLiveData = false;
}

// --- Supabaseから読み込み ---
async function loadFromSupabase() {
  const { data, error } = await supabaseClient
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  liveItems = data.map(row => ({
    id: row.id,
    type: row.type,
    shelter: findShelterById(row.shelter_id),
    item: row.item || "",
    qty: row.qty || "",
    poster: row.poster || "投稿者",
    note: [row.place, row.note].filter(Boolean).join(" / "),
    time: new Date(row.created_at).toLocaleString("ja-JP"),
    owner_id: row.owner_id
  }));
  usingLiveData = true;
}

async function ensureAnonSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    currentUserId = session.user.id;
    return;
  }
  const { data, error } = await supabaseClient.auth.signInAnonymously();
  if (error) {
    console.error("匿名サインインに失敗しました", error);
    return;
  }
  currentUserId = data.user.id;
}

async function loadData() {
  await loadShelters();

  if (typeof SUPABASE_URL === "string" && SUPABASE_URL.trim() &&
      typeof SUPABASE_ANON_KEY === "string" && SUPABASE_ANON_KEY.trim()) {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim());
      await ensureAnonSession();
      await loadFromSupabase();
      subscribeToRealtime();
      return;
    } catch (e) {
      console.error("Supabase読み込み失敗、サンプルデータで表示します", e);
    }
  }
  await loadSampleData();
}

function subscribeToRealtime() {
  supabaseClient
    .channel("posts-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, async () => {
      await loadFromSupabase();
      initMap();
      renderList();
    })
    .subscribe();
}

function initMap() {
  if (map) {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
  } else {
    map = L.map("map").setView([35.252, 139.720], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
  }

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

async function deletePost(id) {
  if (!confirm("この投稿を削除しますか？")) return;
  const { error } = await supabaseClient.from("posts").delete().eq("id", id);
  if (error) {
    alert("削除に失敗しました: " + error.message);
    return;
  }
  await loadFromSupabase();
  initMap();
  renderList();
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

      const top = document.createElement("div");
      top.className = "card-top";
      const badge = document.createElement("span");
      badge.className = `badge type-${it.type}`;
      badge.textContent = it.type;
      const time = document.createElement("span");
      time.className = "meta";
      time.textContent = it.time;
      top.append(badge, time);

      const itemLine = document.createElement("div");
      itemLine.className = "item";
      itemLine.textContent = it.item + (it.qty ? `(${it.qty})` : "");

      const metaLine = document.createElement("div");
      metaLine.className = "meta";
      metaLine.textContent = `${labelFn(it.shelter)} ・ ${it.poster}`;

      card.append(top, itemLine, metaLine);

      if (it.note) {
        const note = document.createElement("div");
        note.className = "note";
        note.textContent = it.note;
        card.append(note);
      }

      if (it.id && currentUserId && it.owner_id === currentUserId) {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "delete-btn";
        delBtn.textContent = "自分の投稿を削除";
        delBtn.addEventListener("click", () => deletePost(it.id));
        card.append(delBtn);
      }

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

function populateShelterOptions() {
  const select = document.getElementById("postShelter");
  if (!select) return;
  shelters.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    select.appendChild(opt);
  });
}

function setupPostForm() {
  const toggleBtn = document.getElementById("postToggleBtn");
  const cancelBtn = document.getElementById("postCancelBtn");
  const section = document.getElementById("postForm");
  const form = document.getElementById("postFormEl");
  if (!toggleBtn || !section || !form) return;

  toggleBtn.addEventListener("click", () => {
    section.classList.toggle("hidden");
  });
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => section.classList.add("hidden"));
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!supabaseClient) {
      alert("現在オフラインのため投稿できません。");
      return;
    }
    const formData = new FormData(form);
    const payload = {
      type: formData.get("type"),
      shelter_id: formData.get("shelter_id") || null,
      item: formData.get("item"),
      qty: formData.get("qty") || null,
      place: formData.get("place") || null,
      poster: formData.get("poster") || "投稿者",
      note: formData.get("note") || null
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const { error } = await supabaseClient.from("posts").insert(payload);
    submitBtn.disabled = false;

    if (error) {
      alert("投稿に失敗しました: " + error.message);
      return;
    }
    form.reset();
    section.classList.add("hidden");
    await loadFromSupabase();
    initMap();
    renderList();
  });
}

function updateNotice() {
  const notice = document.querySelector(".notice");
  if (!notice) return;
  if (usingLiveData) {
    notice.innerHTML = `<strong>実際の投稿を表示しています。</strong> 避難所の位置情報は横須賀市公式資料(令和7年4月時点)を元にしています。内容の正確性は投稿者の申告によるものです。`;
  }
}

(async function main() {
  await loadData();
  initMap();
  populateShelterOptions();
  setupFilters();
  setupPostForm();
  renderList();
  updateNotice();
})();

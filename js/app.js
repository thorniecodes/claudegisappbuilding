// ── MAPBOX CONFIG ──────────────────────────────────────────────────────────────
// Replace YOUR_TOKEN_HERE with your Mapbox public token (starts with pk.)
// Then restrict it to your GitHub Pages domain at mapbox.com → Account → Access Tokens
const MAPBOX_TOKEN = 'pk.eyJ1IjoidGhvcm5oaWtvc3UiLCJhIjoiY21vajM0OWhsMDN4eDJxb2w2ZmlzcHRneSJ9.joS0q8uIBJ8qiXu84Vh1sQ';
const MAPBOX_TILE_URL = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`;

const INITIAL_CENTER = [44.0490, -123.0950];
const INITIAL_ZOOM = 13;
const TOTAL_MURALS = 24;

const TOUR_LOOPS = {
  downtown: {
    name: 'Downtown Loop',
    description: '~1.5 miles · 8 murals · ~45 min',
    color: '#E8401C',
    mural_ids: [2, 5, 7, 8, 9, 11, 19, 20]
  },
  whiteaker: {
    name: 'Whiteaker Loop',
    description: '~0.8 miles · 5 murals · ~30 min',
    color: '#4A90D9',
    mural_ids: [3, 4, 6, 10, 13]
  },
  south: {
    name: 'South Eugene',
    description: '~0.5 miles · 2 murals · ~20 min',
    color: '#7BC67E',
    mural_ids: [14, 21]
  },
  west: {
    name: 'West Eugene Loop',
    description: '~1.2 miles · 3 murals · ~25 min',
    color: '#D4A843',
    mural_ids: [22, 24, 16]
  }
};

function getMuralColor(id) {
  for (const loop of Object.values(TOUR_LOOPS)) {
    if (loop.mural_ids.includes(id)) return loop.color;
  }
  return '#888880'; // neutral for murals not assigned to a loop
}

// Maps the neighborhood names used in mural properties → City of Eugene GIS names
const NEIGHBORHOOD_NAME_MAP = {
  'Downtown':    'Downtown Neighborhood Association',
  'Whiteaker':   'Whiteaker Community Council',
  'West Eugene': 'West Eugene Community Organization',
  'South Eugene': null  // no single matching boundary — skipped
};

// ── STATE ──────────────────────────────────────────────────────────────────────
let neighborhoodGeoJSON = null;

const state = {
  markers: new Map(),   // id → { marker, props, lat, lng }
  activeId: null,
  visited: new Set(getVisited()),
  tour: null,           // { loopKey, stops[], currentIndex } | null
  tourRoute: null,      // Leaflet polyline for active tour
  boundaryLayers: [],   // active neighborhood boundary polygons
  savedFilters: null,
  filters: {
    neighborhoods: new Set(),
    years: new Set(),
    originBucket: 'all',  // 'all' | 'local' | 'usa' | 'international'
    visitedStatus: 'all', // 'all' | 'unvisited' | 'visited'
    hidePartial: true
  }
};

// ── HELPERS ────────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isMobile() { return window.innerWidth < 768; }

function getOriginBucket(origin) {
  if (/eugene|,\s*or\b/i.test(origin)) return 'local';
  if (/\busa\b/i.test(origin)) return 'usa';
  return 'international';
}

function getDirectionsURL(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

function getVisited() {
  try { return JSON.parse(localStorage.getItem('visited_murals') || '[]'); }
  catch { return []; }
}

function saveVisited() {
  localStorage.setItem('visited_murals', JSON.stringify([...state.visited]));
}

// ── MAP INIT ───────────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: false }).setView(INITIAL_CENTER, INITIAL_ZOOM);

L.control.zoom({ position: 'bottomleft' }).addTo(map);

const useMapbox = MAPBOX_TOKEN !== 'YOUR_TOKEN_HERE';

if (useMapbox) {
  L.tileLayer(MAPBOX_TILE_URL, {
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 19,
    attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
} else {
  // Fallback to OSM while token is not yet set
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
}

// Close drawer/popup when tapping the map
map.on('click', () => {
  if (isMobile()) closeDrawer();
  map.closePopup();
  if (state.activeId !== null) {
    deactivateMarker(state.activeId);
    state.activeId = null;
  }
});

// ── NEIGHBORHOOD BOUNDARIES ────────────────────────────────────────────────────
fetch('https://gis.eugene-or.gov/arcgis/rest/services/PDD/PDDBoundaries/MapServer/9/query?where=1%3D1&outFields=NAME&f=geojson')
  .then(r => r.json())
  .then(data => { neighborhoodGeoJSON = data; })
  .catch(() => {}); // non-critical — boundaries simply won't show if unavailable

function showNeighborhoodBoundaries(neighborhoodNames, color) {
  clearBoundaryLayers();
  if (!neighborhoodGeoJSON) return;

  const cityNames = neighborhoodNames
    .map(n => NEIGHBORHOOD_NAME_MAP[n])
    .filter(Boolean);
  if (cityNames.length === 0) return;

  const matched = {
    ...neighborhoodGeoJSON,
    features: neighborhoodGeoJSON.features.filter(f => cityNames.includes(f.properties.NAME))
  };
  if (matched.features.length === 0) return;

  const layer = L.geoJSON(matched, {
    style: {
      color,
      weight: 2,
      opacity: 0.9,
      fillColor: color,
      fillOpacity: 0.1,
      dashArray: '6, 6'
    }
  }).addTo(map);

  state.boundaryLayers.push(layer);
}

function clearBoundaryLayers() {
  state.boundaryLayers.forEach(l => map.removeLayer(l));
  state.boundaryLayers = [];
}

// ── LOAD GEOJSON ───────────────────────────────────────────────────────────────
fetch('./data/murals.geojson')
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(data => {
    document.getElementById('map-loading').remove();
    initMarkers(data.features);
    updateVisitedCounter();
    buildSidebarFilters();
    buildFilterPanel();
    buildTourCards();
    applyFilters();
  })
  .catch(() => {
    const el = document.getElementById('map-loading');
    el.innerHTML = '<p style="color:var(--accent);padding:24px;text-align:center">Failed to load mural data.<br>Please refresh.</p>';
  });

// ── PIN ICON ───────────────────────────────────────────────────────────────────
function createPinIcon(title, isVisited = false, tourNumber = null, color = '#E8401C') {
  const fill = isVisited ? '#555550' : color;
  const inner = tourNumber !== null
    ? `<text x="12" y="16" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" font-weight="600" fill="#F5F0EB">${tourNumber}</text>`
    : `<circle cx="12" cy="12" r="3.5" fill="#F5F0EB"/>`;
  const visitedLabel = isVisited ? ' — visited' : '';
  return L.divIcon({
    className: '',
    html: `<div class="mural-pin ${isVisited ? 'visited' : 'unvisited'}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}${visitedLabel}" tabindex="0" role="button">
             <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
               <circle cx="12" cy="12" r="10" fill="${fill}" stroke="#F5F0EB" stroke-width="1.5"/>
               ${inner}
             </svg>
           </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -16]
  });
}

// ── MARKERS ────────────────────────────────────────────────────────────────────
function initMarkers(features) {
  features.forEach(f => {
    const props = f.properties;
    const [lat, lng] = props.latLng;
    const isVisited = state.visited.has(props.id);
    const marker = L.marker([lat, lng], {
      icon: createPinIcon(props.title, isVisited, null, getMuralColor(props.id))
    });
    marker.on('click', () => handlePinClick(props, lat, lng, marker));
    marker.addTo(map);
    state.markers.set(props.id, { marker, props, lat, lng });
  });
}

function handlePinClick(props, lat, lng, marker) {
  if (state.activeId !== null && state.activeId !== props.id) {
    deactivateMarker(state.activeId);
  }
  state.activeId = props.id;
  activateMarker(props.id);
  map.closePopup();
  showPinPopup(props, lat, lng);
}

function activateMarker(id) {
  const entry = state.markers.get(id);
  if (!entry) return;
  const el = entry.marker.getElement();
  if (el) el.querySelector('.mural-pin')?.classList.add('active');
}

function deactivateMarker(id) {
  const entry = state.markers.get(id);
  if (!entry) return;
  const el = entry.marker.getElement();
  if (el) el.querySelector('.mural-pin')?.classList.remove('active');
}

// ── POPUP ──────────────────────────────────────────────────────────────────────
function showPinPopup(props, lat, lng) {
  const photoSrc = props.photo || './assets/images/placeholder.svg';
  const popup = L.popup({ closeButton: false, offset: [0, -4], autoPan: true })
    .setLatLng([lat, lng])
    .setContent(
      `<div class="pin-popup" role="button" tabindex="0" aria-label="Open details for ${escapeHtml(props.title)}">
         <img src="${escapeHtml(photoSrc)}" alt="${escapeHtml(props.title)}" class="popup-img" loading="lazy" onerror="this.src='./assets/images/placeholder.svg'">
         <div class="popup-info">
           <p class="popup-title">${escapeHtml(props.title)}</p>
           <p class="popup-artist">${escapeHtml(props.artist)} · ${props.year}</p>
         </div>
       </div>`
    )
    .openOn(map);

  // Click popup → open full detail and close popup
  setTimeout(() => {
    const el = popup.getElement();
    if (!el) return;
    const handler = () => { map.closePopup(); openDetail(props); };
    el.querySelector('.pin-popup')?.addEventListener('click', handler);
    el.querySelector('.pin-popup')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  }, 0);
}

// ── DETAIL PANEL ───────────────────────────────────────────────────────────────
function openDetail(props) {
  const html = buildDetailHTML(props);
  if (isMobile()) {
    document.getElementById('drawer-content').innerHTML = html;
    openDrawer();
  } else {
    document.getElementById('sidebar-content').innerHTML = html;
  }
  bindDetailActions(props.id);
}

function buildDetailHTML(props) {
  const isVisited = state.visited.has(props.id);
  const photoSrc = props.photo || './assets/images/placeholder.svg';
  const visitedBtn = isVisited
    ? `<button class="btn-visited active" data-id="${props.id}" aria-pressed="true" aria-label="Mark as unvisited">&#10003; Visited</button>`
    : `<button class="btn-visited" data-id="${props.id}" aria-pressed="false" aria-label="Mark as visited">Mark as Visited</button>`;

  const isTourStop = state.tour && state.tour.stops.includes(props.id);
  const directionsBtn = isTourStop
    ? `<a href="${getDirectionsURL(props.latLng[0], props.latLng[1])}" target="_blank" rel="noopener" class="btn-action" aria-label="Get walking directions to this stop">Get Directions to This Stop</a>`
    : `<a href="${getDirectionsURL(props.latLng[0], props.latLng[1])}" target="_blank" rel="noopener" class="btn-action" aria-label="Get walking directions">Get Directions</a>`;

  return `<img src="${escapeHtml(photoSrc)}" alt="${escapeHtml(props.title)}" class="detail-img" loading="lazy" onerror="this.src='./assets/images/placeholder.svg'">
    <div class="detail-body">
      <h2 class="detail-title">${escapeHtml(props.title)}</h2>
      <p class="detail-meta">${escapeHtml(props.artist)} · ${props.year} · ${escapeHtml(props.origin)}</p>
      <p class="detail-address">${escapeHtml(props.address)}</p>
      <hr>
      <p class="detail-description">${escapeHtml(props.description)}</p>
      ${visitedBtn}
      <div class="detail-actions">
        ${directionsBtn}
        <a href="${escapeHtml(props.website)}" target="_blank" rel="noopener" class="btn-action btn-action-secondary" aria-label="Learn more about this mural">Learn More</a>
      </div>
    </div>`;
}

function bindDetailActions(id) {
  const container = isMobile()
    ? document.getElementById('drawer-content')
    : document.getElementById('sidebar-content');
  const btn = container?.querySelector('.btn-visited[data-id]');
  if (btn) btn.addEventListener('click', () => toggleVisited(id));
}

// ── VISITED ────────────────────────────────────────────────────────────────────
function toggleVisited(id) {
  const isNowVisited = !state.visited.has(id);
  if (isNowVisited) state.visited.add(id);
  else state.visited.delete(id);

  saveVisited();

  const entry = state.markers.get(id);
  if (entry) {
    const stopIndex = state.tour ? state.tour.stops.indexOf(id) : -1;
    const tourNum = stopIndex >= 0 ? stopIndex + 1 : null;
    entry.marker.setIcon(createPinIcon(entry.props.title, isNowVisited, tourNum, getMuralColor(id)));
  }

  const container = isMobile()
    ? document.getElementById('drawer-content')
    : document.getElementById('sidebar-content');
  const btn = container?.querySelector('.btn-visited[data-id]');
  if (btn) {
    btn.setAttribute('aria-pressed', String(isNowVisited));
    btn.setAttribute('aria-label', isNowVisited ? 'Mark as unvisited' : 'Mark as visited');
    btn.innerHTML = isNowVisited ? '&#10003; Visited' : 'Mark as Visited';
    btn.classList.toggle('active', isNowVisited);
  }

  updateVisitedCounter();
}

function updateVisitedCounter() {
  const el = document.getElementById('visited-counter');
  const count = state.visited.size;
  if (count >= TOTAL_MURALS) {
    el.textContent = `All ${TOTAL_MURALS} murals visited — you've seen them all!`;
    el.classList.add('complete');
  } else {
    el.textContent = `${count} / ${TOTAL_MURALS} visited`;
    el.classList.remove('complete');
  }
}

// ── DRAWER ─────────────────────────────────────────────────────────────────────
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
}

function initDrawerSwipe() {
  const drawer = document.getElementById('drawer');
  let startY = 0, currentY = 0, dragging = false;

  drawer.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    currentY = startY;
    dragging = true;
  }, { passive: true });

  drawer.addEventListener('touchmove', e => {
    if (!dragging) return;
    currentY = e.touches[0].clientY;
  }, { passive: true });

  drawer.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    if (currentY - startY > 60) closeDrawer();
  });
}

// ── FILTERS ────────────────────────────────────────────────────────────────────
const NEIGHBORHOODS = ['Downtown', 'Whiteaker', 'West Eugene', 'South Eugene'];
const YEARS = ['2016', '2017', '2018', '2019'];
const ORIGIN_BUCKETS = [
  { value: 'all', label: 'All origins' },
  { value: 'local', label: 'Local (Eugene/OR)' },
  { value: 'usa', label: 'USA (Other)' },
  { value: 'international', label: 'International' }
];
const VISITED_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unvisited', label: 'Unvisited only' },
  { value: 'visited', label: 'Visited only' }
];

function countActiveFilters() {
  let n = 0;
  n += state.filters.neighborhoods.size;
  n += state.filters.years.size;
  if (state.filters.originBucket !== 'all') n++;
  if (state.filters.visitedStatus !== 'all') n++;
  if (!state.filters.hidePartial) n++;
  return n;
}

function updateFilterBadge() {
  const btn = document.getElementById('filter-btn');
  if (!btn) return;
  const n = countActiveFilters();
  const existing = btn.querySelector('.filter-badge');
  if (existing) existing.remove();
  if (n > 0) {
    const badge = document.createElement('span');
    badge.className = 'filter-badge';
    badge.textContent = n;
    btn.appendChild(badge);
  }
}

function applyFilters() {
  const f = state.filters;
  state.markers.forEach(({ marker, props }, id) => {
    if (state.tour) return; // tour controls visibility

    let show = true;
    if (f.neighborhoods.size > 0 && !f.neighborhoods.has(props.neighborhood)) show = false;
    if (f.years.size > 0 && !f.years.has(String(props.year))) show = false;
    if (f.originBucket !== 'all' && getOriginBucket(props.origin) !== f.originBucket) show = false;
    if (f.visitedStatus === 'visited' && !state.visited.has(id)) show = false;
    if (f.visitedStatus === 'unvisited' && state.visited.has(id)) show = false;
    if (f.hidePartial && props.status === 'partial') show = false;

    if (show) marker.addTo(map);
    else if (map.hasLayer(marker)) map.removeLayer(marker);
  });

  // Show neighborhood boundaries when filtering by neighborhood
  if (!state.tour) {
    if (f.neighborhoods.size > 0) {
      showNeighborhoodBoundaries([...f.neighborhoods], 'var(--accent)');
    } else {
      clearBoundaryLayers();
    }
  }

  updateFilterBadge();
}

function resetFilters() {
  state.filters.neighborhoods.clear();
  state.filters.years.clear();
  state.filters.originBucket = 'all';
  state.filters.visitedStatus = 'all';
  state.filters.hidePartial = true;
}

function buildFilterControls(container) {
  container.innerHTML = `
    <div class="filter-section">
      <h3>Year</h3>
      <div class="sf-row">
        ${YEARS.map(y => `<button class="chip" data-fc="year" data-val="${y}">${y}</button>`).join('')}
      </div>
    </div>
    <div class="filter-section">
      <h3>Neighborhood</h3>
      <div class="sf-row">
        ${NEIGHBORHOODS.map(n => `<button class="chip" data-fc="neighborhood" data-val="${n}">${n}</button>`).join('')}
      </div>
    </div>
    <div class="filter-section">
      <h3>Artist Origin</h3>
      <div class="sf-row">
        ${ORIGIN_BUCKETS.filter(o => o.value !== 'all').map(o => `<button class="chip" data-fc="origin" data-val="${o.value}">${o.label}</button>`).join('')}
      </div>
    </div>
    <div class="filter-section">
      <h3>Visited</h3>
      <div class="sf-row">
        ${VISITED_OPTIONS.filter(v => v.value !== 'all').map(v => `<button class="chip" data-fc="visited" data-val="${v.value}">${v.label}</button>`).join('')}
      </div>
    </div>
    <div class="filter-section">
      <h3>Mural Status</h3>
      <div class="sf-row">
        <button class="chip" data-fc="partial" data-val="true">Show partial/removed</button>
      </div>
    </div>`;

  updateFilterChipStates(container);

  container.addEventListener('click', e => {
    const chip = e.target.closest('[data-fc]');
    if (!chip) return;
    const type = chip.dataset.fc, val = chip.dataset.val;
    if (type === 'year') {
      state.filters.years.has(val) ? state.filters.years.delete(val) : state.filters.years.add(val);
    } else if (type === 'neighborhood') {
      state.filters.neighborhoods.has(val) ? state.filters.neighborhoods.delete(val) : state.filters.neighborhoods.add(val);
    } else if (type === 'origin') {
      state.filters.originBucket = state.filters.originBucket === val ? 'all' : val;
    } else if (type === 'visited') {
      state.filters.visitedStatus = state.filters.visitedStatus === val ? 'all' : val;
    } else if (type === 'partial') {
      state.filters.hidePartial = !state.filters.hidePartial;
    }
    applyFilters();
    updateFilterChipStates(container);
    buildSidebarFilters();
  });
}

function updateFilterChipStates(container) {
  container.querySelectorAll('[data-fc]').forEach(chip => {
    const type = chip.dataset.fc, val = chip.dataset.val;
    let active = false;
    if (type === 'year') active = state.filters.years.has(val);
    else if (type === 'neighborhood') active = state.filters.neighborhoods.has(val);
    else if (type === 'origin') active = state.filters.originBucket === val;
    else if (type === 'visited') active = state.filters.visitedStatus === val;
    else if (type === 'partial') active = !state.filters.hidePartial;
    chip.classList.toggle('active', active);
  });
}

// Mobile filter panel
function buildFilterPanel() {
  buildFilterControls(document.getElementById('filter-panel-body'));
}

function openFilterPanel() {
  const panel = document.getElementById('filter-panel');
  const overlay = document.getElementById('filter-overlay');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeFilterPanel() {
  const panel = document.getElementById('filter-panel');
  const overlay = document.getElementById('filter-overlay');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
}

// Desktop sidebar filter chips
function buildSidebarFilters() {
  const container = document.getElementById('sidebar-filter-section');
  if (!container) return;
  const active = countActiveFilters();
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span class="sf-heading">Filters${active > 0 ? ` (${active})` : ''}</span>
      ${active > 0 ? '<button class="sf-clear" id="sf-clear-btn">Clear</button>' : ''}
    </div>
    <div class="sf-row">
      ${NEIGHBORHOODS.map(n => `<button class="chip ${state.filters.neighborhoods.has(n) ? 'active' : ''}" data-sf-neighborhood="${n}">${n}</button>`).join('')}
    </div>
    <div class="sf-row">
      ${YEARS.map(y => `<button class="chip ${state.filters.years.has(y) ? 'active' : ''}" data-sf-year="${y}">${y}</button>`).join('')}
    </div>
    <div class="sf-row">
      ${ORIGIN_BUCKETS.filter(o => o.value !== 'all').map(o => `<button class="chip ${state.filters.originBucket === o.value ? 'active' : ''}" data-sf-origin="${o.value}">${o.label}</button>`).join('')}
    </div>
    <div class="sf-row">
      <button class="chip ${state.filters.visitedStatus === 'unvisited' ? 'active' : ''}" data-sf-visited="unvisited">Unvisited</button>
      <button class="chip ${state.filters.visitedStatus === 'visited' ? 'active' : ''}" data-sf-visited="visited">Visited</button>
      <button class="chip ${!state.filters.hidePartial ? 'active' : ''}" data-sf-partial="true">Show partial</button>
    </div>`;

  document.getElementById('sf-clear-btn')?.addEventListener('click', () => {
    resetFilters();
    applyFilters();
    buildSidebarFilters();
  });

  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.sfNeighborhood) {
        const n = chip.dataset.sfNeighborhood;
        if (state.filters.neighborhoods.has(n)) state.filters.neighborhoods.delete(n);
        else state.filters.neighborhoods.add(n);
      } else if (chip.dataset.sfYear) {
        const y = chip.dataset.sfYear;
        if (state.filters.years.has(y)) state.filters.years.delete(y);
        else state.filters.years.add(y);
      } else if (chip.dataset.sfOrigin) {
        const o = chip.dataset.sfOrigin;
        state.filters.originBucket = state.filters.originBucket === o ? 'all' : o;
      } else if (chip.dataset.sfVisited) {
        const v = chip.dataset.sfVisited;
        state.filters.visitedStatus = state.filters.visitedStatus === v ? 'all' : v;
      } else if (chip.dataset.sfPartial) {
        state.filters.hidePartial = !state.filters.hidePartial;
      }
      applyFilters();
      buildSidebarFilters();
    });
  });
}

// ── TOUR ───────────────────────────────────────────────────────────────────────
function buildTourCards() {
  const container = document.getElementById('tour-cards');
  container.innerHTML = Object.entries(TOUR_LOOPS).map(([key, loop]) => `
    <div class="tour-card">
      <div class="tour-card-dot" style="background:${loop.color}"></div>
      <div class="tour-card-info">
        <div class="tour-card-name">${loop.name}</div>
        <div class="tour-card-desc">${loop.description}</div>
      </div>
      <button class="tour-card-btn" data-tour-key="${key}">Start Tour &#8594;</button>
    </div>`).join('');

  container.querySelectorAll('.tour-card-btn').forEach(btn => {
    btn.addEventListener('click', () => startTour(btn.dataset.tourKey));
  });
}

function openTourSheet() {
  document.getElementById('tour-sheet').classList.add('open');
  document.getElementById('tour-sheet').setAttribute('aria-hidden', 'false');
  document.getElementById('tour-overlay').classList.remove('hidden');
  document.getElementById('tour-overlay').setAttribute('aria-hidden', 'false');
}

function closeTourSheet() {
  document.getElementById('tour-sheet').classList.remove('open');
  document.getElementById('tour-sheet').setAttribute('aria-hidden', 'true');
  document.getElementById('tour-overlay').classList.add('hidden');
  document.getElementById('tour-overlay').setAttribute('aria-hidden', 'true');
}

function startTour(loopKey) {
  const loop = TOUR_LOOPS[loopKey];

  // Save current filter state
  state.savedFilters = {
    neighborhoods: [...state.filters.neighborhoods],
    years: [...state.filters.years],
    originBucket: state.filters.originBucket,
    visitedStatus: state.filters.visitedStatus,
    hidePartial: state.filters.hidePartial
  };

  state.tour = { loopKey, stops: loop.mural_ids, currentIndex: 0 };

  // Disable filter controls
  const filterBtn = document.getElementById('filter-btn');
  if (filterBtn) { filterBtn.disabled = true; filterBtn.title = 'Filters unavailable during tour'; }

  // Dim non-loop markers, number loop markers
  state.markers.forEach(({ marker, props }, id) => {
    const stopIndex = loop.mural_ids.indexOf(id);
    if (stopIndex === -1) {
      marker.addTo(map);
      marker.setOpacity(0.3);
    } else {
      marker.addTo(map);
      marker.setOpacity(1);
      marker.setIcon(createPinIcon(props.title, state.visited.has(id), stopIndex + 1, loop.color));
    }
  });

  // Show neighborhood boundaries for this tour's pins
  const tourNeighborhoods = [...new Set(
    loop.mural_ids.map(id => state.markers.get(id)?.props.neighborhood).filter(Boolean)
  )];
  showNeighborhoodBoundaries(tourNeighborhoods, loop.color);

  // Draw walking route line
  const routeCoords = loop.mural_ids
    .map(id => state.markers.get(id))
    .filter(Boolean)
    .map(({ lat, lng }) => [lat, lng]);
  state.tourRoute = L.polyline(routeCoords, {
    color: loop.color,
    weight: 4,
    opacity: 0.75,
    dashArray: '8, 10'
  }).addTo(map);

  document.getElementById('tour-progress').classList.remove('hidden');
  document.body.classList.add('tour-active');

  closeTourSheet();
  goToTourStop(0);
}

function goToTourStop(index) {
  const { stops } = state.tour;
  state.tour.currentIndex = index;
  const id = stops[index];
  const entry = state.markers.get(id);
  if (!entry) return;
  const { props, lat, lng } = entry;

  // Update progress text
  document.getElementById('tour-progress-text').textContent =
    `Stop ${index + 1} of ${stops.length} — ${props.title}`;
  document.getElementById('tour-prev').disabled = index === 0;
  document.getElementById('tour-next').disabled = index === stops.length - 1;

  // Fly to marker
  map.flyTo([lat, lng], 15, { animate: true, duration: 0.8 });

  // Activate marker
  if (state.activeId !== null && state.activeId !== id) deactivateMarker(state.activeId);
  state.activeId = id;
  activateMarker(id);

  // Open detail
  openDetail(props);
}

function exitTour() {
  if (!state.tour) return;

  // Restore all markers
  state.markers.forEach(({ marker, props }, id) => {
    marker.setOpacity(1);
    marker.setIcon(createPinIcon(props.title, state.visited.has(id), null, getMuralColor(id)));
  });

  // Re-enable filters
  const filterBtn = document.getElementById('filter-btn');
  if (filterBtn) { filterBtn.disabled = false; filterBtn.title = ''; }

  // Restore saved filters
  if (state.savedFilters) {
    state.filters.neighborhoods = new Set(state.savedFilters.neighborhoods);
    state.filters.years = new Set(state.savedFilters.years);
    state.filters.originBucket = state.savedFilters.originBucket;
    state.filters.visitedStatus = state.savedFilters.visitedStatus;
    state.filters.hidePartial = state.savedFilters.hidePartial;
    state.savedFilters = null;
    applyFilters();
    buildSidebarFilters();
    updateFilterChipStates(document.getElementById('filter-panel-body'));
  }

  if (state.tourRoute) { map.removeLayer(state.tourRoute); state.tourRoute = null; }
  clearBoundaryLayers();

  state.tour = null;
  if (state.activeId !== null) { deactivateMarker(state.activeId); state.activeId = null; }

  document.getElementById('tour-progress').classList.add('hidden');
  document.body.classList.remove('tour-active');

  closeDrawer();
  document.getElementById('sidebar-content').innerHTML =
    '<div class="sidebar-empty"><p>Select a mural on the map to learn more.</p></div>';
  map.closePopup();
}

// ── NEAR ME ────────────────────────────────────────────────────────────────────
function goToNearMe() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => map.flyTo([pos.coords.latitude, pos.coords.longitude], 15),
    () => alert('Unable to retrieve your location.')
  );
}

// ── SWIPE TO CLOSE DRAWER ──────────────────────────────────────────────────────
initDrawerSwipe();

// ── EVENT LISTENERS ────────────────────────────────────────────────────────────
document.getElementById('filter-btn')?.addEventListener('click', openFilterPanel);
document.getElementById('filter-close')?.addEventListener('click', closeFilterPanel);
document.getElementById('filter-overlay')?.addEventListener('click', closeFilterPanel);

document.getElementById('filter-clear')?.addEventListener('click', () => {
  resetFilters();
  applyFilters();
  updateFilterChipStates(document.getElementById('filter-panel-body'));
  buildSidebarFilters();
  closeFilterPanel();
});

document.getElementById('btn-near-me')?.addEventListener('click', goToNearMe);

document.getElementById('btn-tour')?.addEventListener('click', () => {
  if (state.tour) return; // already in tour
  openTourSheet();
});

document.getElementById('tour-sheet-close')?.addEventListener('click', closeTourSheet);
document.getElementById('tour-overlay')?.addEventListener('click', closeTourSheet);

document.getElementById('tour-prev')?.addEventListener('click', () => {
  if (state.tour && state.tour.currentIndex > 0) goToTourStop(state.tour.currentIndex - 1);
});

document.getElementById('tour-next')?.addEventListener('click', () => {
  if (state.tour && state.tour.currentIndex < state.tour.stops.length - 1) goToTourStop(state.tour.currentIndex + 1);
});

document.getElementById('tour-exit')?.addEventListener('click', exitTour);

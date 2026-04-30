/**
 * 20x21EUG Mural Tour — app.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Interactive walking-tour map for the 20x21EUG Mural Project, Eugene OR.
 * Built with Leaflet.js, Mapbox tiles, and the Mapbox Directions API.
 *
 * HOW TO ADAPT THIS FOR YOUR OWN PROJECT
 * ────────────────────────────────────────
 * 1. Get a free Mapbox account at https://mapbox.com and create a public token.
 *    Set MAPBOX_TOKEN below. REQUIRED: restrict the token to your deployment
 *    domain in the Mapbox dashboard (Account → Access Tokens → URL restrictions).
 *    Without URL restrictions, anyone can use your token against your quota.
 *
 * 2. Replace ./data/murals.geojson with your own point-of-interest data.
 *    Each GeoJSON feature needs these properties:
 *      id           {number}          Unique integer (1, 2, 3 …)
 *      title        {string}          Display name
 *      artist       {string}          Creator name
 *      origin       {string}          Artist's city/country (e.g. "Eugene, OR")
 *      year         {number}          Year created
 *      neighborhood {string}          Must match a key in NEIGHBORHOOD_NAME_MAP
 *      address      {string}          Street address
 *      description  {string}          Long description
 *      photo        {string}          Relative image path (e.g. "./assets/images/1.jpg")
 *      website      {string}          Full https:// URL for "Learn More"
 *      latLng       {[number,number]} [latitude, longitude]
 *
 * 3. Optionally replace ./data/Eugene_Neighborhoods.geojson with polygon
 *    boundaries for your area. Boundaries are decorative — the app works without them.
 *
 * 4. Update TOUR_ROUTES, NEIGHBORHOOD_NAME_MAP, and TOTAL_MURALS below.
 *
 * DEPENDENCIES (loaded via CDN in index.html)
 *   Leaflet 1.9.4  —  https://leafletjs.com
 *   Google Fonts   —  Bebas Neue + Inter
 */

// ── MAPBOX CONFIG ──────────────────────────────────────────────────────────────
// Replace YOUR_TOKEN_HERE with your Mapbox public token (starts with pk.)
// Restrict the token to your domain — this is required, not optional.
const MAPBOX_TOKEN = 'pk.eyJ1IjoidGhvcm5oaWtvc3UiLCJhIjoiY21vajM0OWhsMDN4eDJxb2w2ZmlzcHRneSJ9.joS0q8uIBJ8qiXu84Vh1sQ';
const MAPBOX_TILE_URL = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`;

// Starting map view — set to the center of your city.
// Zoom 13 shows a walkable area; 15 is block-level; 12 is neighborhood-level.
const INITIAL_CENTER = [44.0490, -123.0950]; // Eugene, OR downtown
const INITIAL_ZOOM = 13;
const TOTAL_MURALS = 24; // Update to match the feature count in murals.geojson

// ── TOUR ROUTES ────────────────────────────────────────────────────────────────
// Each entry defines a named walking tour over a subset of murals.
//
//   name       Display name shown in the tour selection card
//   color      Hex color for pins, route line, and neighborhood boundary
//   miles      Walking distance string shown on the card (e.g. "1.5")
//   duration   Estimated time string (e.g. "~1.5 hrs")
//   mural_ids  Ordered array of mural IDs defining the walking sequence.
//              Order was optimized with a Nearest Neighbor + 2-opt TSP heuristic
//              to minimize total walking distance. Re-run optimization if you
//              add or move stops. The Mapbox Directions API supports up to 25
//              waypoints per request — keep tours under that limit.
const TOUR_ROUTES = {
  downtown: {
    name: 'Downtown Route',
    color: '#E8401C',
    miles: '1.5',
    duration: '~1.5 hrs',
    mural_ids: [15, 19, 11, 20, 18, 9, 17, 8, 2, 5, 12, 1, 7, 23, 16]
  },
  whiteaker: {
    name: 'Whiteaker Route',
    color: '#4A90D9',
    miles: '1.8',
    duration: '~1 hr 15 min',
    mural_ids: [3, 10, 4, 6, 22, 13]
  },
  south: {
    name: 'South Eugene',
    color: '#7BC67E',
    miles: '1.7',
    duration: '~1 hr',
    mural_ids: [14, 21]
  },
  west: {
    name: 'West Eugene',
    color: '#D4A843',
    miles: '<0.1',
    duration: '~15 min',
    mural_ids: [24]
  }
};

function getMuralColor(id) {
  for (const route of Object.values(TOUR_ROUTES)) {
    if (route.mural_ids.includes(id)) return route.color;
  }
  return '#888880'; // neutral for murals not assigned to a route
}

// Maps the neighborhood display names used in mural properties to the feature
// names in the GeoJSON boundary file. Update when adapting for a different city.
const NEIGHBORHOOD_NAME_MAP = {
  'Downtown':    'Downtown Neighborhood Association',
  'Whiteaker':   'Whiteaker Community Council',
  'West Eugene': 'West Eugene Community Organization',
  'South Eugene': ['Friendly Area Neighbors', 'West University Neighbors']
};

// ── APPLICATION STATE ──────────────────────────────────────────────────────────
// All mutable runtime state lives here. neighborhoodGeoJSON is held separately
// because it loads asynchronously and may still be null when markers are created.
let neighborhoodGeoJSON = null;

const state = {
  markers:      new Map(),  // Map<id, { marker: L.Marker, props, lat, lng }>
  activeId:     null,       // ID of the currently highlighted mural, or null
  visited:      new Set(getVisited()), // Set<id> — persisted in localStorage
  tour:         null,       // { routeKey, stops: number[], currentIndex } | null
  tourRoute:    null,       // Leaflet polyline for the active walking route
  boundaryLayers: [],       // Leaflet layers for neighborhood boundary polygons
  savedFilters: null,       // filter snapshot saved on tour start; restored on exit
  gpsWatchId:   null,       // ID from navigator.geolocation.watchPosition, or null
  gpsMarker:    null,       // Leaflet marker for the user's live GPS position, or null
  filters: {
    neighborhoods: new Set(), // Set of neighborhood name strings
    years:         new Set(), // Set of year strings ('2016', '2017', …)
    originBucket:  'all',     // 'all' | 'local' | 'usa' | 'international'
    visitedStatus: 'all',     // 'all' | 'unvisited' | 'visited'
  }
};

// ── UTILITY HELPERS ────────────────────────────────────────────────────────────

/**
 * Escapes a value for safe insertion into HTML. Handles null/undefined gracefully.
 * Call this on every external data value before inserting into innerHTML.
 */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Validates that a URL uses http: or https: before inserting it into an <a href>.
 * Prevents javascript: protocol injection if GeoJSON data is ever tampered with.
 */
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? url : '#';
  } catch {
    return '#';
  }
}

/** Returns true when the viewport is narrower than the desktop breakpoint. */
function isMobile() { return window.innerWidth < 768; }

/** Returns true when the OS "reduce motion" accessibility setting is enabled. */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function showToast(message) {
  let toast = document.getElementById('a11y-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'a11y-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

function getOriginBucket(origin) {
  if (/eugene|,\s*or\b/i.test(origin)) return 'local';
  if (/\busa\b/i.test(origin)) return 'usa';
  return 'international';
}

/** Builds a Google Maps walking-directions URL for the given coordinate. */
function getDirectionsURL(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

/**
 * Reads visited mural IDs from localStorage.
 * Falls back to [] if the entry is missing or the stored JSON is malformed.
 */
function getVisited() {
  try { return JSON.parse(localStorage.getItem('visited_murals') || '[]'); }
  catch { return []; }
}

/** Persists the current visited Set to localStorage as a JSON array of IDs. */
function saveVisited() {
  localStorage.setItem('visited_murals', JSON.stringify([...state.visited]));
}

// ── MAP INITIALIZATION ─────────────────────────────────────────────────────────
// tap: false disables Leaflet's synthetic click emulation, which interfered with
// the native iOS double-tap-to-zoom gesture on modern mobile browsers.
const map = L.map('map', { zoomControl: false, tap: false }).setView(INITIAL_CENTER, INITIAL_ZOOM);

// Place zoom controls at bottom-left to stay clear of the fixed header.
L.control.zoom({ position: 'bottomleft' }).addTo(map);

// Use Mapbox dark tiles when a real token is configured; fall back to OSM.
// The OSM fallback is useful for local development but lacks the dark theme.
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
fetch('./data/Eugene_Neighborhoods.geojson')
  .then(r => r.json())
  .then(data => { neighborhoodGeoJSON = data; })
  .catch(() => {}); // non-critical — boundaries simply won't show if unavailable

function getNeighborhoodColor(neighborhood) {
  for (const route of Object.values(TOUR_ROUTES)) {
    if (route.mural_ids.some(id => state.markers.get(id)?.props.neighborhood === neighborhood)) {
      return route.color;
    }
  }
  return '#888880';
}

function showNeighborhoodBoundary(neighborhoodName, color) {
  if (!neighborhoodGeoJSON) return;
  const cityNames = NEIGHBORHOOD_NAME_MAP[neighborhoodName];
  if (!cityNames) return;
  const names = Array.isArray(cityNames) ? cityNames : [cityNames];

  const matched = {
    ...neighborhoodGeoJSON,
    features: neighborhoodGeoJSON.features.filter(f => names.includes(f.properties.name))
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

// ── CUSTOM MAP PINS ────────────────────────────────────────────────────────────

/**
 * Creates a custom Leaflet divIcon SVG pin. Inner content varies by state:
 *   tourNumber set → shows stop number
 *   isVisited       → shows a checkmark
 *   default         → shows a small dot
 *
 * className: '' prevents Leaflet from adding the default white-box leaflet-div-icon style.
 *
 * @param {string}      title      - Used for aria-label and title attribute
 * @param {boolean}     isVisited  - Renders grey with checkmark when true
 * @param {number|null} tourNumber - Stop number displayed during tour mode
 * @param {string}      color      - Hex fill color (usually the route color)
 * @returns {L.DivIcon}
 */
function createPinIcon(title, isVisited = false, tourNumber = null, color = '#E8401C') {
  const fill = isVisited ? '#555550' : color;
  const inner = tourNumber !== null
    ? `<text x="12" y="16" text-anchor="middle" font-family="Inter,sans-serif" font-size="9" font-weight="600" fill="#F5F0EB">${tourNumber}</text>`
    : isVisited
      ? `<path d="M8,12.5 L10.5,15 L16,9.5" stroke="#F5F0EB" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
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

/**
 * Creates a Leaflet marker for each GeoJSON feature, registers click and keyboard
 * handlers, stores it in state.markers, and fits the map to show all markers.
 * @param {object[]} features - GeoJSON feature array from murals.geojson
 */
function initMarkers(features) {
  const latlngs = [];
  features.forEach(f => {
    const props = f.properties;
    const [lat, lng] = props.latLng;
    const isVisited = state.visited.has(props.id);
    const marker = L.marker([lat, lng], {
      icon: createPinIcon(props.title, isVisited, null, getMuralColor(props.id))
    });
    marker.on('click', () => handlePinClick(props, lat, lng, marker));
    marker.addTo(map);
    const markerEl = marker.getElement();
    const pinEl = markerEl?.querySelector('.mural-pin');
    if (pinEl) {
      pinEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handlePinClick(props, lat, lng, marker);
        }
      });
    }
    state.markers.set(props.id, { marker, props, lat, lng });
    latlngs.push([lat, lng]);
  });
  if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
}

/**
 * Handles a marker tap/click. During a tour, tapping a tour-stop pin navigates
 * to it (updating the peek card and progress bar) and expands the drawer on mobile.
 * Outside a tour, shows a popup on mobile and opens the full detail on desktop.
 */
function handlePinClick(props, lat, lng, marker) {
  if (state.activeId !== null && state.activeId !== props.id) {
    deactivateMarker(state.activeId);
  }
  state.activeId = props.id;
  activateMarker(props.id);
  map.closePopup();

  if (state.tour) {
    const stopIndex = state.tour.stops.indexOf(props.id);
    if (stopIndex !== -1) {
      goToTourStop(stopIndex);
      if (isMobile()) expandDrawer();
      return;
    }
  }

  showPinPopup(props, lat, lng);
  if (!isMobile()) openDetail(props);
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
  const popup = L.popup({ closeButton: false, offset: [0, -4], autoPan: true, maxWidth: 200 })
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
    ? `<a href="${getDirectionsURL(props.latLng[0], props.latLng[1])}" target="_blank" rel="noopener" class="btn-action" aria-label="Get walking directions to this stop (opens in new tab)">Get Directions to This Stop</a>`
    : `<a href="${getDirectionsURL(props.latLng[0], props.latLng[1])}" target="_blank" rel="noopener" class="btn-action" aria-label="Get walking directions (opens in new tab)">Get Directions</a>`;

  const originBucket = getOriginBucket(props.origin);
  const originLabel = { local: 'Local', usa: 'USA', international: 'International' }[originBucket] || props.origin;
  const routeColor = getMuralColor(props.id);

  return `<img src="${escapeHtml(photoSrc)}" alt="${escapeHtml(props.title)}" class="detail-img" loading="lazy" onerror="this.src='./assets/images/placeholder.svg'">
    <div class="detail-body">
      <h2 class="detail-title">${escapeHtml(props.title)}</h2>
      <p class="detail-meta">${escapeHtml(props.artist)} · ${escapeHtml(props.origin)}</p>
      <div class="detail-tags" aria-label="Mural attributes">
        <span class="detail-tag detail-tag-neighborhood" style="border-color:${routeColor};color:${routeColor}">${escapeHtml(props.neighborhood)}</span>
        <span class="detail-tag">${escapeHtml(String(props.year))}</span>
        <span class="detail-tag">${escapeHtml(originLabel)}</span>
        <span class="detail-tag detail-tag-visited${isVisited ? ' active' : ''}" aria-label="${isVisited ? 'Visited' : 'Not yet visited'}">${isVisited ? '&#10003;&nbsp;Visited' : 'Not&nbsp;Visited'}</span>
      </div>
      <p class="detail-address">${escapeHtml(props.address)}</p>
      <hr>
      <p class="detail-description">${escapeHtml(props.description)}</p>
      ${visitedBtn}
      <div class="detail-actions">
        ${directionsBtn}
        <a href="${safeUrl(props.website)}" target="_blank" rel="noopener" class="btn-action btn-action-secondary" aria-label="Learn more about this mural (opens in new tab)">Learn More</a>
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

  const visitedTag = container?.querySelector('.detail-tag-visited');
  if (visitedTag) {
    visitedTag.classList.toggle('active', isNowVisited);
    visitedTag.setAttribute('aria-label', isNowVisited ? 'Visited' : 'Not yet visited');
    visitedTag.innerHTML = isNowVisited ? '&#10003;&nbsp;Visited' : 'Not&nbsp;Visited';
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

// ── DRAWER STATE MACHINE ───────────────────────────────────────────────────────
// The mobile drawer has three states driven by CSS classes:
//   hidden  (no class)  translateY(100%)          — fully off screen
//   peek    (.peek)     translateY(100% - 120px)  — peek strip visible at bottom
//   open    (.open)     translateY(0)             — full height (65vh)
//
// Tour mode modifies transitions:
//   openDrawer  → goes to peek (not open) during a tour, to keep map visible
//   closeDrawer → collapses to peek (not hidden) during a tour, to keep peek card
//   expandDrawer → always goes to full open (triggered by tapping the peek card)

function openDrawer() {
  const drawer = document.getElementById('drawer');
  // During a tour on mobile: go to peek if not already open; keep open if already open
  if (state.tour && isMobile()) {
    if (!drawer.classList.contains('open')) {
      drawer.classList.remove('open');
      drawer.classList.add('peek');
    }
  } else {
    drawer.classList.remove('peek');
    drawer.classList.add('open');
  }
}

function closeDrawer() {
  const drawer = document.getElementById('drawer');
  // During a tour, swipe-down on the full view collapses to peek (not hidden)
  if (state.tour && isMobile() && drawer.classList.contains('open')) {
    drawer.classList.remove('open');
    drawer.classList.add('peek');
  } else {
    drawer.classList.remove('open');
    drawer.classList.remove('peek');
  }
}

function expandDrawer() {
  const drawer = document.getElementById('drawer');
  drawer.classList.remove('peek');
  drawer.classList.add('open');
}

function updateTourPeekCard(props, index) {
  const total = state.tour?.stops.length ?? 0;
  const photoSrc = props.photo || './assets/images/placeholder.svg';
  const img = document.getElementById('tour-peek-img');
  if (img) { img.src = photoSrc; img.alt = props.title; }
  const stopEl = document.getElementById('tour-peek-stop');
  if (stopEl) stopEl.textContent = `Stop ${index + 1} of ${total}`;
  const titleEl = document.getElementById('tour-peek-title');
  if (titleEl) titleEl.textContent = props.title;
  const card = document.getElementById('tour-peek-card');
  if (card) card.setAttribute('aria-label', `${props.title}, stop ${index + 1} of ${total}. Tap to expand.`);
}

// ── FOCUS TRAP ─────────────────────────────────────────────────────────────────
// Required by the ARIA dialog pattern: while a modal/sheet is open, Tab and
// Shift+Tab must cycle focus only within that element (WCAG 2.1 success criterion
// 2.1.2 — No Keyboard Trap). Returns a cleanup function; call it on close.
function trapFocus(element) {
  const sel = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
  const focusable = [...element.querySelectorAll(sel)];
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (!first) return () => {};
  function onKeyDown(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  }
  element.addEventListener('keydown', onKeyDown);
  return () => element.removeEventListener('keydown', onKeyDown);
}

function initDrawerSwipe() {
  const drawer = document.getElementById('drawer');
  let startX = 0, startY = 0, lastX = 0, lastY = 0, gestureDir = null;

  drawer.addEventListener('touchstart', e => {
    startX = lastX = e.touches[0].clientX;
    startY = lastY = e.touches[0].clientY;
    gestureDir = null;
  }, { passive: true });

  drawer.addEventListener('touchmove', e => {
    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;
    if (!gestureDir) {
      const dx = Math.abs(lastX - startX), dy = Math.abs(lastY - startY);
      if (dx > 6 || dy > 6) gestureDir = dx > dy ? 'h' : 'v';
    }
  }, { passive: true });

  drawer.addEventListener('touchend', () => {
    const dx = lastX - startX;
    const dy = lastY - startY;

    if (gestureDir === 'v' && dy > 60) {
      closeDrawer(); // collapse or hide
    } else if (gestureDir === 'h' && state.tour && Math.abs(dx) > 50) {
      if (dx < 0 && state.tour.currentIndex < state.tour.stops.length - 1) {
        goToTourStop(state.tour.currentIndex + 1); // swipe left → next
      } else if (dx > 0 && state.tour.currentIndex > 0) {
        goToTourStop(state.tour.currentIndex - 1); // swipe right → prev
      }
    }
    gestureDir = null;
  });
}

// ── FILTERS ────────────────────────────────────────────────────────────────────
// Filter state lives in state.filters. Two UIs share the same state:
//   Mobile:  slide-in panel (#filter-panel) built by buildFilterPanel()
//   Desktop: inline sidebar chips built by buildSidebarFilters()
// Any filter change calls applyFilters() then rebuilds both UIs.

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

    if (show) marker.addTo(map);
    else if (map.hasLayer(marker)) map.removeLayer(marker);
  });

  // Show neighborhood boundaries when filtering by neighborhood, each in its tour color
  if (!state.tour) {
    clearBoundaryLayers();
    if (f.neighborhoods.size > 0) {
      f.neighborhoods.forEach(n => showNeighborhoodBoundary(n, getNeighborhoodColor(n)));
    }
  }

  updateFilterBadge();
}

function resetFilters() {
  state.filters.neighborhoods.clear();
  state.filters.years.clear();
  state.filters.originBucket = 'all';
  state.filters.visitedStatus = 'all';
}

function buildFilterControls(container) {
  container.innerHTML = `
    <div class="filter-section" role="group" aria-labelledby="fp-label-year">
      <h3 id="fp-label-year">Year</h3>
      <div class="sf-row">
        ${YEARS.map(y => `<button class="chip" data-fc="year" data-val="${y}" aria-pressed="false">${y}</button>`).join('')}
      </div>
    </div>
    <div class="filter-section" role="group" aria-labelledby="fp-label-neighborhood">
      <h3 id="fp-label-neighborhood">Neighborhood</h3>
      <div class="sf-row">
        ${NEIGHBORHOODS.map(n => `<button class="chip" data-fc="neighborhood" data-val="${n}" aria-pressed="false">${n}</button>`).join('')}
      </div>
    </div>
    <div class="filter-section" role="group" aria-labelledby="fp-label-origin">
      <h3 id="fp-label-origin">Artist Origin</h3>
      <div class="sf-row">
        ${ORIGIN_BUCKETS.filter(o => o.value !== 'all').map(o => `<button class="chip" data-fc="origin" data-val="${o.value}" aria-pressed="false">${o.label}</button>`).join('')}
      </div>
    </div>
    <div class="filter-section" role="group" aria-labelledby="fp-label-visited">
      <h3 id="fp-label-visited">Visited</h3>
      <div class="sf-row">
        ${VISITED_OPTIONS.filter(v => v.value !== 'all').map(v => `<button class="chip" data-fc="visited" data-val="${v.value}" aria-pressed="false">${v.label}</button>`).join('')}
      </div>
    </div>
    `;

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
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
}

// Mobile filter panel
function buildFilterPanel() {
  buildFilterControls(document.getElementById('filter-panel-body'));
}

function openFilterPanel() {
  const panel = document.getElementById('filter-panel');
  const overlay = document.getElementById('filter-overlay');
  panel._returnFocus = document.activeElement;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    panel.querySelector('button, [href], [tabindex]')?.focus();
    panel._trapCleanup = trapFocus(panel);
  }, 50);
}

function closeFilterPanel() {
  const panel = document.getElementById('filter-panel');
  const overlay = document.getElementById('filter-overlay');
  panel._trapCleanup?.();
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  panel._returnFocus?.focus();
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
    <div class="sf-row" role="group" aria-label="Neighborhood">
      ${NEIGHBORHOODS.map(n => `<button class="chip ${state.filters.neighborhoods.has(n) ? 'active' : ''}" data-sf-neighborhood="${n}" aria-pressed="${state.filters.neighborhoods.has(n)}">${n}</button>`).join('')}
    </div>
    <div class="sf-row" role="group" aria-label="Year">
      ${YEARS.map(y => `<button class="chip ${state.filters.years.has(y) ? 'active' : ''}" data-sf-year="${y}" aria-pressed="${state.filters.years.has(y)}">${y}</button>`).join('')}
    </div>
    <div class="sf-row" role="group" aria-label="Artist Origin">
      ${ORIGIN_BUCKETS.filter(o => o.value !== 'all').map(o => `<button class="chip ${state.filters.originBucket === o.value ? 'active' : ''}" data-sf-origin="${o.value}" aria-pressed="${state.filters.originBucket === o.value}">${o.label}</button>`).join('')}
    </div>
    <div class="sf-row" role="group" aria-label="Visited">
      <button class="chip ${state.filters.visitedStatus === 'unvisited' ? 'active' : ''}" data-sf-visited="unvisited" aria-pressed="${state.filters.visitedStatus === 'unvisited'}">Unvisited</button>
      <button class="chip ${state.filters.visitedStatus === 'visited' ? 'active' : ''}" data-sf-visited="visited" aria-pressed="${state.filters.visitedStatus === 'visited'}">Visited</button>
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
      }
      applyFilters();
      buildSidebarFilters();
    });
  });
}

// ── TOUR LIFECYCLE ─────────────────────────────────────────────────────────────
// Three phases:
//   startTour(key)     — saves filter state, dims non-tour markers, numbers tour
//                        markers, fetches walking route, navigates to stop 0
//   goToTourStop(i)    — flies to stop i, updates progress bar + peek card + detail
//   exitTour()         — restores markers, re-enables filters, removes route

function buildTourCards() {
  const container = document.getElementById('tour-cards');
  container.innerHTML = Object.entries(TOUR_ROUTES).map(([key, route]) => `
    <div class="tour-card">
      <div class="tour-card-header">
        <div class="tour-card-dot" style="background:${route.color}" aria-hidden="true"></div>
        <span class="tour-card-name">${route.name}</span>
      </div>
      <div class="tour-card-stats" aria-label="${route.mural_ids.length} stops, ${route.miles} miles, ${route.duration}">
        <div class="tour-stat">
          <span class="tour-stat-value">${route.mural_ids.length}</span>
          <span class="tour-stat-label">stops</span>
        </div>
        <div class="tour-stat-sep" aria-hidden="true"></div>
        <div class="tour-stat">
          <span class="tour-stat-value">${route.miles} mi</span>
          <span class="tour-stat-label">distance</span>
        </div>
        <div class="tour-stat-sep" aria-hidden="true"></div>
        <div class="tour-stat">
          <span class="tour-stat-value">${route.duration}</span>
          <span class="tour-stat-label">est. time</span>
        </div>
      </div>
      <button class="tour-card-btn" data-tour-key="${key}" aria-label="Start ${route.name}">Start Tour &#8594;</button>
    </div>`).join('');

  container.querySelectorAll('.tour-card-btn').forEach(btn => {
    btn.addEventListener('click', () => startTour(btn.dataset.tourKey));
  });
}

function openTourSheet() {
  const sheet = document.getElementById('tour-sheet');
  sheet._returnFocus = document.activeElement;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  document.getElementById('tour-overlay').classList.remove('hidden');
  document.getElementById('tour-overlay').setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    sheet.querySelector('button, [href], [tabindex]')?.focus();
    sheet._trapCleanup = trapFocus(sheet);
  }, 50);
}

function closeTourSheet() {
  const sheet = document.getElementById('tour-sheet');
  sheet._trapCleanup?.();
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  document.getElementById('tour-overlay').classList.add('hidden');
  document.getElementById('tour-overlay').setAttribute('aria-hidden', 'true');
  sheet._returnFocus?.focus();
}

function startTour(routeKey) {
  const route = TOUR_ROUTES[routeKey];

  // Save current filter state
  state.savedFilters = {
    neighborhoods: [...state.filters.neighborhoods],
    years: [...state.filters.years],
    originBucket: state.filters.originBucket,
    visitedStatus: state.filters.visitedStatus
  };

  state.tour = { routeKey, stops: route.mural_ids, currentIndex: 0 };

  // Disable filter controls
  const filterBtn = document.getElementById('filter-btn');
  if (filterBtn) { filterBtn.disabled = true; filterBtn.title = 'Filters unavailable during tour'; }

  // Dim non-route markers, number route markers
  state.markers.forEach(({ marker, props }, id) => {
    const stopIndex = route.mural_ids.indexOf(id);
    if (stopIndex === -1) {
      marker.addTo(map);
      marker.setOpacity(0.3);
    } else {
      marker.addTo(map);
      marker.setOpacity(1);
      marker.setIcon(createPinIcon(props.title, state.visited.has(id), stopIndex + 1, route.color));
    }
  });

  // Show neighborhood boundaries for this tour's pins in the tour's color
  clearBoundaryLayers();
  const tourNeighborhoods = [...new Set(
    route.mural_ids.map(id => state.markers.get(id)?.props.neighborhood).filter(Boolean)
  )];
  tourNeighborhoods.forEach(n => showNeighborhoodBoundary(n, route.color));

  // Fetch walking route from Mapbox Directions API, fall back to straight lines
  fetchAndDrawTourRoute(route);

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
  map.flyTo([lat, lng], 15, prefersReducedMotion() ? { animate: false } : { animate: true, duration: 0.8 });

  // Activate marker
  if (state.activeId !== null && state.activeId !== id) deactivateMarker(state.activeId);
  state.activeId = id;
  activateMarker(id);

  // Open detail (on mobile in tour mode, also update peek card)
  if (isMobile()) updateTourPeekCard(props, index);
  openDetail(props);
}

/**
 * Fetches a real walking route from the Mapbox Directions API and draws it as a
 * solid white polyline. Falls back to straight-line segments if the request fails.
 * Mapbox Walking profile avoids highways and prefers pedestrian paths.
 * Coordinates are passed as lng,lat (Mapbox order) but stored as [lat,lng] (Leaflet order).
 */
async function fetchAndDrawTourRoute(route) {
  const waypoints = route.mural_ids
    .map(id => state.markers.get(id))
    .filter(Boolean)
    .map(({ lng, lat }) => `${lng},${lat}`)  // Mapbox expects lng,lat
    .join(';');

  try {
    const res = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/walking/${waypoints}?geometries=geojson&access_token=${MAPBOX_TOKEN}`
    );
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      const coords = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      state.tourRoute = L.polyline(coords, {
        color: '#F5F0EB', weight: 5, opacity: 0.9
      }).addTo(map);
    } else {
      drawStraightLineRoute(route);
    }
  } catch {
    drawStraightLineRoute(route);
  }
}

function drawStraightLineRoute(route) {
  const coords = route.mural_ids
    .map(id => state.markers.get(id))
    .filter(Boolean)
    .map(({ lat, lng }) => [lat, lng]);
  state.tourRoute = L.polyline(coords, {
    color: '#F5F0EB', weight: 5, opacity: 0.9
  }).addTo(map);
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

  stopGpsTracking();

  // Fully hide drawer (not just peek)
  const drawer = document.getElementById('drawer');
  drawer.classList.remove('open', 'peek');

  document.getElementById('sidebar-content').innerHTML =
    '<div class="sidebar-empty"><p>Select a mural on the map to learn more.</p></div>';
  map.closePopup();
}

// ── ABOUT MODAL ────────────────────────────────────────────────────────────────
function openAboutModal() {
  const modal = document.getElementById('about-modal');
  const overlay = document.getElementById('about-overlay');
  modal._returnFocus = document.activeElement;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    modal.querySelector('button, [href], [tabindex]')?.focus();
    modal._trapCleanup = trapFocus(modal);
  }, 50);
}

function closeAboutModal() {
  const modal = document.getElementById('about-modal');
  const overlay = document.getElementById('about-overlay');
  modal._trapCleanup?.();
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  modal._returnFocus?.focus();
}

// ── GPS TRACKING ───────────────────────────────────────────────────────────────
// Uses the browser's native Geolocation API (no Google services required).
// state.gpsWatchId and state.gpsMarker track the active session.

function startGpsTracking() {
  if (!navigator.geolocation) {
    showToast('Location services are not available on this device.');
    return;
  }
  state.gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      if (!state.gpsMarker) {
        const icon = L.divIcon({
          className: '',
          html: '<div class="gps-dot"><div class="gps-dot-pulse"></div><div class="gps-dot-inner"></div></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        state.gpsMarker = L.marker([lat, lng], { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
      } else {
        state.gpsMarker.setLatLng([lat, lng]);
      }
      document.getElementById('tour-track-me')?.setAttribute('aria-pressed', 'true');
      document.getElementById('tour-track-me')?.classList.add('active');
    },
    () => {
      showToast('Unable to get your location. Check your browser permissions.');
      stopGpsTracking();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

function stopGpsTracking() {
  if (state.gpsWatchId !== null) {
    navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = null;
  }
  if (state.gpsMarker) {
    map.removeLayer(state.gpsMarker);
    state.gpsMarker = null;
  }
  document.getElementById('tour-track-me')?.setAttribute('aria-pressed', 'false');
  document.getElementById('tour-track-me')?.classList.remove('active');
}

// ── NEAR ME ────────────────────────────────────────────────────────────────────
function goToNearMe() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => map.flyTo(
      [pos.coords.latitude, pos.coords.longitude], 15,
      prefersReducedMotion() ? { animate: false } : { animate: true, duration: 0.8 }
    ),
    () => showToast('Unable to retrieve your location.')
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

// Peek card → expand to full drawer
document.getElementById('tour-peek-card')?.addEventListener('click', expandDrawer);
document.getElementById('tour-peek-card')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expandDrawer(); }
});

// Track Me toggle
document.getElementById('tour-track-me')?.addEventListener('click', () => {
  if (state.gpsWatchId !== null) stopGpsTracking();
  else startGpsTracking();
});

document.getElementById('about-btn')?.addEventListener('click', openAboutModal);
document.getElementById('sidebar-about-btn')?.addEventListener('click', openAboutModal);
document.getElementById('about-close')?.addEventListener('click', closeAboutModal);
document.getElementById('about-overlay')?.addEventListener('click', closeAboutModal);

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const filterPanel = document.getElementById('filter-panel');
  const tourSheet = document.getElementById('tour-sheet');
  const aboutModal = document.getElementById('about-modal');
  if (filterPanel?.getAttribute('aria-hidden') === 'false') closeFilterPanel();
  else if (tourSheet?.getAttribute('aria-hidden') === 'false') closeTourSheet();
  else if (aboutModal?.getAttribute('aria-hidden') === 'false') closeAboutModal();
});

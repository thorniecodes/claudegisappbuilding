# Editing Tour Stops

How to add, remove, and edit mural stops in the 20x21EUG Mural Tour app.

Every stop lives in one place: **`data/murals.geojson`**. The app reads that file at startup and builds everything — pins, detail panels, filters, and tour routes — from it. You rarely need to touch any other file unless you are also changing the visited counter total or adding a stop to a tour route.

---

## Files you will work with

| File | What it controls |
|---|---|
| `data/murals.geojson` | All stop data (location, title, photo, description, etc.) |
| `assets/images/` | Photo files for each stop |
| `js/app.js` line ~48 | `TOTAL_MURALS` — the denominator in "X / 24 visited" |
| `js/app.js` lines ~62–91 | `TOUR_ROUTES` — which stops belong to each walking route |

---

## Adding a stop

### Step 1 — Get the coordinates

Open [Google Maps](https://maps.google.com), navigate to the mural location, and right-click the exact spot on the wall. Click the latitude/longitude that appears at the top of the context menu to copy it.

You will get two numbers separated by a comma, e.g. `44.0521, -123.0887`. The first is **latitude**, the second is **longitude**.

> **Coordinate format warning:** The GeoJSON `geometry.coordinates` array is `[longitude, latitude]` (longitude first — the opposite of how Google Maps shows them). The `latLng` property inside `properties` is `[latitude, longitude]` (latitude first, matching Leaflet's convention). Both values must be set and they must be consistent with each other.

### Step 2 — Prepare the photo

1. Get the photo file (JPEG or PNG).
2. Resize and convert it to WebP using ImageMagick (must be installed):

   ```bash
   magick your-photo.jpg -resize 800x\> -quality 82 ./assets/images/yourname.webp
   ```

   Replace `your-photo.jpg` with your input file and `yourname` with a short lowercase identifier (e.g. the artist's last name). The `-resize 800x\>` flag resizes to a maximum of 800px wide without enlarging smaller images.

3. Move or confirm the `.webp` file is in `assets/images/`.

### Step 3 — Add the entry to `data/murals.geojson`

Open `data/murals.geojson`. Inside the `"features": [ ... ]` array, add a new entry following this exact structure. Add it at the end of the array, before the closing `]`.

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [-123.0887, 44.0521] },
  "properties": {
    "id": 25,
    "latLng": [44.0521, -123.0887],
    "title": "Name of the Mural",
    "artist": "Artist Full Name",
    "origin": "Eugene, OR",
    "year": 2019,
    "address": "123 Example St",
    "neighborhood": "Downtown",
    "project": "20x21EUG",
    "photo": "./assets/images/yourname.webp",
    "website": "https://www.20x21eug.com/murals/example/",
    "description": "A description of the mural and the artist.",
    "status": "active"
  }
}
```

**Field reference:**

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Must be unique across all stops. Use the next available number. |
| `latLng` | `[lat, lng]` | Latitude first. Must match `geometry.coordinates` (reversed). |
| `geometry.coordinates` | `[lng, lat]` | Longitude first. GeoJSON standard. |
| `title` | string | Displayed as the main heading in the detail panel. |
| `artist` | string | Displayed below the title. |
| `origin` | string | Used by the Artist Origin filter. Include "Eugene, OR" for local artists, "USA" for non-local Americans, or a country name for international. |
| `year` | integer | Used by the Year filter. Must be a number, not a string. |
| `address` | string | Street address shown in the detail panel. |
| `neighborhood` | string | **Must exactly match one of these values:** `Downtown`, `Whiteaker`, `West Eugene`, `South Eugene`. Capitalization matters. This controls which boundary overlay appears and which filter chip highlights. |
| `photo` | string | Relative path to the WebP image: `"./assets/images/yourname.webp"` |
| `website` | string | Full `https://` URL for the "Learn More" button. Must start with `https://` or `http://`. |
| `description` | string | Paragraph shown in the detail panel below the address. |
| `status` | string | Set to `"active"`. Reserved for future use. |

> **JSON syntax reminder:** All entries in the `features` array except the last one must be followed by a comma. If you add your entry at the end, add a comma after the previous entry's closing `}`.

### Step 4 — Update the total stop count

Open `js/app.js`. Find line ~48:

```js
const TOTAL_MURALS = 24;
```

Change `24` to the new total (e.g. `25`). This updates the "X / 25 visited" counter in the header.

### Step 5 — Add to a tour route (optional)

If the new stop should appear in one of the walking tours, open `js/app.js` and find the `TOUR_ROUTES` object (lines ~62–91). Add the new stop's `id` to the appropriate route's `mural_ids` array at the position in the walking sequence where it fits geographically.

```js
downtown: {
  name: 'Downtown Route',
  color: '#E8401C',
  miles: '1.5',
  duration: '~1.5 hrs',
  mural_ids: [15, 19, 11, 20, 18, 9, 17, 8, 2, 5, 12, 1, 7, 23, 16, 25]  // ← added 25
},
```

Also update the `miles` and `duration` strings to reflect the new walking distance and time if needed.

---

## Removing a stop

### Step 1 — Remove from `data/murals.geojson`

Open `data/murals.geojson`, find the feature with the matching `"id"`, and delete the entire object from `{` to `}`. Make sure you also remove the comma before or after it so the JSON remains valid.

### Step 2 — Remove from any tour routes

Open `js/app.js` and search for the stop's ID number in the `TOUR_ROUTES` section (lines ~62–91). Remove the ID from any `mural_ids` array it appears in.

```js
// Before:
mural_ids: [3, 10, 4, 6, 22, 13]

// After removing stop 10:
mural_ids: [3, 4, 6, 22, 13]
```

### Step 3 — Update the total stop count

Open `js/app.js`, find `const TOTAL_MURALS` (~line 48), and subtract 1.

### Step 4 — Delete the image (optional)

If the photo file is not used by any other stop, delete it from `assets/images/`. Check `data/murals.geojson` first by searching for the filename to confirm no other stop references it.

---

## Editing a stop

All text fields (title, artist, description, address, etc.) are changed directly in `data/murals.geojson` — find the feature by its `id` and update the value.

### Changing the location

Update **both** of these in the feature:

1. `"geometry": { "coordinates": [longitude, latitude] }` — longitude first
2. `"latLng": [latitude, longitude]` — latitude first

If the stop is on a tour route, the walking route line will update automatically on next load. The `miles` and `duration` strings in `TOUR_ROUTES` are display-only and will need to be updated manually in `js/app.js` if the move significantly changes the route distance.

### Changing the photo

1. Prepare the new image following Step 2 of "Adding a stop" above.
2. In `data/murals.geojson`, update the `"photo"` field to the new path:
   ```json
   "photo": "./assets/images/newname.webp"
   ```
3. Delete the old image file from `assets/images/` if it is no longer used.

### Changing the neighborhood

Update the `"neighborhood"` field in `data/murals.geojson`. The value must exactly match one of the four recognized values: `Downtown`, `Whiteaker`, `West Eugene`, or `South Eugene`.

If this stop is on a tour route, the neighborhood boundary overlay shown during that tour will update automatically.

### Changing which tour route a stop belongs to

Open `js/app.js` and find the `TOUR_ROUTES` object (~lines 62–91). Move the stop's ID from one route's `mural_ids` array to another, placing it at the correct position in the walking sequence.

---

## Validating your changes

After editing `data/murals.geojson`, paste the entire file contents into [jsonlint.com](https://jsonlint.com) to check for syntax errors before pushing. A missing comma or extra bracket will prevent all stops from loading.

To test locally, open a terminal in the project folder and run:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser. This is necessary because the browser blocks `fetch()` requests to local files without a server.

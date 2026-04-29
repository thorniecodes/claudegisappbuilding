# Building a GIS App with Claude Code
Learning how to build a GIS app at the GIS in Action Conference. Vibe Coding with Claude Workshop 2026-04-28. Any images or text has been used for educational purposes only for learning how to develop GIS apps using generative artificial intelligence.

# Eugene Mural Tour
[https://thorniecodes.github.io/claudegisappbuilding/](https://thorniecodes.github.io/claudegisappbuilding/)

An interactive, mobile-friendly web map for exploring the public murals of Eugene, Oregon. Built as a self-guided walking tour, this app lets residents and visitors discover the city's vibrant outdoor art scene — from neighborhood walls in the Whiteaker to landmark pieces in downtown.
Mural data is sourced from the 20x21EUG Mural Project, a City of Eugene Cultural Services initiative that commissioned over 20 world-class murals by local, national, and international artists in preparation for the 2022 IAAF World Athletics Championships. Each pin on the map includes the artist's name, country of origin, year painted, address, and a description of the work and its context.

The app runs entirely in the browser with no backend required, making it freely hostable on GitHub Pages. It is designed for use on mobile devices in the field — tap a pin, read about the mural, and get walking directions with a single button press.

Data source: [20x21eug.com/artists](20x21eug.com/artists)
Built with: Leaflet.js, GeoJSON, GitHub Pages
Maintained by: Kate Thornhill
Copyright: The images used in this app are in copyright. Ownership is not claimed by the app developer. Image use is only for educational purposes and intentions.

Self-guided walking tour map of the [20x21EUG](https://www.20x21eug.com) mural project in Eugene, Oregon.

# Setup

## 1. Get a Mapbox token

1. Create a free account at [mapbox.com](https://www.mapbox.com)
2. Go to **Account → Access Tokens** and copy your default public token (starts with `pk.`)

## 2. Add your token

Open [js/app.js](js/app.js) and replace `YOUR_TOKEN_HERE` on line 3:

```js
const MAPBOX_TOKEN = 'pk.eyJ1...your-actual-token...';
```

Until you add a token the app falls back to OpenStreetMap tiles automatically.

## 3. Restrict your token (important for public repos)

Your token will be visible in the public GitHub repo. To prevent abuse:

1. Go to **mapbox.com → Account → Access Tokens**
2. Click your token → **Edit**
3. Under **URL restrictions**, add your GitHub Pages URL:
   `https://yourusername.github.io`
4. Save. The token will only work on that domain.

## Deploy to GitHub Pages

1. Push this folder (or its contents) to your `main` branch
2. Go to your repo **Settings → Pages**
3. Set source to **Deploy from a branch** → `main` → `/ (root)`
4. If deploying from a subfolder, set the path accordingly
5. Your site will be live at `https://yourusername.github.io/repo-name/eugene-mural-tour/`

## Features

- **24 mural pins** with custom SVG markers (red = unvisited, grey = visited)
- **Tap a pin** → image preview popup → tap again for full detail
- **Mark as Visited** toggle saved to `localStorage`
- **Filters** — neighborhood, year, artist origin, visited status, hide partial murals
- **Tour Mode** — 4 neighborhood walking loops with step-by-step navigation
- **Near Me** — flies map to your GPS location
- **Get Directions** — opens Google Maps walking directions to any mural
- **PWA** — add to home screen on iOS/Android for offline-capable use

## File Structure

```
eugene-mural-tour/
├── index.html
├── css/style.css
├── js/app.js
├── data/murals.geojson
├── assets/images/placeholder.svg
├── manifest.json
└── .nojekyll
```

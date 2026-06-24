# Wave Glider Dashboard

Live dashboard for NCSZO Wave Glider telemetry. Data sourced from the Liquid Robotics
WGMS Data Service and archived to Supabase. The browser reads directly from Supabase;
no WGMS credentials are needed to run the frontend.

Live site: https://ncszo.github.io/waveglider-dashboard/

Data: [Ocean Networks Canada / NEPTUNE](https://www.oceannetworks.ca) · [Liquid Robotics WGMS](https://wgms.liquid-robotics.com)

---

## Dev setup

**Prerequisites:** Node 20+

```sh
git clone https://github.com/NCSZO/waveglider-dashboard.git
cd waveglider-dashboard
npm install
cp .env.example .env
```

Edit `.env` and fill in both values:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Get these from the Supabase project dashboard (Settings → API), or copy them from
`pipeline/.env` in the `waveglider-dashboard-pipeline` repo if you have it checked out.

```sh
npm run dev        # dev server at http://localhost:5173
npm run build      # production build → dist/
npm run preview    # serve dist/ locally
```

## Deploy

Pushing to `main` triggers the GitHub Actions workflow which builds and deploys to Pages
automatically. No manual build-and-push step needed.

Secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be set in the repo's
**Settings → Secrets and variables → Actions** before the first deploy.

## Repo layout

```
web/
├── src/
│   ├── App.vue
│   ├── main.js
│   ├── style.css
│   ├── assets/          # cable-route.geojson, waypoints.geojson (legacy; now DB-driven)
│   ├── components/      # MapView, TimeSeries, StatusCard, Attribution
│   └── lib/             # api.js, geo.js, supabase.js, waypoints.js
├── index.html
├── vite.config.js
├── package.json
├── .env.example
└── .github/workflows/deploy.yml
```

The pipeline cron job (Python, private) lives in a separate repo:
[NCSZO/waveglider-dashboard-pipeline](https://github.com/NCSZO/waveglider-dashboard-pipeline)

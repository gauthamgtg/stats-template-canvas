# Next.js Template Editor

Client-only template editor built with Next.js App Router.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
npm run start
```

## How templates are loaded

- HTML templates are read from the `templates/` directory.
- The gallery auto-discovers every `*.html` file (except `stats_collection.html`).
- Titles are pulled from each file's `<title>` tag.

## Deploy to Vercel

1. **Push your code to GitHub** (if not already):
   ```bash
   git add .
   git commit -m "Ready for deploy"
   git push origin main
   ```

2. **Connect to Vercel**:
   - Go to [vercel.com](https://vercel.com) and sign in (or use your GitHub account).
   - Click **Add New** → **Project** and import your `stats-template-canvas` repository.
   - Vercel will detect Next.js automatically. Keep the default settings:
     - **Framework Preset:** Next.js
     - **Build Command:** `npm run build`
     - **Output Directory:** (leave default)
   - Click **Deploy**.

3. **After deploy**: Your app will be live at `https://your-project.vercel.app`. The gallery and editors will work; templates are read from the `templates/` folder in the deployed bundle.

**Optional – deploy from CLI:**
```bash
npm i -g vercel
vercel
```
Follow the prompts and run `vercel --prod` when ready for production.

## Add a new template

1. Add a new HTML file into `templates/`.
2. Restart `npm run dev` (or refresh if already running).
3. It automatically appears in the gallery.

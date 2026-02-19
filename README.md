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

## Add a new template

1. Add a new HTML file into `templates/`.
2. Restart `npm run dev` (or refresh if already running).
3. It automatically appears in the gallery.

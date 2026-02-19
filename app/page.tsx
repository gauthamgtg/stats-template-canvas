import GalleryClient from "@/components/GalleryClient";
import GalleryErrorBoundary from "@/components/GalleryErrorBoundary";
import { getTemplates } from "@/lib/templates";

export default async function HomePage() {
  const templates = await getTemplates();

  return (
    <div className="page-shell">
      <header className="gallery-header">
        <h1 className="gallery-title">Template Editor</h1>
        <p className="gallery-subtitle">
          Choose any template, edit text and colors, then export as PNG, JPG, or PDF.
        </p>
      </header>
      <main className="gallery-main">
        <GalleryErrorBoundary>
          <GalleryClient templates={templates} />
        </GalleryErrorBoundary>
      </main>
    </div>
  );
}

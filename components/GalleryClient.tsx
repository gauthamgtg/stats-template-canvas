"use client";

import { useMemo, useState } from "react";
import GalleryCard from "@/components/GalleryCard";
import type { TemplateMeta } from "@/lib/templates";

type Props = { templates: TemplateMeta[] };

export default function GalleryClient({ templates }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const categories = useMemo(() => {
    const set = new Set(templates.map((t) => t.category));
    return ["All", ...Array.from(set).sort()];
  }, [templates]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return templates.filter((t) => {
      if (category !== "All" && t.category !== category) return false;
      if (q && !t.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templates, query, category]);

  return (
    <>
      <div className="gallery-controls">
        <input
          type="search"
          placeholder="Search templates..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="gallery-search"
        />
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`gallery-filter-btn ${category === cat ? "gallery-filter-btn-active" : ""}`}
            onClick={() => setCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="gallery-grid">
        {filtered.length === 0 && (
          <p className="gallery-empty">No templates match your search.</p>
        )}
        {filtered.map((template) => (
          <GalleryCard key={template.id} template={template} />
        ))}
      </div>
    </>
  );
}

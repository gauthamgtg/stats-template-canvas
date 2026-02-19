import Image from "next/image";
import Link from "next/link";
import type { TemplateMeta } from "@/lib/templates";

type Props = {
  template: TemplateMeta;
};

export default function GalleryCard({ template }: Props) {
  return (
    <Link href={`/editor/${template.id}`} className="template-card">
      <div className="template-card-preview">
        <span className="template-card-badge">{template.category}</span>
        <Image
          src={`/thumbnails/${template.id}.webp`}
          alt={template.name}
          width={1200}
          height={900}
          className="template-card-img"
          loading="lazy"
          quality={80}
        />
      </div>
      <div className="template-card-body">
        <h3>{template.name}</h3>
        <p>{template.description}</p>
      </div>
    </Link>
  );
}

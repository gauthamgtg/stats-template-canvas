import { notFound } from "next/navigation";
import EditorClient from "@/components/EditorClient";
import EditorErrorBoundary from "@/components/EditorErrorBoundary";
import { getTemplateById, getTemplates } from "@/lib/templates";

type Props = {
  params: Promise<{ templateId: string }>;
};

export async function generateStaticParams() {
  const templates = await getTemplates();
  return templates.map((template) => ({ templateId: template.id }));
}

export default async function EditorPage({ params }: Props) {
  const { templateId } = await params;
  const template = await getTemplateById(templateId);

  if (!template) notFound();
  return (
    <EditorErrorBoundary>
      <EditorClient template={template} />
    </EditorErrorBoundary>
  );
}

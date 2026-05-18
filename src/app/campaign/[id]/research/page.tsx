import { redirect } from "next/navigation";

export default async function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/campaign/${id}/agent`);
}

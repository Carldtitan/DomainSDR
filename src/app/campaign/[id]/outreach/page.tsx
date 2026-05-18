import { redirect } from "next/navigation";

export default async function OutreachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/campaign/${id}/agent`);
}

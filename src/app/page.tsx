import { AppShell } from "@/components/AppShell";
import { IntakeForm } from "@/components/IntakeForm";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <AppShell>
      <IntakeForm />
    </AppShell>
  );
}

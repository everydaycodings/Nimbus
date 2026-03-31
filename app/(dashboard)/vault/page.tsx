// app/(dashboard)/vault/page.tsx
import { getVaults } from "@/vault/actions/vault.actions";
import { VaultPage } from "@/vault/components/VaultPage";

export default async function Page() {
  const initialData = await getVaults().catch(() => []);
  
  return <VaultPage initialData={initialData} />;
}
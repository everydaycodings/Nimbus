import { getVaults } from "@/vault/actions/vault.actions";
import { VaultPage } from "@/vault/components/VaultPage";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vault",
  description: "Securely store your sensitive files in the Nimbus Vault.",
};

export default async function Page() {
  const initialData = await getVaults().catch(() => []);
  
  return <VaultPage initialData={initialData} />;
}
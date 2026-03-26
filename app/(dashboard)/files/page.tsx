// app/(dashboard)/files/page.tsx
import { getFiles } from "@/actions/files";
import { FileGrid } from "@/components/FileGrid";
import { FileListClient } from "@/components/FileListClient";

export default async function FilesPage() {
  const { files, folders, user } = await getFiles(null);

  return (
    <FileListClient
      initialFiles={files}
      initialFolders={folders}
      user={user}
    />
  );
}
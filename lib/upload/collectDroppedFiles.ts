// lib/upload/collectDroppedFiles.ts
// Turn a drop's DataTransfer entries into a flat File[] — including files inside
// dropped folders (which `DataTransfer.files` alone does not expose).
//
// IMPORTANT: webkitGetAsEntry() must be called synchronously inside the drop
// handler (the DataTransferItemList is cleared once the handler returns). The
// caller captures the entries synchronously and passes them here for the async
// traversal.

function readEntryFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      () => resolve(null)
    );
  });
}

function readAllDirEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  // readEntries returns results in batches; keep calling until it returns empty.
  return new Promise((resolve) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
          } else {
            all.push(...batch);
            readBatch();
          }
        },
        () => resolve(all)
      );
    };
    readBatch();
  });
}

async function walkEntry(entry: FileSystemEntry | null): Promise<File[]> {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await readEntryFile(entry as FileSystemFileEntry);
    return file ? [file] : [];
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllDirEntries(reader);
    const nested = await Promise.all(children.map((c) => walkEntry(c)));
    return nested.flat();
  }
  return [];
}

/**
 * Recursively collect all files from previously-captured drop entries.
 * Folder structure is flattened (structure-preserving drop comes in Phase 2).
 */
export async function collectDroppedFiles(
  entries: (FileSystemEntry | null)[]
): Promise<File[]> {
  const results = await Promise.all(entries.map((e) => walkEntry(e)));
  return results.flat();
}

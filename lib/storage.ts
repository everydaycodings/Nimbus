export function calculateStorageUsage(files: any[]) {
    let imageBytes = 0;
    let videoBytes = 0;
    let docBytes = 0;
    let otherBytes = 0;
  
    files.forEach((file) => {
      if (file.mime_type?.startsWith("image/")) {
        imageBytes += file.size;
      } else if (file.mime_type?.startsWith("video/")) {
        videoBytes += file.size;
      } else if (
        file.mime_type?.includes("pdf") ||
        file.mime_type?.includes("doc")
      ) {
        docBytes += file.size;
      } else {
        otherBytes += file.size;
      }
    });
  
    return {
      imageBytes,
      videoBytes,
      docBytes,
      otherBytes,
    };
  }
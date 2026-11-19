// Shrink ordinary workplace photos before the network trip. Server validation
// and metadata removal still run; this result is never trusted as verification.
export async function prepareWorkplacePhoto(file: Blob): Promise<Blob> {
  const limit = 5 * 1024 * 1024;
  if (file.size < 300_000) return file;
  let bitmap: ImageBitmap | undefined;
  let fallbackImage: HTMLImageElement | undefined;
  let objectUrl: string | undefined;
  try {
    if (typeof createImageBitmap === "function")
      bitmap = await createImageBitmap(file);
    else {
      objectUrl = URL.createObjectURL(file);
      fallbackImage = new Image();
      fallbackImage.src = objectUrl;
      await fallbackImage.decode();
    }
    const source = bitmap || fallbackImage!;
    const sourceWidth = bitmap?.width || fallbackImage!.naturalWidth;
    const sourceHeight = bitmap?.height || fallbackImage!.naturalHeight;
    if (!sourceWidth || !sourceHeight)
      throw Error("Image could not be decoded.");
    const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("Image compression is unavailable.");
    let smallest: Blob = file;
    for (const edge of [1600, 1200, 900, 640]) {
      const ratio = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
      canvas.width = Math.max(1, Math.round(sourceWidth * ratio));
      canvas.height = Math.max(1, Math.round(sourceHeight * ratio));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.68, 0.5]) {
        const smaller = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (smaller && smaller.size < smallest.size) smallest = smaller;
        if (smallest.size < limit) return smallest;
      }
    }
    throw Error("This photo could not be compressed below 5 MB.");
  } catch {
    if (file.size >= limit)
      throw Error(
        "This photo could not be compressed below 5 MB. Please retake it.",
      );
    return file;
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

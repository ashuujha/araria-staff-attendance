// Shrink ordinary workplace photos before the network trip. Server validation
// and metadata removal still run; this result is never trusted as verification.
export async function prepareWorkplacePhoto(file: Blob): Promise<Blob> {
  if (file.size < 300_000 || typeof createImageBitmap !== "function")
    return file;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const smaller = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    return smaller && smaller.size < file.size ? smaller : file;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

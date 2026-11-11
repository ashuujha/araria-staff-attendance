/** Upload directly to the signed private-storage URL with visible progress. */
export function uploadWithProgress(
  url: string,
  file: Blob,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.timeout = 45_000;
    request.setRequestHeader("Content-Type", file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(
          Math.min(99, Math.round((event.loaded / event.total) * 100)),
        );
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else reject(new Error("फ़ाइल अपलोड विफल। फिर कोशिश करें।"));
    };
    request.onerror = request.ontimeout = () =>
      reject(new Error("फ़ाइल अपलोड विफल। फिर कोशिश करें।"));
    request.send(file);
  });
}

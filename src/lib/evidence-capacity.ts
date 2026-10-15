import { HttpError } from "./server";
// Bound image buffers/decoders per function instance, without slowing login or
// page reads. Other Vercel instances have independent capacity.
let running = 0;
const waiters: (() => void)[] = [];
export async function reserveEvidenceSlot(): Promise<() => void> {
  if (running >= 4) {
    if (waiters.length >= 250)
      throw new HttpError(
        503,
        "सर्वर व्यस्त है। थोड़ी देर में फिर सहेजें। / Server busy. Please save again shortly.",
      );
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(ready);
        if (index >= 0) waiters.splice(index, 1);
        reject(
          new HttpError(
            503,
            "सर्वर व्यस्त है। थोड़ी देर में फिर सहेजें। / Server busy. Please save again shortly.",
          ),
        );
      }, 8000);
      waiters.push(ready);
    });
  } else running++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiters.shift();
    if (next) next();
    else running--;
  };
}

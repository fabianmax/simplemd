/** Guarded localStorage for dragged-in / pressed-in preferences (browser width,
 *  zoom). Not configuration: no settings surface, no file, no schema.
 *
 *  Every access is wrapped because storage can throw (private mode, wiped site
 *  data) or be absent entirely. A lost preference resets to the default next
 *  launch, which is never worth an error path. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preference simply resets next launch */
  }
}

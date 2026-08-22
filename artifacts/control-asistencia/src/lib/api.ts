export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || "No fue posible completar la solicitud.");
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

export function imageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      reject(new Error("Usa una imagen JPG, PNG o WebP de máximo 2 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No pudimos leer la imagen."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
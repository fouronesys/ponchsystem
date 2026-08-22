import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const supported = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function storageRoot() {
  const databasePath =
    process.env.SQLITE_DATABASE_PATH ??
    path.resolve(process.cwd(), "data", "attendance.sqlite");
  return path.join(path.dirname(databasePath), "uploads");
}

function parseImageDataUrl(value: unknown): { bytes: Buffer; extension: string } {
  if (typeof value !== "string") throw new Error("La imagen es obligatoria.");
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) throw new Error("La imagen debe ser JPG, PNG o WebP.");
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("La imagen debe pesar menos de 2 MB.");
  }
  const extension = supported.get(match[1]);
  if (!extension) throw new Error("Formato de imagen no permitido.");
  const looksValid =
    (extension === "jpg" && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) ||
    (extension === "png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (extension === "webp" &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP");
  if (!looksValid) throw new Error("El archivo no corresponde a una imagen válida.");
  return { bytes, extension };
}

export async function saveImage(dataUrl: unknown, category: "profiles" | "selfies") {
  const { bytes, extension } = parseImageDataUrl(dataUrl);
  const folder = path.join(storageRoot(), category);
  await mkdir(folder, { recursive: true });
  const name = `${randomUUID()}.${extension}`;
  await writeFile(path.join(folder, name), bytes, { flag: "wx" });
  return `${category}/${name}`;
}

export function imagePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!/^(profiles|selfies)\/[a-zA-Z0-9-]+\.(jpg|png|webp)$/.test(normalized)) {
    throw new Error("Ruta de imagen no válida.");
  }
  return path.join(storageRoot(), normalized);
}

export async function getImage(relativePath: string) {
  return readFile(imagePath(relativePath));
}

export async function removeImage(relativePath: string) {
  try {
    await unlink(imagePath(relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function mimeFromPath(relativePath: string) {
  if (relativePath.endsWith(".png")) return "image/png";
  if (relativePath.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
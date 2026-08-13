import { randomUUID } from "node:crypto";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";

// Photos captured by operators when verifying a stop live in this container.
const CONTAINER = "service-photos";

// Allowed image content types → file extension.
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic"
};

const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic"
};

let containerPromise: Promise<ContainerClient> | null = null;

function connectionString(): string {
  // A dedicated connection can override the Functions storage account; otherwise
  // reuse AzureWebJobsStorage (Azurite locally, the real account in prod).
  const conn = process.env.SERVICE_PHOTO_STORAGE || process.env.AzureWebJobsStorage;
  if (!conn) {
    throw new Error("No storage connection configured (SERVICE_PHOTO_STORAGE / AzureWebJobsStorage).");
  }
  return conn;
}

async function getContainer(): Promise<ContainerClient> {
  if (!containerPromise) {
    containerPromise = (async () => {
      const service = BlobServiceClient.fromConnectionString(connectionString());
      const container = service.getContainerClient(CONTAINER);
      // Private container (no public access) — reads go through the API.
      await container.createIfNotExists();
      return container;
    })().catch((err) => {
      // Reset so a transient failure doesn't poison every later call.
      containerPromise = null;
      throw err;
    });
  }
  return containerPromise;
}

export function extForContentType(contentType: string): string | null {
  return EXT_BY_TYPE[contentType.toLowerCase()] ?? null;
}

// Upload one photo; returns the stored blob name (used as its "path").
export async function uploadServicePhoto(bytes: Buffer, contentType: string): Promise<string> {
  const ext = extForContentType(contentType);
  if (!ext) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }
  const container = await getContainer();
  const blobName = `${randomUUID()}.${ext}`;
  const block = container.getBlockBlobClient(blobName);
  await block.uploadData(bytes, { blobHTTPHeaders: { blobContentType: contentType } });
  return blobName;
}

// Fetch a stored photo's bytes + content type by blob name.
export async function downloadServicePhoto(
  blobName: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const container = await getContainer();
  const block = container.getBlockBlobClient(blobName);
  if (!(await block.exists())) {
    return null;
  }
  const buffer = await block.downloadToBuffer();
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
  const contentType = TYPE_BY_EXT[ext] ?? "application/octet-stream";
  return { buffer, contentType };
}

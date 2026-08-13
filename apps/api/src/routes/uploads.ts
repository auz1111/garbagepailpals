import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { servicePhotoUploadResponseSchema } from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import { downloadServicePhoto, extForContentType, uploadServicePhoto } from "../lib/blob";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per photo

// Operator uploads a single verification photo (raw image bytes in the body).
// Returns the stored blob path to persist in the stop's verification checklist.
export async function uploadServicePhotoHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req) => {
        const contentType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
        if (!extForContentType(contentType)) {
          throw new HttpError(415, "Unsupported image type. Use JPEG, PNG, WEBP, or HEIC.");
        }
        const body = Buffer.from(await req.arrayBuffer());
        if (body.length === 0) {
          throw new HttpError(400, "Empty upload.");
        }
        if (body.length > MAX_BYTES) {
          throw new HttpError(413, "Image is too large (max 8 MB).");
        }
        const path = await uploadServicePhoto(body, contentType);
        return jsonResponse(201, servicePhotoUploadResponseSchema.parse({ path }));
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}

// Streams a stored verification photo back (auth-gated — the container is private).
export async function getServicePhotoHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req) => {
        const blobName = req.params.blob;
        // Guard against path traversal — blob names are "<uuid>.<ext>" only.
        if (!blobName || !/^[a-zA-Z0-9-]+\.[a-z]+$/.test(blobName)) {
          throw new HttpError(400, "Invalid photo id.");
        }
        const found = await downloadServicePhoto(blobName);
        if (!found) {
          throw new HttpError(404, "Photo not found.");
        }
        return {
          status: 200,
          headers: {
            "Content-Type": found.contentType,
            "Cache-Control": "private, max-age=86400",
            "Access-Control-Allow-Origin": process.env.WEB_ORIGIN ?? "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Methods": "GET,OPTIONS"
          },
          body: found.buffer
        };
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}

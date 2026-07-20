// Copyright (C) 2026 Defa Wang

export type ContentKind = "markdown" | "json" | "html" | "image" | "video" | "audio" | "text" | "binary" | "unknown";

export type StandardStorageMetadata = Record<string, unknown> & {
  provider?: string;
  cid?: string;
  gatewayUrl?: string;
  name?: string;
  contentType?: string;
  contentKind?: ContentKind;
  size?: number;
  storailEncryption?: {
    plaintextContentType?: string;
    plaintextContentKind?: ContentKind;
  } & Record<string, unknown>;
};

const extensionContentTypes: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".txt": "text/plain",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

export function inferContentType(input: { contentType?: string; name?: string; blobType?: string }): string {
  const explicit = normalizeContentType(input.contentType);
  if (explicit) {
    return explicit;
  }
  const byName = contentTypeFromName(input.name);
  if (byName) {
    return byName;
  }
  const blobType = normalizeContentType(input.blobType);
  if (blobType) {
    return blobType;
  }
  return "application/octet-stream";
}

export function resolveContentKind(input: { contentType?: string; name?: string; pointer?: string }): ContentKind {
  const contentType = normalizeContentType(input.contentType) || contentTypeFromName(input.name) || contentTypeFromName(input.pointer);
  if (!contentType) {
    return "unknown";
  }
  if (contentType === "text/markdown" || contentType === "text/x-markdown") {
    return "markdown";
  }
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    return "json";
  }
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return "html";
  }
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  if (contentType.startsWith("audio/")) {
    return "audio";
  }
  if (contentType.startsWith("text/")) {
    return "text";
  }
  if (contentType === "application/octet-stream") {
    return "binary";
  }
  return "unknown";
}

export function storageMetadata(input: {
  provider: string;
  cid: string;
  name?: string;
  contentType: string;
  contentKind: ContentKind;
  size: number;
  gatewayUrl?: string;
  metadata?: Record<string, unknown>;
}): StandardStorageMetadata {
  return {
    ...userStorageMetadata(input.metadata),
    provider: input.provider,
    cid: input.cid,
    ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
    ...(input.name ? { name: input.name } : {}),
    contentType: input.contentType,
    contentKind: input.contentKind,
    size: input.size,
  };
}

export function userStorageMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const result = { ...(metadata ?? {}) };
  for (const key of ["provider", "cid", "gatewayUrl", "url", "name", "contentType", "contentKind", "size"]) {
    delete result[key];
  }
  return result;
}

function normalizeContentType(value: string | undefined): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function contentTypeFromName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  const pathname = name.split(/[?#]/)[0] ?? name;
  const dot = pathname.lastIndexOf(".");
  if (dot === -1) {
    return undefined;
  }
  return extensionContentTypes[pathname.slice(dot).toLowerCase()];
}

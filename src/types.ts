export interface FileResult {
  /** Absolute path of the generated/manipulated file on this machine. */
  filePath: string;
  mimeType: string;
  bytes: number;
  /** SHA-256 hex digest of the file contents. */
  sha256: string;
  /** Optional operation-specific metadata (duration, dimensions, …). */
  meta?: Record<string, string | number | boolean | null>;
}

export interface ProbeInfo {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  formatName: string;
}

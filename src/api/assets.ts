import { existsSync, mkdirSync } from "fs";
import type { ApiConfig } from "../config";
import path from "path";

export function ensureAssetsDir(cfg: ApiConfig) {
  if (!existsSync(cfg.assetsRoot)) {
    mkdirSync(cfg.assetsRoot, { recursive: true });
  }
}

export function mediaTypeExt(mediaType: string) {
  const parts = mediaType.split("/");

  if (parts.length !== 2) {
    return ".bin";
  }

  return "." + parts[1];
}

export function getAssetDiskPath(cfg: ApiConfig, assetPath: string) {
  return path.join(cfg.assetsRoot, assetPath);
}

export function getAssetURL(cfg: ApiConfig, assetPath: string) {
  return `http://localhost:${cfg.port}/${assetPath}`;
}

export function getS3URL(cfg: ApiConfig, key: string) {
  return `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
}

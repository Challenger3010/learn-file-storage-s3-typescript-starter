import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { S3Client, type BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import {
  getAssetDiskPath,
  getAssetURL,
  getS3URL,
  mediaTypeExt,
} from "./assets";
import { randomBytes } from "node:crypto";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading video ", videoId, "by user", userID);

  const video = getVideo(cfg.db, videoId);

  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (video?.userID != userID) {
    throw new UserForbiddenError("Forbidden");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  const MAX_UPLOAD_SIZE = 1 << 30;

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(
      `Video file exceeds the maximum allowed size of 1GB`,
    );
  }

  const fileData = await file.arrayBuffer();
  if (!fileData) {
    throw new Error("Error reading file data");
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Invalid file type. Only mp4");
  }

  const fileKey = randomBytes(32).toString("base64url");

  const ext = mediaTypeExt(mediaType);
  const fileName = `${fileKey}${ext}`;

  const assetDiskPath = getAssetDiskPath(cfg, fileName);

  await Bun.write(assetDiskPath, fileData);

  const s3File = cfg.s3Client.file(fileName);
  const content = Bun.file(assetDiskPath);
  await s3File.write(content, { type: mediaType });

  const newVideoUrl = getS3URL(cfg, fileName);
  video.videoURL = newVideoUrl;

  updateVideo(cfg.db, video);

  await content.delete();

  return respondWithJSON(200, null);
}

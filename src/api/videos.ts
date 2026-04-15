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

  const aspectRatio = await getVideoAspectRatio(assetDiskPath);
  const processedVideo = await processVideoForFastStart(assetDiskPath);

  console.log(assetDiskPath);
  console.log(processedVideo);

  const s3Name = `${aspectRatio}/${processedVideo}`;

  const s3File = cfg.s3Client.file(s3Name);
  const content = Bun.file(`assets/${processedVideo}`);
  const oldVid = Bun.file(assetDiskPath);

  await s3File.write(content, { type: mediaType });

  const newVideoUrl = getS3URL(cfg, s3Name);

  video.videoURL = newVideoUrl;

  updateVideo(cfg.db, video);

  await content.delete();
  await oldVid.delete();

  return respondWithJSON(200, null);
}

export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn({
    cmd: [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    stderr: "pipe",
    stdout: "pipe",
  });

  const stdoutText = await new Response(proc.stdout).json();
  const stderrText = await new Response(proc.stderr).text();

  if (stderrText) {
    console.error("FFprobe Fehler:", stderrText);
    return null;
  }

  const { width, height } = stdoutText.streams[0];

  const ratio = width / height;

  let aspectRatio = "";

  if (ratio <= 1.8 && ratio >= 1.6) {
    aspectRatio = "landscape";
  } else if (ratio <= 0.6 && ratio >= 0.5) {
    aspectRatio = "portrait";
  } else {
    aspectRatio = "other";
  }

  return aspectRatio;
}

export async function processVideoForFastStart(inputFilePath: string) {
  let outputFilePath = `${inputFilePath}.processed`;

  const proc = Bun.spawn({
    cmd: [
      "ffmpeg",
      "-i",
      inputFilePath,
      "-movflags",
      "faststart",
      "-map_metadata",
      "0",
      "-codec",
      "copy",
      "-f",
      "mp4",
      outputFilePath,
    ],
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`FFmpeg Prozess fehlgeschlagen mit Code ${exitCode}`);
  }

  outputFilePath = outputFilePath.split("/")[1];

  return outputFilePath;
}

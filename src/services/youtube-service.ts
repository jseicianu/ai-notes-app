import { YoutubeTranscript } from "youtube-transcript";

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

export function parseYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (!host.endsWith("youtube.com")) return null;

    if (parsed.pathname === "/watch") return parsed.searchParams.get("v");

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] === "embed" || parts[0] === "v" || parts[0] === "shorts") {
      return parts[1] ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

export async function extractYouTubeTranscript(url: string): Promise<{
  videoId: string;
  title: string;
  channelName: string;
  transcript: string;
  duration: string;
  thumbnailUrl: string;
}> {
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const metadataUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    url
  )}&format=json`;
  const [metadataResponse, segments] = await Promise.all([
    fetch(metadataUrl),
    YoutubeTranscript.fetchTranscript(videoId).catch(() => {
      throw new Error("No captions available for this video");
    }),
  ]);

  if (!metadataResponse.ok) {
    throw new Error("Could not load YouTube metadata");
  }

  const metadata = (await metadataResponse.json()) as OEmbedResponse;
  const transcript = segments
    .map((segment) => `[${formatTimestamp(segment.offset / 1000)}] ${segment.text}`)
    .join("\n");
  const last = segments.at(-1);
  const durationSeconds = last ? Math.ceil(last.offset / 1000 + last.duration / 1000) : 0;

  return {
    videoId,
    title: metadata.title ?? videoId,
    channelName: metadata.author_name ?? "",
    transcript,
    duration: formatTimestamp(durationSeconds),
    thumbnailUrl: metadata.thumbnail_url ?? "",
  };
}

function formatTimestamp(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

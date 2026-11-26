// Creator videos (server/videos/creatorVideos.ts): public videos from the creator channels the owner watches (FUN
// Robotics Network first), with the FTC teams found in them. Shared by the server, the team page's Featured section
// and badge, and the Videos tab.

/** A series, from the channel's own playlists (or its title when it's in none of them). */
export type CreatorSeries = "behind-the-bot" | "pits-and-parts" | "top-25" | "funalysis";
/** The program a video is about: only FTC videos are tagged with teams. */
export type CreatorProgram = "ftc" | "frc" | "vex" | "unknown";

export const SERIES_LABEL: Record<CreatorSeries, string> = {
  "behind-the-bot": "Behind the Bot",
  "pits-and-parts": "Pits & Parts",
  "top-25": "Top 25",
  funalysis: "FUNalysis",
};

export const seriesLabel = (s: string | null | undefined): string | null => (s && s in SERIES_LABEL ? SERIES_LABEL[s as CreatorSeries] : null);

/** One creator video, as creatorVideosFor answers (newest first; embeddable ones only). */
export interface CreatorVideo {
  videoId: string;
  channelId: string;
  /** The channel's title, when known. */
  channel: string | null;
  title: string;
  /** UTC ISO. */
  publishedAt: string;
  durationS: number | null;
  series: CreatorSeries | null;
  program: CreatorProgram;
  /** Its FTC season (2025 for DECODE), from a game named in it or its date. */
  season: number | null;
  /** FTC teams tagged in it (tags the owner removed left out). */
  teams: number[];
}

/** A team's place in a creator video (TeamProfile.featured): a video whose title names the team. */
export interface FeaturedVideo {
  series: CreatorSeries | null;
  videoId: string;
  season: number | null;
  title: string;
}

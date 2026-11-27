// What plays next on the watch page (./upNext.ts): the video asked for with its description; opened from a team, that
// team's own episodes first (title tags only) and left out of the rest; then the series newest first, page after page
// by keyset until it ends, never repeating; a video that isn't a creator video still gets Behind the Bot to follow.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { upNext, UP_NEXT_PAGE } from "./upNext";
import { UP_NEXT_CURSOR } from "../../src/shared/watch";

const CH = "UCuJUknE5JjilAfNnmbvr22Q";
const id = (n: number) => `btb${String(n).padStart(8, "0")}`;
const N = UP_NEXT_PAGE * 2 + 5;

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (21229, 'Quality Control', 'Bellevue', 'WA', 'USA')");
  await run("INSERT INTO creator_channels (channel_id, handle, title, uploads_playlist, active, added_by, added_at) VALUES (?, '@funroboticsnetwork', 'FUN Robotics Network', ?, 1, 'seed', '2026-11-01T00:00:00Z')", [CH, `UU${CH.slice(2)}`]);
  const v = "INSERT INTO creator_videos (video_id, channel_id, title, description, published_at, duration_s, series, program, season, embeddable, last_refreshed) VALUES (?, ?, ?, ?, ?, 600, ?, 'ftc', 2026, ?, '2026-11-26T00:00:00Z')";
  // N Behind the Bot episodes a day apart (two share a publish time, so the keyset's id half is used), newest first by number.
  for (let i = 0; i < N; i++) {
    const at = new Date(Date.parse("2026-11-25T15:00:00Z") - Math.min(i, N - 2) * 864e5).toISOString();
    await run(v, [id(i), CH, `Team ${1000 + i} | Behind the Bot | FTC BIOBUZZ Robot`, `Episode ${i}`, at, "behind-the-bot", 1]);
  }
  await run(v, ["snapsnapsn1", CH, "Turret | 21229 Quality Control | FTC BIOBUZZ Snapshot", "", "2026-11-24T15:00:00Z", null, 1]);
  await run(v, ["hiddenhidd1", CH, "21229 Quality Control | Behind the Bot | old cut", "", "2026-11-23T15:00:00Z", "behind-the-bot", 0]);
  // 21229 is in two episodes' titles and one only in a description.
  for (const [vid, rule] of [[id(3), "title:cue"], [id(9), "title:bare-name"], [id(4), "description:cue"], ["snapsnapsn1", "title:bare-name"], ["hiddenhidd1", "title:cue"]] as const) {
    await run("INSERT INTO video_team_tags (video_id, team_number, rule) VALUES (?, 21229, ?)", [vid, rule]);
  }
});

describe("up next", () => {
  it("gives the video with its description, then the series newest first, page after page to the end without repeats", async () => {
    const first = await upNext({ videoId: id(0), team: null, cursor: null });
    expect(first.video).toMatchObject({ videoId: id(0), series: "behind-the-bot", description: "Episode 0", channel: "FUN Robotics Network" });
    expect(first.team).toBeNull();
    expect(first.items[0].videoId).toBe(id(1));
    expect(first.items.map((v) => v.videoId)).not.toContain(id(0));
    const seen = [...first.items.map((v) => v.videoId)];
    let next = first.next;
    let pages = 1;
    while (next) {
      expect(next).toMatch(UP_NEXT_CURSOR);
      const p = await upNext({ videoId: id(0), team: null, cursor: next });
      expect(p.team).toBeNull();
      seen.push(...p.items.map((v) => v.videoId));
      next = p.next;
      pages++;
    }
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(Array.from({ length: N - 1 }, (_, i) => id(i + 1)).sort((a, b) => seen.indexOf(a) - seen.indexOf(b)));
    expect(seen).toHaveLength(N - 1);
  });

  it("opened from a team: its own episodes first (title names it, embeddable), left out of the rest", async () => {
    const a = await upNext({ videoId: id(3), team: 21229, cursor: null });
    expect(a.team).toMatchObject({ number: 21229, name: "Quality Control" });
    expect(a.team!.videos.map((v) => v.videoId)).toEqual(["snapsnapsn1", id(3), id(9)]);
    expect(a.items.map((v) => v.videoId)).not.toContain(id(9));
    expect(a.items.map((v) => v.videoId)).toContain(id(4));
    const later = await upNext({ videoId: id(3), team: 21229, cursor: a.next });
    expect(later.team).toBeNull();
    expect(later.items.map((v) => v.videoId)).not.toContain(id(9));
  });

  it("a video that isn't a creator video still gets Behind the Bot to follow", async () => {
    const a = await upNext({ videoId: "matchclip01", team: null, cursor: null });
    expect(a.video).toBeNull();
    expect(a.items[0].videoId).toBe(id(0));
    expect((await upNext({ videoId: "hiddenhidd1", team: null, cursor: null })).video).toBeNull();
  });
});

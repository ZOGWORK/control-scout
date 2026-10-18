// Colours a scout gives their shortlisted teams (personal, synced like the rest of PersonalState):
// a fixed palette, so a saved colour always reads well on both themes and charts can use it as is.

export interface TeamColor { id: string; label: string; /** Any CSS colour (fills, dots, chart lines). */ css: string }

export const TEAM_COLORS: readonly TeamColor[] = [
  { id: "gold", label: "Gold", css: "#eab308" },
  { id: "sky", label: "Sky", css: "#38bdf8" },
  { id: "emerald", label: "Emerald", css: "#34d399" },
  { id: "violet", label: "Violet", css: "#a78bfa" },
  { id: "orange", label: "Orange", css: "#fb923c" },
  { id: "rose", label: "Rose", css: "#f43f5e" },
  { id: "pink", label: "Pink", css: "#f472b6" },
  { id: "teal", label: "Teal", css: "#2dd4bf" },
];

const BY_ID = new Map(TEAM_COLORS.map((c) => [c.id, c]));
export const teamColorById = (id: string | null | undefined): TeamColor | null => (id ? BY_ID.get(id) ?? null : null);

/** A team's chosen colour, if any. */
export const teamColorOf = (colors: Record<string, string>, team: number): TeamColor | null => teamColorById(colors[String(team)]);

export const MAX_TEAM_COLORS = 500;

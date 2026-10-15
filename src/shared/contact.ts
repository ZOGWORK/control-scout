// The contact form's topics and limits, shared by /contact and POST /api/contact.

export const CONTACT_TOPICS = [
  { id: "bug", label: "Bug report" },
  { id: "data", label: "Data correction" },
  { id: "feature", label: "Feature idea" },
  { id: "other", label: "Something else" },
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number]["id"];

export const CONTACT_LIMITS = { name: 100, messageMin: 10, messageMax: 5000 } as const;

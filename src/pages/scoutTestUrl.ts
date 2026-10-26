// Tests of the Scout page's entry list, filters, forms and views: a /scout link with no tab or view opens
// Data → Entries, where the entry list and New entry live since the redesign (the Match tab has its own tests).
export const asEntries = (url: string) => (/[?&](tab|view)=/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}tab=data&view=entries`);

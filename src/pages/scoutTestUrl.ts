// Tests of the Scout page's entry list, filters, forms and views: a /scout link with no tab or view opens
// Entries, where the entry list and New entry live (Event day has its own tests).
export const asEntries = (url: string) => (/[?&](tab|view)=/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}tab=entries`);

// Lite's Network & offline screen (/lite/network, the twin of the full /settings#network): one screen that answers am
// I online, on Wi-Fi, mobile data or nothing, is that actually giving internet, how much a download uses, and what's
// downloaded here and how big it is; then the switches, each with the one line saying what it does.
//
// The server draws everything it knows: the status as of this page load (it answered, so there's internet), the
// download sizes from the pack list (/packs/latest.json), and the Lite switch (the cs-lite cookie). What only the
// device knows (the connection's type, a fresh check, the downloads in this browser's storage, the download choices
// saved with the account) comes from one small inline script, the only script any Lite page runs: a fixed string, so
// its hash is fixed and the page's CSP allows that script and nothing else (connect-src 'self' for the check).
// Every word it shows is drawn here, by the same functions the full screen uses (src/shared/networkStatus.ts),
// and handed to it as data: the script picks a sentence, it never writes one.
import { createHash } from "node:crypto";
import { seasonLabel } from "../../src/shared/format.js";
import {
  LITE_LINE, connectionLabel, downloadChoices, internetLabel, mobileWarning, sizeLines, statusSentence, updateChoices,
  type ConnectionType, type DownloadNetwork, type Internet, type PackSizes,
} from "../../src/shared/networkStatus.js";
import { SEASON_NUMBERS } from "../data/seasons.js";
import { button, card, esc, note, section, title, type LitePage, type LiteView } from "./render.js";
import { fullOnce } from "./pages.js";

/** What the pack list said: its sizes, or why there are none (none published yet, or switched off for now). */
export type PackList = { m: PackSizes } | { none: true } | { paused: string };

/** Every sentence the script may show, keyed by the facts that pick it. */
export function netWords(season: number, packs: PackList) {
  const m = "m" in packs ? packs.m : null;
  const s = (internet: Internet, online: boolean, type: ConnectionType, raw?: string) => statusSentence({ internet, online, type }, raw);
  const types: [string, ConnectionType, string?][] = [["wifi", "wifi"], ["cable", "wifi", "ethernet"], ["cellular", "cellular"], ["none", "none"], ["unknown", "unknown"]];
  const warning = mobileWarning(m, season);
  return {
    // The status: yes, a sign-in page on Wi-Fi or on another network, nothing through while the browser says it's
    // online or not, not checked yet.
    s: { yes: s("yes", true, "wifi"), pw: s("portal", true, "wifi"), pn: s("portal", true, "unknown"), no1: s("no", true, "wifi"), no0: s("no", false, "none"), un: s("unknown", true, "unknown") },
    c: Object.fromEntries(types.map(([k, t, raw]) => [k, connectionLabel(t, raw)])),
    i: { yes: internetLabel("yes", true), portal: internetLabel("portal", true), no1: internetLabel("no", true), no0: internetLabel("no", false), un: internetLabel("unknown", true) },
    // Download and update choices: [this browser tells Wi-Fi from mobile data, it can't].
    dn: [downloadChoices(false, warning), downloadChoices(true, warning)],
    up: Object.fromEntries((["wifi", "any"] as DownloadNetwork[]).map((n) => [n, [updateChoices(n, false), updateChoices(n, true)]])),
    // Season names for the seasons a device can hold.
    sn: Object.fromEntries(SEASON_NUMBERS.map((x) => [x, seasonLabel(x)])),
  };
}

/** The device's half: the connection check (as src/lib/connection.ts classify() reads the answer), the downloads in
 *  this browser's storage (as src/lib/offline/storage.ts and NetworkSection list them), and the saved choices. ES5-ish
 *  and small (it travels with every load of this page). */
export const NET_SCRIPT = `(function(){var d=document,$=function(i){return d.getElementById(i)},R=$("n-status");if(!R)return;
var W=JSON.parse(R.getAttribute("data-words")),N=navigator,C=N.connection||null,st={internet:"yes",at:0},busy=false;
function ls(k){try{return JSON.parse(localStorage.getItem(k)||"null")}catch(e){return null}}
function e(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function txt(i,s){var x=$(i);if(x)x.textContent=s}
function fb(b){return b<1e6?Math.round(b/1e3)+" KB":b<1e9?(b/1e6).toFixed(1)+" MB":(b/1e9).toFixed(2)+" GB"}
function sl(s){return W.sn[s]||(s+"\\u2013"+String((s+1)%100).padStart(2,"0"))}
function raw(){return C&&C.type||null}
function kind(){var t=raw();return t==="wifi"||t==="ethernet"?"wifi":t==="cellular"||t==="wimax"||t==="bluetooth"?"cellular":"unknown"}
function draw(){var on=N.onLine!==false,t=on?kind():"none",i=st.internet;
var s=i==="yes"?W.s.yes:i==="portal"?(t==="wifi"&&raw()!=="ethernet"?W.s.pw:W.s.pn):i==="no"?(on?W.s.no1:W.s.no0):W.s.un;
R.setAttribute("data-internet",i);txt("n-title",s.title);var dt=$("n-detail");dt.textContent=s.detail||"";dt.hidden=!s.detail;
txt("n-type",t==="wifi"&&raw()==="ethernet"?W.c.cable:W.c[t]);$("n-type-note").hidden=t!=="unknown";
txt("n-net",i==="yes"?W.i.yes:i==="portal"?W.i.portal:i==="no"?(on?W.i.no1:W.i.no0):W.i.un);
if(st.at)txt("n-when","Checked at "+new Date(st.at).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}));
var p=ls("cs-personal:settings"),v=p&&p.value||{},net=v.offlineNetwork==="any"?"any":"wifi",un=kind()==="unknown"?1:0;
var dn=W.dn[un].filter(function(c){return c.value===net})[0],up=W.up[net][un].filter(function(c){return c.value===(v.offlineUpdates==="ask"?"ask":"auto")})[0];
txt("n-dn",dn.name);txt("n-dn-line",dn.line);txt("n-up",up.name);txt("n-up-line",up.line)}
function cls(r){if(r.type==="opaqueredirect"||(r.status>=300&&r.status<400))return"portal";
if(r.redirected&&r.url&&new URL(r.url,location.href).origin!==location.origin)return"portal";
if(r.status===511)return"portal";if(r.status>=500)return"yes";
return r.text().then(function(x){var b;try{b=JSON.parse(x)}catch(e){return"portal"}return b&&typeof b==="object"&&b.ok===true?"yes":"portal"},function(){return"no"})}
function check(){if(busy)return;busy=true;var b=$("n-check");b.disabled=true;b.textContent="Checking";
var c=typeof AbortController!=="undefined"?new AbortController():null,tm=setTimeout(function(){if(c)c.abort()},2500);
fetch("/api/health",{cache:"no-store",redirect:"manual",credentials:"omit",signal:c?c.signal:undefined,headers:{Accept:"application/json"}})
.then(cls)["catch"](function(){return"no"}).then(function(i){clearTimeout(tm);st={internet:i,at:Date.now()};busy=false;b.disabled=false;b.textContent="Check again";draw()})}
function packs(){var o=String(localStorage.getItem("cs-personal-owner")||""),L=[],ev=[];
(ls("cs-event-bundles")||[]).forEach(function(x){if(!x.workspace||(x.accountId!=null&&String(x.accountId)===o)){L.push([x.name,x.bytes,x.dataAsOf||x.builtAt]);ev.push(x)}});
(ls("cs-offline-seasons")||[]).slice().sort(function(a,b){return b.season-a.season}).forEach(function(x){L.push([sl(x.season)+" season",x.bytes,x.dataAsOf||new Date(x.savedAt).toISOString()])});
var m=ls("cs-pack-meta");if(m)L.push(["Offline predictions",m.bytes,m.builtAt]);
var now=new Date(),h=L.map(function(r){var t=new Date(r[2]),w=isNaN(t)?"unknown":t.toDateString()===now.toDateString()?t.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}):t.toLocaleDateString(undefined,{month:"short",day:"numeric",year:t.getFullYear()===now.getFullYear()?undefined:"numeric"});
return'<div class="row one"><span><b>'+e(r[0])+"</b><small>Data from "+e(w)+'</small></span><span class="res">'+e(fb(r[1]||0))+"</span></div>"}).join("");
var tot=L.reduce(function(n,r){return n+(r[1]||0)},0);
$("n-dl").innerHTML=L.length?'<div class="list">'+h+'</div><p class="note">All together: '+e(fb(tot))+".</p>":'<div class="card"><p class="m">Nothing downloaded yet. Download an event before you go, while you have a connection.</p></div>';
var u=$("n-sizes");[].slice.call(u.querySelectorAll("li.ev")).forEach(function(x){x.remove()});
u.insertAdjacentHTML("afterbegin",ev.slice(0,2).map(function(x){return'<li class="ev">Downloading '+e(x.name)+" used "+e(fb(x.bytes||0))+".</li>"}).join(""))}
$("n-check").hidden=false;$("n-check").onclick=check;
try{packs()}catch(x){}draw();check();
addEventListener("online",check);addEventListener("offline",function(){st={internet:"no",at:Date.now()};draw();check()});
addEventListener("storage",function(){try{packs()}catch(x){}draw()});addEventListener("pageshow",function(v){if(v.persisted)check()});
if(C&&C.addEventListener)C.addEventListener("change",draw)})();`;

/** The script's CSP source: its sha256 (server/lite/routes.ts LITE_NET_CSP). */
export const NET_SCRIPT_HASH = `'sha256-${createHash("sha256").update(NET_SCRIPT, "utf8").digest("base64")}'`;

/** A row of the "Right now" table: what's asked, and its answer (an id the script fills). */
const row = (label: string, id: string, value: string, extra = "") => `<tr><th scope="row">${esc(label)}</th><td class="n" id="${id}">${esc(value)}</td></tr>${extra}`;

/** One switch: its name, what it is now, the line saying what it does, and its button when there is one here. */
const control = (label: string, id: string, now: string, line: string, action = "") =>
  `<div class="card"><p class="m s">${esc(label)}</p><p><b id="${id}">${esc(now)}</b></p><p class="m s" id="${id}-line">${esc(line)}</p>${action}</div>`;

export function networkPage(view: LiteView, season: number, packs: PackList): LitePage {
  const w = netWords(season, packs);
  const m = "m" in packs ? packs.m : null;
  const back = encodeURIComponent("/lite/network");
  const missing = "paused" in packs ? `Download sizes aren't available. ${packs.paused}` : "none" in packs ? "No downloads have been published yet." : null;
  const status = `<section class="sec card" id="n-status" data-internet="yes" data-words="${esc(JSON.stringify(w))}">`
    + `<h2 id="n-title" aria-live="polite">${esc(w.s.yes.title)}</h2><p id="n-detail" hidden></p>`
    + `<p class="m s" id="n-when">Checked as this page loaded.</p>`
    + `<p><button class="btn wide" id="n-check" type="button" hidden>Check again</button></p></section>`;
  const now = section("Right now", `<div class="tbl"><table><tbody>`
    + row("Connection", "n-type", w.c.unknown) + row("Internet", "n-net", w.i.yes) + `</tbody></table></div>`
    + `<p class="note" id="n-type-note">Some browsers (every iPhone) don't tell websites whether they're on Wi-Fi or mobile data.</p>`);
  // The events downloaded here come first ("Downloading … used …"): the script adds them, from this device's list.
  const sizes = section("How much a download uses", card(`<ul class="why" id="n-sizes">`
    + sizeLines(m, season, []).map((l) => `<li>${esc(l)}</li>`).join("")
    + `<li>Each event's size shows before you download it.</li>${missing ? `<li>${esc(missing)}</li>` : ""}</ul>`));
  const here = section("Downloaded on this device", `<div id="n-dl">${card(`<p class="m">Reading this device's downloads…</p>`)}</div>`
    + `<noscript>${card(`<p>Scripts are off in this browser, so this page can't read what's downloaded. The full version's Downloads page lists it.</p>`)}</noscript>`
    + note("Downloads open with no connection.") + `<p class="back">${button(fullOnce("/download", view), "Manage downloads (full version)")}</p>`);
  const lite = control("Lite", "n-lite", view.sticky ? "Lite is on" : "Lite is off", LITE_LINE,
    `<p>${button(view.sticky ? `/lite/off?next=${back}` : `/lite/on?next=${back}`, view.sticky ? "Turn off Lite" : "Turn on Lite")}</p>`);
  const dn = w.dn[0][0], up = w.up.wifi[0][0];
  const controls = section("Settings", `<div class="stack">${lite}`
    + control("Downloads use", "n-dn", dn.name, dn.line) + control("Updates", "n-up", up.name, up.line) + `</div>`
    + note("Downloads and Updates sync with your account when you're signed in. Change them in the full version.")
    + `<p class="back">${button(fullOnce("/network", view), "Change in the full version")}</p>`);
  const body = title("Network &amp; offline", "Your connection, and what's downloaded on this device.")
    + status + now + sizes + here + controls + `<script>${NET_SCRIPT}</script>`;
  return { title: "Network & offline", full: "/network", body };
}

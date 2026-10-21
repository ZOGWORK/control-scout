// Settings › Appearance › Phone tab bar: which pages sit in the phone's bottom bar, and in what order
// (src/lib/tabBar.ts). Rows stay in the menu's order, so a row never jumps away from the finger or the keyboard
// focus; the preview above them shows the bar as it will look.
import { useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { DEFAULT_TABS, MAX_TABS, MIN_TABS, moveTab, saveTabs, tabDef, TAB_OPTIONS, toggleTab, useTabBar, type TabId } from "../../lib/tabBar";
import { useYoursRow } from "../../lib/yoursRow";
import { Button } from "../ui/button";
import { Switch } from "../ui/controls";
import { cn } from "../cn";
import { Group, Row } from "./rows";

export function TabBarSettings() {
  const tabs = useTabBar();
  const { row } = useYoursRow();
  const [said, setSaid] = useState("");
  const label = (id: TabId) => (id === "myTeam" ? row.label : tabDef(id).label);
  const isDefault = tabs.join() === DEFAULT_TABS.join();

  const set = (next: TabId[], message: string) => { if (next !== tabs) { saveTabs(next); setSaid(message); } };
  const toggle = (id: TabId) => {
    const next = toggleTab(tabs, id);
    set(next, next.includes(id) ? `${label(id)} added, place ${next.length} of ${next.length}.` : `${label(id)} removed.`);
  };
  const move = (id: TabId, by: -1 | 1) => {
    const next = moveTab(tabs, id, by);
    set(next, `${label(id)} moved to place ${next.indexOf(id) + 1} of ${next.length}.`);
  };

  return (
    <Group title="Phone tab bar"
      description={<>The pages in the bar at the bottom of the screen on a phone: {MIN_TABS} to {MAX_TABS}. Kept on this device only. Every page, these included, is always in the menu behind the top-left button.</>}>
      <Row label="Preview" stack>
        <ol aria-label="Tab bar preview" className="mx-auto flex w-full max-w-[390px] overflow-hidden rounded-xl border border-line bg-secondary">
          {tabs.map((id, i) => {
            const Icon = tabDef(id).icon;
            return (
              <li key={id} className={cn("flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 text-xs font-medium", i === 0 ? "text-accent-text" : "text-text-muted")}>
                <Icon className="size-5 shrink-0" aria-hidden /><span className="max-w-full truncate">{label(id)}</span>
              </li>
            );
          })}
        </ol>
      </Row>
      <ul aria-label="Pages for the tab bar">
        {TAB_OPTIONS.map(({ id, icon: Icon }) => {
          const at = tabs.indexOf(id), on = at >= 0;
          const name = id === "myTeam" ? row.label : tabDef(id).name ?? tabDef(id).label;
          // At the limits a switch can't change: the last two can't come off, and a sixth can't go on.
          const locked = on ? tabs.length <= MIN_TABS : tabs.length >= MAX_TABS;
          return (
            <li key={id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
              <Icon className={cn("size-4 shrink-0", on ? "text-accent-text" : "text-text-muted")} aria-hidden />
              <div className="min-w-0 flex-1">
                <label htmlFor={`tab-${id}`} className="block truncate text-sm font-medium text-foreground">{name}</label>
                <p className="text-xs text-muted-foreground">{on ? `Place ${at + 1} of ${tabs.length}` : locked ? `The bar is full (${MAX_TABS})` : "In the menu only"}</p>
              </div>
              {on && (
                <div className="flex shrink-0 items-center">
                  {/* aria-disabled, not disabled: a button that disables itself under the keyboard would drop focus. */}
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${name} left`} aria-disabled={at === 0}
                    className="aria-disabled:opacity-40" onClick={() => at > 0 && move(id, -1)}><ChevronLeft className="size-4" /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${name} right`} aria-disabled={at === tabs.length - 1}
                    className="aria-disabled:opacity-40" onClick={() => at < tabs.length - 1 && move(id, 1)}><ChevronRight className="size-4" /></Button>
                </div>
              )}
              <Switch id={`tab-${id}`} checked={on} disabled={locked} onCheckedChange={() => toggle(id)}
                title={locked ? (on ? `The bar needs at least ${MIN_TABS} pages` : `The bar holds at most ${MAX_TABS} pages`) : undefined} />
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p className="text-xs text-muted-foreground">{tabs.length} of {MAX_TABS} in the bar</p>
        <Button type="button" variant="secondary" size="sm" aria-disabled={isDefault} className="aria-disabled:opacity-50"
          onClick={() => { if (!isDefault) set(DEFAULT_TABS, "Tab bar reset to the default."); }}>
          <RotateCcw className="size-3.5" /> Reset to default
        </Button>
      </div>
      <p role="status" className="sr-only">{said}</p>
    </Group>
  );
}

// /preview/kit: every v8 token and shared component on one page (docs/design/v8-revamp-brief.md §8, step 1), for
// review and for the Figma capture. Noindex, linked from nowhere. It draws in v8 while it's open even when this device
// hasn't turned v8 on (it sets <html data-v8> and puts the device's own look back on the way out).
import { useEffect, useLayoutEffect, useState } from "react";
import { ArrowRight, Bell, MoreHorizontal, Radio, Search, Settings, Star, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/basic";
import { Checkbox, Progress, RadioGroup, RadioGroupItem, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, ToggleGroup, ToggleGroupItem } from "../components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/overlay";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "../components/ui/sonner";
import { isV8 } from "../lib/v8";

/** v8 for as long as the kit is open (the CSS is all `v8:` and html[data-v8], so it switches live). */
function useV8WhileOpen() {
  const [was] = useState(isV8);
  useLayoutEffect(() => {
    if (was) return;
    const html = document.documentElement;
    const themes = ["light", "dim", "midnight"].filter((c) => html.classList.contains(c));
    html.setAttribute("data-v8", "");
    html.classList.remove(...themes);
    return () => { html.removeAttribute("data-v8"); html.classList.add(...themes); };
  }, [was]);
}

const SURFACES = [
  ["bg", "bg-background", "#0a0a0b"], ["surface-1", "bg-card", "#0e0e10"], ["surface-2", "bg-popover", "#141416"], ["surface-3", "bg-muted", "#1b1b1e"],
] as const;
const INKS = [
  ["text", "bg-text-base"], ["text-muted", "bg-text-muted"], ["text-faint", "bg-text-faint"], ["accent (mint)", "bg-accent"], ["live", "bg-live"], ["red alliance", "bg-red-alliance"], ["blue alliance", "bg-blue-alliance"],
] as const;
const TYPE = [
  ["Caption", "text-[0.6875rem] font-medium", "11 / 14 · 500"], ["Small", "text-xs", "12 / 16 · 400"], ["Body", "text-sm", "14 / 20 · 400"],
  ["Body strong", "text-sm font-medium", "14 / 20 · 500"], ["Title", "text-base font-semibold", "16 / 22 · 600"],
  ["Page title", "text-[1.375rem] font-semibold tracking-tight", "22 / 28 · 600"], ["18360", "font-display text-[2.25rem] font-semibold tabular-nums leading-none", "Hero number · Space Grotesk"],
] as const;

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section data-kit={id} aria-labelledby={`kit-${id}`} className="space-y-4 border-t border-line pt-8">
      <div>
        <h2 id={`kit-${id}`} className="text-base font-semibold">{title}</h2>
        {note && <p className="mt-1 max-w-[42rem] text-sm text-text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function KitPage() {
  useV8WhileOpen();
  const [chip, setChip] = useState("season");
  useEffect(() => { document.title = "Kit · Control Scout"; }, []);
  return (
    <div data-kit-page className="mx-auto max-w-[64rem] space-y-10 px-5 pb-24 pt-8 sm:px-8">
      <header>
        <h1 className="text-[1.375rem] font-semibold tracking-tight">v8 kit</h1>
        <p className="mt-1 text-sm text-text-muted">Every token and shared component in the new look. Press, open and hover things: the motion is part of the kit.</p>
      </header>

      <Section id="colour" title="Colour" note="Near-black surfaces in four steps, three greys of text, one mint accent, red only for live and the red alliance. No yellow.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SURFACES.map(([name, cls, hex]) => (
            <div key={name} className={`${cls} rounded-xl border border-line p-4`}>
              <p className="text-sm font-medium">{name}</p><p className="text-xs text-text-faint tabular-nums">{hex}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-4">
          {INKS.map(([name, cls]) => (
            <div key={name} className="flex items-center gap-2"><span className={`${cls} size-4 rounded-full`} /><span className="text-sm text-text-muted">{name}</span></div>
          ))}
        </div>
      </Section>

      <Section id="type" title="Type" note="Inter for everything; Space Grotesk only for big numbers. Sizes as drawn at the v8 root (1rem ≈ 14.4px on a laptop).">
        <div className="divide-y divide-line rounded-xl border border-line bg-card">
          {TYPE.map(([label, cls, spec]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-3">
              <span className={cls}>{label === "18360" ? label : label}</span><span className="shrink-0 text-xs text-text-faint">{spec}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="buttons" title="Buttons" note="No coloured buttons. Primary is white on a faint white fill, once per screen at most. Every one shrinks to 0.97 while pressed.">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Predict this match</Button>
          <Button variant="outline">Compare</Button>
          <Button variant="secondary">Following</Button>
          <Button variant="ghost"><Search /> Pick your team</Button>
          <Button variant="destructive"><Trash2 /> Remove</Button>
          <Button variant="link">Full rankings <ArrowRight /></Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="ghost" aria-label="Settings"><Settings /></Button>
          <Button size="icon-sm" variant="outline" aria-label="More"><MoreHorizontal /></Button>
        </div>
      </Section>

      <Section id="inputs" title="Inputs and choices">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="kit-input">Team number</Label><Input id="kit-input" placeholder="e.g. 18360" /></div>
          <div className="space-y-2">
            <Label>Season</Label>
            <Select defaultValue="2026"><SelectTrigger aria-label="Season"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="2026">2026–27 DECODE</SelectItem><SelectItem value="2025">2025–26 INTO THE DEEP</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm"><Switch defaultChecked aria-label="Live alerts" /> Live alerts</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox defaultChecked aria-label="Show ties" /> Show ties</label>
          <RadioGroup defaultValue="opr" className="flex gap-4" aria-label="Sort by">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="opr" /> OPR</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="record" /> Record</label>
          </RadioGroup>
        </div>
        <ToggleGroup type="single" variant="chips" value={chip} onValueChange={(v) => v && setChip(v)} aria-label="Range">
          <ToggleGroupItem value="season">This season</ToggleGroupItem><ToggleGroupItem value="event">This event</ToggleGroupItem><ToggleGroupItem value="all">All time</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" defaultValue="table" aria-label="View">
          <ToggleGroupItem value="table">Table</ToggleGroupItem><ToggleGroupItem value="cards">Cards</ToggleGroupItem>
        </ToggleGroup>
      </Section>

      <Section id="tabs" title="Tabs" note="Plain labels, muted to white, with a mint line under the picked one.">
        <Tabs defaultValue="matches">
          <TabsList><TabsTrigger value="matches">Matches</TabsTrigger><TabsTrigger value="events">Events</TabsTrigger><TabsTrigger value="stats">Stats</TabsTrigger><TabsTrigger value="highlights">Highlights</TabsTrigger></TabsList>
          <TabsContent value="matches" className="text-sm text-text-muted">Matches go here.</TabsContent>
          <TabsContent value="events" className="text-sm text-text-muted">Events go here.</TabsContent>
          <TabsContent value="stats" className="text-sm text-text-muted">Stats go here.</TabsContent>
          <TabsContent value="highlights" className="text-sm text-text-muted">Highlights go here.</TabsContent>
        </Tabs>
      </Section>

      <Section id="cards" title="Cards, tables, status">
        <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
          <Card>
            <CardHeader><div className="flex items-center gap-2"><span className="relative flex size-2"><span className="absolute inset-0 animate-[live-ring_2s_cubic-bezier(0.23,1,0.32,1)_infinite] rounded-full bg-live motion-reduce:hidden" /><span className="relative size-2 rounded-full bg-live" /></span><CardTitle>Events live now</CardTitle></div><span className="text-xs text-text-muted">2 live</span></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3"><Radio className="mt-0.5 size-4 text-live" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">Utica League Meet 3</p><div className="mt-2 flex items-center gap-2"><Progress value={84} className="h-1" /><span className="shrink-0 text-xs text-text-faint tabular-nums">16/19</span></div></div></div>
              <div className="flex flex-wrap gap-2"><Badge>Default</Badge><Badge variant="outline">Provisional</Badge><Badge variant="soft">Yours</Badge><Badge variant="secondary">Official</Badge></div>
            </CardContent>
          </Card>
          <Card className="p-0 sm:p-0">
            <Table>
              <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Team</TableHead><TableHead className="text-right">Record</TableHead><TableHead className="text-right">OPR</TableHead></TableRow></TableHeader>
              <TableBody>
                {[[1, "19666 · Forever Knight", "12-0-0", "170.3"], [2, "16010 · Astra Machina", "5-0-0", "158.1"], [3, "36596 · Horizon", "4-1-0", "154.6"]].map(([r, t, rec, opr]) => (
                  <TableRow key={String(r)}><TableCell className={r === 1 ? "text-accent tabular-nums" : "text-text-muted tabular-nums"}>{r}</TableCell><TableCell className="font-medium">{t}</TableCell><TableCell className="text-right tabular-nums text-text-muted">{rec}</TableCell><TableCell className="text-right font-medium tabular-nums">{opr}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card><CardHeader><CardTitle>Loading</CardTitle></CardHeader><CardContent className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-3/4" /></CardContent></Card>
          <Card className="items-center justify-center text-center">
            <Star className="size-5 text-text-faint" aria-hidden />
            <CardDescription className="text-sm">No teams followed yet.</CardDescription>
            <Button variant="ghost" size="sm"><Search /> Pick your team</Button>
          </Card>
        </div>
      </Section>

      <Section id="overlays" title="Menus, popovers, tooltips, dialogs, sheets, toasts" note="Menus and popovers grow from what opened them; dialogs from the centre; sheets slide in by their own size; a second tooltip shows at once.">
        <div className="flex flex-wrap items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline">Menu</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start"><DropdownMenuItem><Star /> Follow</DropdownMenuItem><DropdownMenuItem><Bell /> Alerts</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive"><Trash2 /> Remove</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
          <Popover><PopoverTrigger asChild><Button variant="outline">Popover</Button></PopoverTrigger><PopoverContent><p className="text-sm font-medium">OPR</p><p className="mt-1 text-xs text-text-muted">Points a team adds to its alliance, on average.</p></PopoverContent></Popover>
          {["Follow", "Compare", "Share"].map((t) => (
            <Tooltip key={t}><TooltipTrigger asChild><Button variant="ghost" size="sm">{t}</Button></TooltipTrigger><TooltipContent>{t} this team</TooltipContent></Tooltip>
          ))}
          <Dialog>
            <DialogTrigger asChild><Button variant="outline">Dialog</Button></DialogTrigger>
            <DialogContent><DialogHeader><DialogTitle>Stop scouting this event?</DialogTitle><DialogDescription>Your entries stay; you can come back any time.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost">Keep scouting</Button><Button>Stop</Button></DialogFooter></DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger asChild><Button variant="outline">Sheet</Button></SheetTrigger>
            <SheetContent side="bottom"><SheetHeader><SheetTitle>Filters</SheetTitle><SheetDescription>Sheets slide up from the bottom on a phone.</SheetDescription></SheetHeader></SheetContent>
          </Sheet>
          <Button variant="outline" onClick={() => toast("Added 4215 to your teams", { action: { label: "Undo", onClick: () => {} } })}>Toast</Button>
        </div>
      </Section>
    </div>
  );
}

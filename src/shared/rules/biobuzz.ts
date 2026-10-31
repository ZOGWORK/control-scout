// BIOBUZZ (2026–27) quick reference. Read from FIRST's public Competition Manual (web version, revision TU07,
// 2026-10-29) and the public Q&A board on 2026-10-30. Every summary is our own short paraphrase; nothing
// here is the official wording. Rules we couldn't confirm in the manual are left out, not guessed.
// When FIRST publishes a new Team Update: re-read the changed sections, update the entries and the stamp.
import type { SeasonReference } from "./types";

export const BIOBUZZ: SeasonReference = {
  season: 2026,
  game: "BIOBUZZ",
  label: "2026–27",
  manual: {
    revision: "TU07",
    date: "2026-10-29",
    url: "https://ftc-resources.firstinspires.org/ftc/game/manual",
    htmlUrl: "https://ftc-resources.firstinspires.org/ftc/game/cm-html",
  },
  qa: { url: "https://ftc-qa.firstinspires.org/", readOn: "2026-10-30" },

  sections: [
    { id: "3.3", title: "Match eligibility and inspection", part: "Eligibility" },
    { id: "10.2", title: "Drive team", part: "Game" },
    { id: "10.3", title: "Setup", part: "Game" },
    { id: "10.5", title: "Scoring", part: "Game" },
    { id: "10.6", title: "Violations, fouls and cards", part: "Game" },
    { id: "11.1", title: "Personal safety", part: "Game rules" },
    { id: "11.2", title: "Conduct", part: "Game rules" },
    { id: "11.3", title: "Pre-match", part: "Game rules" },
    { id: "11.4.1", title: "In-match: AUTO", part: "Game rules" },
    { id: "11.4.2", title: "In-match: TELEOP", part: "Game rules" },
    { id: "11.4.3", title: "In-match: scoring elements", part: "Game rules" },
    { id: "11.4.4", title: "In-match: robot", part: "Game rules" },
    { id: "11.4.5", title: "In-match: opponent interaction", part: "Game rules" },
    { id: "11.4.6", title: "In-match: humans", part: "Game rules" },
    { id: "12.1", title: "General robot design", part: "Robot" },
    { id: "12.2", title: "Fair play and damage prevention", part: "Robot" },
    { id: "12.4", title: "Robot signs", part: "Robot" },
    { id: "12.5", title: "Motors and actuators", part: "Robot" },
    { id: "12.6", title: "Power", part: "Robot" },
    { id: "12.7", title: "Control and wireless", part: "Robot" },
    { id: "12.8", title: "Pneumatics and airflow", part: "Robot" },
    { id: "12.9", title: "Operator console", part: "Robot" },
    { id: "13.2", title: "Match replays", part: "Tournament" },
    { id: "13.3", title: "Question box", part: "Tournament" },
    { id: "13.4", title: "General tournament rules", part: "Tournament" },
    { id: "13.7", title: "Playoffs", part: "Tournament" },
  ],

  rules: [
    // 3.3 — eligibility and inspection
    { id: "3.3", section: "3.3", title: "Pass inspection before qualification matches", summary: "A robot has to pass inspection before it plays qualification or playoff matches. Scheduled practice matches are allowed before inspection, but filler-line practice matches aren't.", keywords: ["inspection", "inspector", "practice"] },
    { id: "3.3.1", section: "3.3", title: "Lead Robot Inspector has the last word on construction", summary: "Students present the robot, its parts and the operator console; inspectors help fix anything that fails. The LRI decides eligibility on robot-construction questions.", keywords: ["LRI", "inspection"] },

    // 10.2 / 10.3 — drive team and setup
    { id: "10.2", section: "10.2", title: "Who can be on the drive team", summary: "Up to four people from one team: at most one drive coach, up to three student drivers, and a human player. At most one of them may be a non-student.", keywords: ["coach", "driver", "human player", "students"] },
    { id: "10.3.4", section: "10.3", title: "Pre-loads and absent robots", summary: "Each robot starts holding 4 POLLEN. A team still earns the match's points if its robot passed inspection and one student drive team member is in the alliance area, even if the robot is disabled or not there.", keywords: ["preload", "no show"] },

    // 10.5 — scoring
    { id: "10.5.1", section: "10.5", title: "HIVE TIP", penalty: "20 points, AUTO or TELEOP", summary: "A HIVE counts as tipped once it flips to its other stable side and the damper touches the frame. Launching into the upward cell is the only legal way to tip it; tips finished before TELEOP starts score as AUTO.", keywords: ["tip", "hive", "cell", "damper"] },
    { id: "10.5.1-cell", section: "10.5", title: "Elements left in an upward cell", penalty: "2 points each", summary: "POLLEN or NECTAR still sitting in an upward-facing cell when everything has come to rest at the end scores for that alliance." },
    { id: "10.5.2", section: "10.5", title: "FLOWER scoring and ownership", penalty: "2 points each in an owned FLOWER; 5-point bottom NECTAR bonus", summary: "An element scores when it's at least partly between a FLOWER's top and middle rings. The alliance with the highest NECTAR of its colour owns that FLOWER and scores every element in it; the lowest NECTAR of a colour earns its alliance the bottom bonus.", keywords: ["flower", "owner", "ownership", "nectar bonus"] },
    { id: "10.5.3", section: "10.5", title: "GARDEN scoring", penalty: "1 point each", summary: "POLLEN or NECTAR at least partly in a GARDEN scores for that GARDEN's colour, whoever put it there. GARDENs aren't protected: either alliance may take elements out.", keywords: ["garden"] },
    { id: "10.5.4", section: "10.5", title: "LEAVE and PARK", penalty: "LEAVE 3 (AUTO); PARK 5 in AUTO and 5 at the end", summary: "LEAVE: the robot is no longer touching the perimeter wall, checked at the end of AUTO. PARK: the robot is at least partly in its LOADING ZONE, checked at the end of AUTO and again at the end of the match.", keywords: ["leave", "park", "loading zone", "endgame"] },
    { id: "10.5.5", section: "10.5", title: "Ranking points", summary: "Win 3 RP, tie 1 RP, plus 1 RP each for SWARM, POLLINATOR 1 and POLLINATOR 2. At most events the thresholds are 16 points for SWARM, 4 TIPs for POLLINATOR 1 and 7 TIPs for POLLINATOR 2; Championship and regional thresholds are to be announced.", keywords: ["RP", "swarm", "pollinator", "thresholds"] },
    { id: "10.5", section: "10.5", title: "When things are scored", summary: "TIPs and FLOWERs are tracked all match; cells, GARDENs and FLOWERs get a final check once everything is at rest after the buzzer. Anything scored before the start, in the AUTO-to-TELEOP transition or after 0:00 can draw penalties. A slow or wrong live score isn't an arena fault.", keywords: ["assessment", "live score"] },

    // 10.6 — violations
    { id: "10.6-minor", section: "10.6", title: "Minor foul", penalty: "5 points to the opponent", summary: "Each minor foul adds 5 points to the other alliance's match score." },
    { id: "10.6-major", section: "10.6", title: "Major foul", penalty: "20 points to the opponent", summary: "Each major foul adds 20 points to the other alliance's match score." },
    { id: "10.6-terms", section: "10.6", title: "Momentary, continuous, repeated, strategic", summary: "Momentary is under about 3 seconds, continuous is over about 10, repeated is more than once in a match. Strategic means done to gain an advantage, including exploiting an accident; many 'if strategic' rules are only a verbal warning otherwise.", keywords: ["strategic", "momentary", "warning"] },
    { id: "10.6-disabled", section: "10.6", title: "Disabled and disqualified", summary: "Disabled: a referee stops the robot for the rest of the match. Disqualified: 0 match points and 0 RP in qualifications; in playoffs the whole alliance gets 0 match points.", keywords: ["DQ", "disable"] },
    { id: "10.6.1", section: "10.6", title: "Yellow and red cards", penalty: "Red card = disqualified from that match", summary: "The head referee gives a yellow card as a formal warning and a red card for egregious behaviour. A second yellow in the same phase of the tournament becomes a red.", keywords: ["yellow card", "red card", "YC", "RC"] },
    { id: "10.6.1-carry", section: "10.6", title: "Cards carry over", summary: "A team that has a yellow or red card carries a yellow into its later matches. Yellow cards and G301 warnings reset after practice, after qualifications and after division playoffs; other verbal warnings don't.", keywords: ["reset", "card carry"] },
    { id: "10.6.3", section: "10.6", title: "Cards in playoffs go to the alliance", summary: "In playoffs a card applies to the whole alliance. Two yellows on one alliance make a red, which disqualifies the alliance from that match.", keywords: ["playoff", "alliance card"] },

    // 11.1 / 11.2 — safety and conduct
    { id: "G101", section: "11.1", title: "Humans stay off the field", penalty: "Verbal warning", summary: "Team members may not enter the field during a match. Pointing or waving over the wall is fine." },
    { id: "G201", section: "11.2", title: "Be civil", penalty: "Verbal warning; yellow card if repeated", summary: "Treat people and equipment with respect. Seriously bad behaviour can mean removal from the event or disqualification." },
    { id: "G202", section: "11.2", title: "Competition integrity", penalty: "Verbal warning; yellow or red card if repeated", summary: "No throwing matches, asking others to throw them, taunting, or disrupting the arena.", keywords: ["sandbagging", "throw"] },
    { id: "G203", section: "11.2", title: "Show up to your matches", penalty: "Disqualified from that match", summary: "Once its robot has passed inspection, a team needs at least one drive team member at each qualification match.", keywords: ["no show", "absent"] },
    { id: "G204", section: "11.2", title: "Don't force your opponent into a foul", penalty: "Major foul per instance; major foul and yellow card per match if repeated", summary: "Deliberately making the other alliance break a rule is a violation, and the alliance that was forced isn't penalised.", keywords: ["bait", "drawing fouls"] },
    { id: "G205", section: "11.2", title: "Egregious or deliberate violations", penalty: "Yellow or red card", summary: "The head referee can card egregious conduct at any time. Breaking a rule on purpose because the gain beats the penalty counts as egregious." },

    // 11.3 — pre-match
    { id: "G301", section: "11.3", title: "Don't delay the match", penalty: "Verbal warning; major foul next match if repeated; disabled if not fixed in 2 minutes", summary: "A drive team may not significantly hold up the start of a match. Honest efforts to get ready are protected.", keywords: ["late", "delay", "timeout"] },
    { id: "G302", section: "11.3", title: "Limit what you bring to the field", penalty: "Match held until fixed; verbal warning; yellow card if repeated", summary: "Anything extra must fit in the alliance area or be worn or held, stay under 6 ft 6 in, and not block views or jam sensors." },
    { id: "G303", section: "11.3", title: "Robot ready at the start", penalty: "Held for a quick fix; disabled; red card if an uninspected robot plays", summary: "The robot must be safe, inspected, the only team item on the field, and show the right alliance-colour signs." },
    { id: "G304", section: "11.3", title: "Robot setup on the field", penalty: "Held for a quick fix; otherwise disabled or removed", summary: "Start on your own side (columns A–C red, D–F blue), touching the wall, outside the FLOWER scoring volumes and the LOADING ZONE, holding exactly 4 POLLEN, and still after INIT.", keywords: ["start position", "preload", "starting"] },
    { id: "G305", section: "11.3", title: "Pick and INIT an OpMode", penalty: "Match held; disabled if it can't initialise", summary: "Select and initialise an OpMode before the start; an AUTO OpMode needs the 30-second timer turned on.", keywords: ["opmode", "timer", "init"] },

    // 11.4.1 — AUTO
    { id: "G401", section: "11.4.1", title: "Hands off during AUTO", penalty: "Verbal warning; major foul and yellow card per match if strategic", summary: "From the start countdown until AUTO ends, the drive team may only press start on time, press stop, or act for safety.", keywords: ["autonomous"] },
    { id: "G402", section: "11.4.1", title: "No AUTO interference", penalty: "Major foul per match; major foul and yellow card if strategic", summary: "In AUTO each alliance has priority on its own side (columns A–C red, D–F blue). Controlling elements or touching a robot on the other side counts as disruption; elements that bounce across usually don't. Team Update 06 adds guidance.", keywords: ["autonomous", "interference", "far side"] },

    // 11.4.2 — TELEOP transitions
    { id: "G403", section: "11.4.2", title: "Still between AUTO and TELEOP", penalty: "Verbal warning; major foul and yellow card per match if strategic", summary: "No powered movement during the 8-second transition. Rolling or settling from momentum or gravity is fine.", keywords: ["transition"] },
    { id: "G404", section: "11.4.2", title: "Still after TELEOP ends", penalty: "Verbal warning; major foul and yellow card per match if strategic", summary: "No powered movement after the buzzer until the head referee signals.", keywords: ["end of match", "buzzer"] },

    // 11.4.3 — scoring elements
    { id: "G405", section: "11.4.3", title: "Keep scoring elements in the field", penalty: "Major foul per element", summary: "Don't deliberately send elements out of the field, directly or off a bounce. Ones that leave by accident while scoring aren't a violation.", keywords: ["out of bounds", "launch out"] },
    { id: "G406", section: "11.4.3", title: "Don't damage or mess up the arena", penalty: "Verbal warning; major foul and yellow card if strategic; disabled if ongoing", summary: "Robots and drive teams may not damage the arena or make a mess. Routinely gouging scoring elements counts too." },
    { id: "G407", section: "11.4.3", title: "Control no more than 4 at a time", penalty: "Verbal warning; major foul and yellow card per match if strategic", summary: "A robot may control at most 4 scoring elements. Briefly holding a 5th and quickly reversing it is unlikely to be strategic but is still a violation; doing it often is likely strategic.", keywords: ["possession", "control", "5 balls", "over possession", "intake"] },
    { id: "G408", section: "11.4.3", title: "Don't control the other alliance's NECTAR", penalty: "Verbal warning; yellow card per match if strategic", summary: "Any control of opponent NECTAR is a violation. Routinely picking it up is likely to be seen as strategic, even with a sorter that throws it back.", keywords: ["opponent nectar", "sorter", "color sort"] },
    { id: "G409", section: "11.4.3", title: "Don't catch from a tipped HIVE", penalty: "Verbal warning; yellow card per match if strategic", summary: "Don't catch or deflect elements falling from a tipped HIVE until they've touched something other than your robot.", keywords: ["catch", "deflect", "hive tip"] },
    { id: "G410", section: "11.4.3", title: "NECTAR into FLOWERs only in the last minute", penalty: "Major foul per NECTAR", summary: "No NECTAR into a FLOWER scoring volume until 60 seconds remain; the main field timer is the cue.", keywords: ["one minute", "60 seconds", "flower"] },
    { id: "G411", section: "11.4.3", title: "Don't hoard scoring elements", penalty: "Major foul and yellow card per match", summary: "Don't strategically keep the other alliance from reaching scoring elements: herding them into one corner or parking in front of them counts. Scoring with your own elements is fine, and a GARDEN is no safe zone.", keywords: ["blocking", "hoarding", "denying"] },

    // 11.4.4 — robot
    { id: "G412", section: "11.4.4", title: "Keep the robot under control", penalty: "Disabled and warning; disabled and yellow card if repeated", summary: "A robot must not be a hazard to people or things outside the field, like flailing over the wall or knocking over a driver station stand." },
    { id: "G413", section: "11.4.4", title: "Stop when told to", penalty: "Verbal warning; red card if strategic", summary: "When a referee disables your robot, press stop and put the controllers down." },
    { id: "G415", section: "11.4.4", title: "Don't grab the arena", penalty: "Verbal warning; yellow card per match if strategic; disabled if damage is likely", summary: "No grabbing, attaching to, entangling with or hanging from arena elements, other than scoring elements.", keywords: ["grab", "latch"] },
    { id: "G416", section: "11.4.4", title: "Size limits during the match", penalty: "Verbal warning; major foul per instance if strategic", summary: "Stay within the R105 expansion volume and don't deliberately drop parts.", keywords: ["extension", "expansion", "size"] },
    { id: "G417", section: "11.4.4", title: "Don't meddle with the HIVE", penalty: "Verbal warning; major foul and yellow card per match if strategic", summary: "Only launching into an upward-facing cell may affect a HIVE. Ramming its frame or shooting at the sides of a cell can be strategic.", keywords: ["hive", "ram"] },
    { id: "G418", section: "11.4.4", title: "Don't meddle with FLOWERs", penalty: "Verbal warning; major foul and yellow card per match if strategic", summary: "Elements go into a FLOWER only from the top, and only POLLEN may come out of the bottom.", keywords: ["flower", "remove pollen"] },

    // 11.4.5 — opponent interaction
    { id: "G419", section: "11.4.5", title: "Don't damage an opponent", penalty: "Verbal warning; major foul and yellow card per instance if strategic; major foul and red card if they can't drive", summary: "Contact is allowed; damaging or functionally impairing the other robot isn't. Normal wear to exposed wires or fragile mechanisms usually isn't counted.", keywords: ["defense", "contact", "ramming", "damage"] },
    { id: "G420", section: "11.4.5", title: "Don't tip or entangle", penalty: "Verbal warning; major foul and yellow card per instance if strategic; major foul and red card if continuous or they can't drive", summary: "No attaching to, tipping over or tangling with an opponent. A one-off accidental tip isn't strategic.", keywords: ["tip over", "entangle", "flip"] },
    { id: "G421", section: "11.4.5", title: "3-count on pins", penalty: "Major foul, plus another major foul every 3 seconds it isn't fixed", summary: "Don't pin an opponent for more than 3 seconds, against a wall or anything else. The count ends once robots stay about 2 ft apart, either robot moves 2 ft from where it started, or the pinner gets pinned.", keywords: ["pin", "pinning", "defense", "trap"] },

    // 11.4.6 — humans
    { id: "G422", section: "11.4.6", title: "Stay in your alliance area", penalty: "Verbal warning; minor foul per instance if strategic", summary: "Once the match starts, drive team members stay in their alliance area. Breaking its plane during normal play is fine, and you may grab your own NECTAR that left the field if you can reach it from there.", keywords: ["alliance area", "station"] },
    { id: "G423", section: "11.4.6", title: "Coaches: hands off the gamepads", penalty: "Verbal warning; major foul and yellow card per match if strategic", summary: "After the start, the drive coach and other teams may not handle the gamepads. The coach may hold and troubleshoot the driver station, pick OpModes, and press INIT, start or stop.", keywords: ["coach", "controller", "gamepad"] },
    { id: "G424", section: "11.4.6", title: "Coaches don't touch scoring elements", penalty: "Verbal warning; minor foul per instance if strategic", summary: "The drive coach may not touch scoring elements except for safety." },
    { id: "G425", section: "11.4.6", title: "Watch your reach", penalty: "Verbal warning; major foul and yellow card per match if strategic", summary: "After the start, drive team members may not touch, directly or through anything they hold or wear, a robot, a scoring element touching a robot or tile, or a field element, nor disturb scoring.", keywords: ["reach", "touch", "contact"] },
    { id: "G426", section: "11.4.6", title: "Don't enter NECTAR early", penalty: "Minor foul per NECTAR", summary: "Enter one extra NECTAR each time your colour's HIVE is tipped, or all the rest once 60 seconds or less remain, whichever comes first.", keywords: ["human player", "nectar entry", "one minute"] },
    { id: "G427", section: "11.4.6", title: "NECTAR goes in through the LOADING ZONE", penalty: "Minor foul per NECTAR", summary: "Your own alliance's drive team enters its NECTAR by hand, no tools, and it must touch the LOADING ZONE tile before it touches a robot or field element.", keywords: ["human player", "loading zone", "throw"] },
    { id: "G428", section: "11.4.6", title: "Don't take scoring elements off the field", penalty: "Minor foul per element", summary: "Drive team members may not remove scoring elements from the field. An element counts as on the field if it's on a tile or in or on a robot, field element or another element." },

    // 12 — robot construction
    { id: "R101", section: "12.1", title: "Your team builds your robot", summary: "The robot and its major mechanisms must be built by the team using it. Help from other teams with parts, code or strategy is fine." },
    { id: "R102", section: "12.1", title: "Start inside an 18-inch cube", summary: "At the start the robot must be completely still and fit within 18 × 18 × 18 in. Pre-loaded elements may stick out.", keywords: ["size", "sizing", "starting configuration"] },
    { id: "R104", section: "12.1", title: "No weight limit", summary: "There's no robot weight limit this season, though weight still affects tiles, batteries and handling.", keywords: ["weight"] },
    { id: "R105", section: "12.1", title: "One assembly, 18 × 24 × 29 in expanded", summary: "After the start the robot may expand, but must always fit an 18 × 24 × 29 in tall volume, be limited mechanically (not by software), and not be designed to drop parts.", keywords: ["expansion", "extension", "size"] },
    { id: "R401", section: "12.4", title: "At least two robot signs", summary: "Put signs in at least 2 places, at least 90° apart. Each at least 6.5 × 2.5 in, sturdy, and held by the robot's frame.", keywords: ["sign", "number", "flag"] },
    { id: "R402", section: "12.4", title: "Signs show your alliance colour", summary: "Each sign has a solid red or blue background matching your alliance in the schedule. Reversible signs must not show the other colour, and lighting can't be used to show the colour." },
    { id: "R403", section: "12.4", title: "Team number on the signs", summary: "Solid white numbers about 2.25 in tall with a margin around them, not stacked vertically, and not lit. The head referee may approve a stand-in if a legal sign can't be made at the event.", keywords: ["number", "font"] },
    { id: "R501", section: "12.5", title: "Only listed motors", summary: "Only the motors named in the manual's list, by part number, are allowed." },
    { id: "R503", section: "12.5", title: "8 motors and 8 servos", summary: "No more than 8 motors and 8 servos in total, across every mechanism and configuration.", keywords: ["motor count", "servo"] },
    { id: "R601", section: "12.6", title: "One main battery", summary: "Exactly one approved 12 V NiMH main battery, and it's the only power source for control and actuation.", keywords: ["battery"] },
    { id: "R603", section: "12.6", title: "One main power switch", summary: "Exactly one approved main switch cuts all battery power; it must be easy to reach and clear of pinch points.", keywords: ["switch"] },
    { id: "R701", section: "12.7", title: "One robot controller", summary: "A Control Hub, or an Android phone with a REV Expansion Hub; one extra Expansion Hub is allowed.", keywords: ["control hub", "expansion hub"] },
    { id: "R704", section: "12.7", title: "Fair use of Wi-Fi", summary: "No other wireless communication, and no continuous data streaming or video.", keywords: ["wifi", "bluetooth", "wireless"] },
    { id: "R801", section: "12.8", title: "No pneumatics", summary: "No pneumatic actuators, pressure or vacuum pumps, or high-speed air. Sealed off-the-shelf items like gas shocks are fine.", keywords: ["air", "gas spring"] },
    { id: "R903", section: "12.9", title: "Operator console size", summary: "The console may be at most 3 ft × 1 ft 6 in × 2 ft, not counting what drivers wear or hold; over 20 lb gets a closer look. BIOBUZZ has no list of allowed gamepads.", keywords: ["console", "gamepad", "controller"] },

    // 13 — tournament
    { id: "T201", section: "13.2", title: "Replays are rare", summary: "A match is replayed only for an arena fault that changed the outcome, or when it was stopped for safety. Your own robot failing is not a reason.", keywords: ["replay", "arena fault", "field fault"] },
    { id: "T301", section: "13.3", title: "Who goes to the question box", summary: "At most 2 people from a team talk to the head referee, and one must be a student, who should do as much of the talking as possible. Teams may swap who holds the question-box pass.", keywords: ["question box", "head ref", "dispute"] },
    { id: "T302", section: "13.3", title: "Ask in time", summary: "Qualification questions: before alliance selection starts (or within 5 minutes of the last match if there are no playoffs). Playoff questions: before the next round, or right after the final match. Best within 3 matches.", keywords: ["question box", "deadline", "dispute"] },
    { id: "T303", section: "13.3", title: "Keep it factual and constructive", summary: "Think it through first and bring rule numbers or Q&A answers. Standing up for your team is fine and shouldn't count against you.", keywords: ["question box", "prepare"] },
    { id: "T401", section: "13.4", title: "The head referee's call is final", summary: "Rulings are final. Referees don't review video or photos, and event directors can't overrule them.", keywords: ["video review", "final"] },
    { id: "T402", section: "13.4", title: "Only referees disable robots", summary: "Only a referee can disable a robot, and only during a match; they may first send it to a neutral spot." },
    { id: "T406", section: "13.4", title: "Minimum time between matches", summary: "At least 5 minutes between a team's qualification matches and 8 minutes in playoffs, counted from when results are posted.", keywords: ["turnaround", "break"] },
    { id: "T701", section: "13.7", title: "Alliance selection representatives", summary: "Each team sends one or two student representatives to alliance selection; a team that sends nobody can't be picked for playoffs.", keywords: ["alliance selection", "picking"] },
  ],

  rulings: [
    { n: 2, answered: "2026-10-13", rules: ["G407", "G408"], title: "Shot blockers", summary: "Blocking an opponent's shot isn't against the rules in itself. It only counts towards the holding limits if the blocker ends up controlling the element." },
    { n: 3, answered: "2026-10-10", rules: ["G407", "G408"], title: "Accidentally holding a 5th element", summary: "Controlling a 5th element is a violation with no 3-second grace. If it isn't strategic it's a verbal warning; quickly reversing it out is unlikely to be seen as strategic. Opponent NECTAR also breaks G408." },
    { n: 4, answered: "2026-10-10", rules: ["G408"], title: "Ejecting opponent NECTAR", summary: "Any control of opponent NECTAR, however brief, is a violation. Ejecting it right away without gaining anything is typically not strategic, so a warning." },
    { n: 6, answered: "2026-10-10", rules: ["G425"], title: "Placing NECTAR in the LOADING ZONE", summary: "Drop the NECTAR in: there's no exception for touching an element that's already on the tile while you enter yours." },
    { n: 7, answered: "2026-10-10", rules: ["G427"], title: "Throwing or rolling NECTAR in", summary: "Yes, you may throw or roll it in a useful direction, as long as it touches the LOADING ZONE tile first and doesn't score straight into a HIVE or FLOWER." },
    { n: 8, answered: "2026-10-13", rules: ["G419", "G420"], title: "Extending over an opponent to block", summary: "G419 doesn't ban contact, only damage or functional impairment, which isn't limited to visible marks. Contact also risks tipping or entangling under G420." },
    { n: 10, answered: "2026-10-10", rules: ["G408"], title: "Your NECTAR in the opponent's HIVE", summary: "No rule stops you launching your own NECTAR or POLLEN into the other alliance's HIVE." },
    { n: 11, answered: "2026-10-10", rules: ["G426", "G401"], title: "Entering NECTAR after an AUTO tip", summary: "Yes: each tip of your HIVE lets the drive team enter a NECTAR, in AUTO or TELEOP, while still following the human-interaction rules." },
    { n: 12, answered: "2026-10-10", rules: ["10.5.1"], title: "Adding NECTAR while a HIVE is still moving", summary: "Allowed. A tip scores when the damper meets the frame, however many elements it took, but shooting at a moving HIVE can spoil the tip." },
    { n: 14, answered: "2026-10-10", rules: ["10.5.5"], title: "Will RP types or point values change?", summary: "No new RP achievements will be added and match point values are fixed. RP thresholds, and element counts at Championship and premier events, may change." },
    { n: 16, answered: "2026-10-10", rules: ["R903"], title: "Allowed gamepads", summary: "The allowed-gamepad list was dropped this season, so any gamepad is allowed, but it must work with the Driver Station app and wireless limits still apply." },
    { n: 17, answered: "2026-10-13", rules: ["G409"], title: "Elements bouncing off a robot under a HIVE", summary: "That's a deflection and so a G409 violation; it's a verbal warning unless the referees see it as strategic." },
    { n: 21, answered: "2026-10-10", rules: ["10.5.4"], title: "LEAVE when parked against the wall", summary: "LEAVE is judged only at the end of AUTO: a robot touching a wall at that moment, even in the LOADING ZONE, doesn't earn it." },
    { n: 23, answered: "2026-10-13", rules: ["G407", "G408"], title: "Momentary control of too many elements", summary: "Neither rule has a momentary exception. A one-off brief over-hold is likely non-strategic, but a design or strategy that routinely does it is likely to be judged strategic." },
    { n: 26, answered: "2026-10-19", rules: ["R702", "R704", "R708"], title: "HuskyLens 2", summary: "Allowed only as an I2C device with a modified cable and its Wi-Fi streaming off. Don't plug it straight into a Control Hub with a standard cable: the pins are in a different order." },
    { n: 28, answered: "2026-10-19", rules: ["10.5.4"], title: "Partner pushes you off the wall", summary: "That counts for LEAVE: only the robot's state at the end of AUTO matters, however it got there, as long as no rule was broken." },
    { n: 30, answered: "2026-10-22", rules: ["G418", "10.5.2"], title: "NECTAR resting on a FLOWER's pipes", summary: "Any element inside the scoring volume scores. Holding NECTAR up against the pipes to score it that way is likely to be judged strategic." },
    { n: 31, answered: "2026-10-22", rules: ["R903"], title: "Joysticks and other controllers", summary: "Any human-interface device counts as a gamepad and is allowed; whether it works depends on Android and Driver Station support." },
    { n: 32, answered: "2026-10-22", rules: ["R403"], title: "2-inch sign numbers", summary: "About 2 in is close enough to 2.25 in, but the further from 2.25 in, the closer inspectors will look." },
    { n: 34, answered: "2026-10-22", rules: ["G407"], title: "Elements stuck under an intake", summary: "An element stuck under the robot is controlled, so it counts towards the limit of 4." },
    { n: 35, answered: "2026-10-22", rules: ["G409"], title: "Waiting near a HIVE to collect", summary: "Fine, as long as you don't catch or deflect falling elements before they've touched something else, such as the tiles." },
    { n: 36, answered: "2026-10-22", rules: ["G426"], title: "Re-entering NECTAR that left the field", summary: "It can go back in without another tip, as long as the NECTAR count on the field still fits G426. Keep held NECTAR visible to the referees." },
    { n: 38, answered: "2026-10-26", rules: ["G411"], title: "Parking in front of elements to deny them", summary: "Deliberately positioning to keep the other alliance away from elements may be judged a G411 violation." },
  ],
};

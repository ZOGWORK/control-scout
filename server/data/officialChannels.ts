// The official channels the auto-watcher reads (server/videos/officialWatch.ts, docs/official-videos.md): FIRST HQ,
// the regional FIRST partners and the events' named organisers whose videos the checked list was built from. Written
// into official_channels once each at boot; the owner adds, edits or removes them in Owner › Official videos after
// that, and a removed one is never written back. region: which events can be its (officialMatch.ts parseRule).
// words: the region's own words, too common in its titles to count. titlePattern: a title naming the region itself.
export interface OfficialChannelSeed { channelId: string; title: string; region: string; words?: string; titlePattern?: string }

export const OFFICIAL_CHANNELS: OfficialChannelSeed[] = [
  { channelId: "UCkWMXdRQr5yoZRz7gFYyRcw", title: "FIRST Tech Challenge (FIRST HQ)", region: "type=FIRSTChampionship", words: "houston", titlePattern: "houston|first championship|world championship" },
  { channelId: "UCBWrlxpmYKv4b_jE5mDsckw", title: "Nație Prin Educație (Romania)", region: "country=Romania", words: "romania", titlePattern: "romania|national" },
  { channelId: "UC0oQyo3gF7Y7WJ8Owk2FFKA", title: "NY Excelsior FIRST", region: "state=NY", words: "york", titlePattern: "excelsior" },
  { channelId: "UCKezDYNRPpAy2_1XRMBWKSw", title: "FIRST in Texas", region: "state=TX", words: "texas fit" },
  { channelId: "UCz9BQ8LbaXUi5Q4X9i0i6AA", title: "NTX FTC", region: "state=TX", words: "texas ntx fit north" },
  { channelId: "UC5XC9qn_Vn6hYDwpx1b-zSA", title: "RoboticsFun", region: "state=TX", words: "texas fit" },
  { channelId: "UCSNJ-UXlb6mGTi_e6WOCQQQ", title: "FIRST Tech Challenge Benelux", region: "country=Netherlands,Belgium,Luxembourg", words: "benelux", titlePattern: "benelux" },
  { channelId: "UCLUm2x7V8sSX_A92rEMz64g", title: "FTC European Premier Event", region: "country=Netherlands", words: "european" },
  { channelId: "UCuKBMd9RaQ78QfdgBQor3nA", title: "FIRST Chesapeake", region: "state=VA,MD,DC", words: "chesapeake chs" },
  { channelId: "UCpQ3aglvLAj6m7j2eSnhJZg", title: "FTC Iowa", region: "state=IA", words: "iowa", titlePattern: "iowa" },
  { channelId: "UCFGmQAl2O4T-NmVh4kSDMlg", title: "Hawaii FIRST Robotics", region: "state=HI", words: "hawaii", titlePattern: "hawaii" },
  { channelId: "UCz3j-0bLZOevINcN3WMINDQ", title: "Pennsylvania FIRST Tech Challenge", region: "state=PA", words: "pennsylvania", titlePattern: "pennsylvania" },
  { channelId: "UCOX40xrRQno_zXF1_iUchfw", title: "Colorado FIRST", region: "state=CO", words: "colorado", titlePattern: "colorado" },
  { channelId: "UCsGNMOCahHmM_woTxeHbwnw", title: "FIRST Tech Challenge Arizona", region: "state=AZ", words: "arizona azftc", titlePattern: "arizona|\\bAZ\\b" },
  { channelId: "UCy2Lh8b-y0r-35LlcjOPPzw", title: "FIRST Indiana Robotics", region: "state=IN", words: "indiana" },
  { channelId: "UCI8KVXvKmozpDf9-Thr2kTw", title: "FIRST Wisconsin", region: "state=WI", words: "wisconsin", titlePattern: "wisconsin" },
  { channelId: "UC4ThLv6u0OxtD_lE7ObJc9w", title: "Oregon Robotics", region: "state=OR", words: "oregon", titlePattern: "oregon" },
  { channelId: "UCDhAuyXQicQlXtyMGRMpFtg", title: "Lituanica X (Lithuania)", region: "country=Lithuania", words: "lithuania lithuanian lietuvos", titlePattern: "lithuan" },
  { channelId: "UCjqJ09AW-_NL0e1OKSSqVNA", title: "FIRST Robotics BC", region: "country=Canada;state=BC,YT", words: "british columbia", titlePattern: "british columbia|\\bBC\\b" },
  { channelId: "UCuJUknE5JjilAfNnmbvr22Q", title: "FUN Robotics Network", region: "country=USA;type=Premier,OffSeason,SuperQualifier" },
  { channelId: "UCc73R-cUSzcxswVO40rJ7Cw", title: "GEARS Youth Robotics Center", region: "state=IN;name=michiana|gears" },
  { channelId: "UCTBWD2x129o8dbd8GxuMZig", title: "Chicago Robotics Invitational", region: "state=IL;name=chicago robotics invitational" },
  { channelId: "UC19n0fKHs3DfOTy4RLo1OXw", title: "FIRST California", region: "state=CA;name=western edge", words: "california" },
  { channelId: "UCN5qzssJPqSLLBgoXG0mO2g", title: "New England FIRST", region: "state=MA,NH,ME,VT,RI,CT", words: "england" },
  { channelId: "UCsWISiGfIiL5E-i9DPK2ftQ", title: "SoCal FTC", region: "state=CA", words: "california socal" },
  { channelId: "UCto1RvN3qyamf8GH7P7_abQ", title: "Georgia FIRST", region: "state=GA", words: "georgia", titlePattern: "\\bGA\\b|georgia" },
  { channelId: "UCMkHRhdD35Jwg-rhbvspQEg", title: "FIRST in Alabama", region: "state=AL", words: "alabama", titlePattern: "alabama" },
  { channelId: "UCTaHVJzv8Hciyv6Sm8xGmiw", title: "FTC South Africa", region: "country=South Africa", words: "south african africa", titlePattern: "south africa" },
  { channelId: "UCuNd3shXL4BZsN7O7e3OPzQ", title: "Mississippi FIRST Tech Challenge", region: "state=MS", words: "mississippi", titlePattern: "mississippi" },
  { channelId: "UCMQ-I5i7wiucrll3657GK4w", title: "FTC Utah", region: "state=UT", words: "utah", titlePattern: "utah" },
  { channelId: "UCyck0fFjiYFOz1S-TYCNiQA", title: "FIRST Illinois Robotics", region: "state=IL", words: "illinois", titlePattern: "illinois" },
  { channelId: "UCHVeR960xGMtQ2rHxYAebTw", title: "High Tech Kids (Minnesota)", region: "state=MN", words: "minnesota htk", titlePattern: "minnesota" },
  { channelId: "UCbppRk83Rf7nh_Zug261h7A", title: "FIRST in Vermont", region: "state=VT", words: "vermont", titlePattern: "vermont" },
  { channelId: "UCUpv6m5YLRZgqZQlasOjKVQ", title: "FIRST UK", region: "country=United Kingdom", words: "uk" },
  // FRC 2583 (Westwood High School, Austin): the event stream of FiT-Central's GEMS league and Austin events, official
  // overlay on screen. Channel id from the YouTube Data API (forHandle @westwoodrobotics2583), 2026-11-14.
  { channelId: "UCyv6fRBcoK6mD6Br5M366yA", title: "Westwood Robotics (FiT-Central)", region: "state=TX;name=\\bCTX\\b|FiT-Central|GEMS", words: "texas fit central ctx" },
  { channelId: "UCal7624DPridi_9iKLrAbqw", title: "FIRST Australia", region: "country=Australia", words: "australia australian", titlePattern: "australian? (national )?championship|\\bAPOC\\b|asia pacific open" },
];

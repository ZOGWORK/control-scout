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
  // FIRST in Missouri (the Missouri/Kansas partner) streams the St. Louis leagues, the Southeast and Southwest leagues and
  // the championship; FIRST MOKS streams the Kansas City meets one session at a time ("8AM", "1030AM", "1PM", as
  // Scout's meet names give them). Channel ids from the YouTube Data API (forHandle), 2026-11-14.
  { channelId: "UCoo2NYUOcTUZB65dGMAp1vg", title: "FIRST in Missouri", region: "state=MO,KS", words: "missouri kansas fimo stl" },
  { channelId: "UCy_GHfjX6LsALdrIceg8_pw", title: "FIRST MOKS (Missouri/Kansas)", region: "state=MO,KS", words: "missouri kansas moks" },
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
  // The 2026-11-14 audited channels (ids from the YouTube Data API, forHandle): FIRST's delivery partners for
  // Kazakhstan, France, Italy and Türkiye, and the Prince Royal's College channel that streamed Thailand's championship
  // (its only event so far: the weakest watchlist entry, for the owner to drop if no second event comes).
  { channelId: "UCBXqD1Kn2u3mFnjHsHMMTKQ", title: "USTEM Foundation (Kazakhstan)", region: "country=Kazakhstan", words: "kazakhstan central asia", titlePattern: "central asia (first )?championship" },
  { channelId: "UCDNTYCoNjRd_98Jl1vAUZNQ", title: "Robotique FIRST France", region: "country=France", words: "france defi robotique regionale regions", titlePattern: "\\bfinale\\b" },
  { channelId: "UC3GrZQP1avoMFojc2HeQdhw", title: "Associazione Artù APS (Italy)", region: "country=Italy", words: "italy italia", titlePattern: "\\bitaly\\b" },
  { channelId: "UCq5bJjdyfAQYIs7yb_83vaA", title: "Fikret Yüksel Foundation (Türkiye)", region: "country=Türkiye", words: "turkiye turkey gun", titlePattern: "t[uü]rkiye [şs]ampiyonas[ıi]" },
  { channelId: "UC7e1UfLTHCdAoF7VIay_IqA", title: "The PRC Channel (Thailand)", region: "country=Thailand", words: "thailand ftcthailand", titlePattern: "thailand" },
  // The owner's audited channels (2026-11-14), ids from the YouTube Data API (channels?forHandle). FIRST Nevada
  // (@firstnevada1941) is Nevada's FIRST partner; its titles name the meet ("# 4S") and the half of the state.
  { channelId: "UCqDnAXt0clPQww74v7bUVkQ", title: "FIRST Nevada", region: "state=NV", words: "nevada", titlePattern: "nevada state championship|state championship - nevada" },
  // BCA Activities (@BCAActivities-sg6ef, Bismarck Career Academy): North Dakota's "Dakota FTC" events. A school
  // channel that streams other activities too, so no word of North Dakota's FTC event names or cities counts as
  // evidence (every one Scout has from 2020 on: places, halves, venues, and "scrimmage") and there's no title
  // pattern: every new video goes to the owner's review, never auto-adds. A new ND event naming a new word needs that
  // word added here.
  { channelId: "UCowF1UaXnuuFV_sNIvpX-zQ", title: "BCA Activities (Dakota FTC)", region: "state=ND", words: "north dakota dakotaftc bca bismarck minot fargo alexander comets western eastern ndsu daa adventist scrimmage" },
  // MT Robotics Alliance (@mtra-stream), Montana's FTC partner; FIRST's Montana event pages name the channel.
  { channelId: "UCpPjg0KF7cwfbWoKAl0jiXQ", title: "MT Robotics Alliance (Montana)", region: "state=MT", words: "montana mt", titlePattern: "\\bstate\\b|championship" },
  // Team 12099 (Centennial HS, Columbus): FIRST's event pages name its streams for the Central Ohio league (scrimmage,
  // meets, league tournament) in 2025 and 2026. Channel id from the YouTube Data API (forHandle @StarsoftheGalaxy12099), 2026-11-14.
  { channelId: "UC576ZA1td9ZvsAUwPq1Ymaw", title: "Stars of the Galaxy (Central Ohio)", region: "state=OH;name=^Central Ohio ", words: "ohio central columbus" },
  // FIRST Alumni Network Grand Valley: streams the West Michigan league meets at GVSU's Shape Corp. IDC, Grand Rapids
  // (GVSU Padnos's own page says so; FIRST's event pages link its Meet 1, 3 and 4 streams). Channel id from the
  // YouTube Data API (forHandle @firstalumninetworkgrandvalley), 2026-11-14. Its Robot in 3 Days streams are FRC.
  { channelId: "UCaojFS3JFPWY9kaoW6bhvvQ", title: "FIRST Alumni Network Grand Valley (West Michigan)", region: "state=MI;name=^West Michigan ", words: "michigan west grand valley rapids gvsu" },
  // The 2026-11-14 audited channels for Rhode Island, Ontario and New York (ids from the YouTube Data API, forHandle).
  // Rhode Island FTC (@riftc): FIRST's event pages name it for all three 2026-27 Rhode Island events.
  { channelId: "UCHgwJxb_Y5SRtrAGCzk73MQ", title: "Rhode Island FIRST Tech Challenge", region: "state=RI", words: "rhode island", titlePattern: "rhode island" },
  // FTC Ontario (@ftcontario): every Ontario qualifier, the Provincial Championship and the Canada Cup.
  { channelId: "UCUXJ0amrR15tPMgXvhDLJQw", title: "FTC Ontario", region: "country=Canada;state=ON", words: "ontario canada", titlePattern: "ontario provincial" },
  // FIRST Long Island (@FIRSTLongIsland), Long Island's delivery partner. Its 2026-27 events are listed as "Qualifier N".
  { channelId: "UCe22ftqf7OwtH40JBuP-anA", title: "FIRST Long Island", region: "state=NY;name=Long Island|^Qualifier [0-9]+$", words: "long island" },
  // NYC FIRST (@newyorkcityfirst), New York City's delivery partner: the same channel FIRST's 2021-22 event pages link.
  { channelId: "UCibawtHwGEggHlSiBOSPVtw", title: "NYC FIRST", region: "state=NY;name=NYC", words: "nyc york city" },
  // Town of Penfield Television (@PenfieldTV): a town channel that broadcasts NY Excelsior qualifiers with Penfield
  // Robotics. Upstate Excelsior events only; its uploads carry no broadcast date, so the watcher sends them to review.
  { channelId: "UCLctix0o61bACiWd6Oa-S5Q", title: "Town of Penfield Television (NY Excelsior)", region: "state=NY;name=Excelsior|Finger Lakes|Penfield|Corning|Peekskill|Clarkson|Albany|Buffalo|Utica|Syracuse|Ravena|Broadalbin|John Jay", words: "york excelsior penfield" },
  // The owner's audited channels (2026-11-14), ids from the YouTube Data API (channels?forHandle). Overcharged
  // (@overcharged12599, FTC 12599) streams Oregon's Rose City League; Leo RHS Robotics (@leoRHSrobotics, Roseburg HS)
  // streams the SOAR League. FIRST's own Oregon event pages link both channels' streams. Each for its league only.
  { channelId: "UCT6yIFUf6Wr_klDFpdmLsGg", title: "Overcharged (Rose City League)", region: "state=OR;name=\\bRose City\\b", words: "oregon" },
  { channelId: "UC2MP84F_QCCnbLqHBFBxxeQ", title: "Leo RHS Robotics (SOAR League)", region: "state=OR;name=\\bSOAR\\b", words: "oregon" },
  { channelId: "UCal7624DPridi_9iKLrAbqw", title: "FIRST Australia", region: "country=Australia", words: "australia australian", titlePattern: "australian? (national )?championship|\\bAPOC\\b|asia pacific open" },
];

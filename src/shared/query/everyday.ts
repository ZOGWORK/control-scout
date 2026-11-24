// Everyday English (docs/search-pipeline.md, "Spelling"): common words of four letters or more that a question says
// about anything, robots or not ("minor", "pizza", "cheap", "weather"). Search never corrects one of these into a
// word that only a team's name has ("minor" is no typo of team Milnor, "pizza" none of team PITZZA): a word typed
// right is a word, unless the query also says it means a team there ("team pizza"). A fix to one of search's own
// words is still made ("scare" may be "score"). Data only: no team, event or place is named here, and nothing is read
// from this list but whether a word is in it.

const WORDS = `
able about above absent abroad absolute absolutely accept accepted access accident account accurate across act acting
action active activity actor actual adapt added adding address adult advance advice affect afford afraid afternoon
again against agent agree agreed ahead airport alarm album alive allow allowed almost alone along aloud already
alright also always amazing amount angel anger angle angry animal animals annual answer answers anxious anybody
anymore anyone anything anyway anywhere apart apartment apple apples apply appointment approach area areas argue
argument army around arrive arrived arrow article artist ashamed aside asleep assume attack attempt attend attention
aunt author autumn avenue avoid awake award aware away awesome awful awkward baby back backyard bacon badge badly
bagel baker bakery balance ball balloon banana band bank barber barely bark barn base baseball basic basically basket
basketball bath bathroom battery battle beach beans bear beard beast beautiful beauty became because become becoming
bedroom beef been beer before began begin beginner beginning behave behind being belief believe bell belong below
belt bench bend beneath benefit berry beside besides best better between beyond bicycle bigger biggest bike bill
billion bird birds birth birthday biscuit bite bitter black blade blame blank blanket blind block blonde blood bloody
blow blue board boat body boil bold bomb bone bonus book books boost boot boots border bored boring born borrow boss
both bother bottle bottom bought bounce bound bowl boxes brain brake branch brand brave bread break breakfast breath
breathe brick bride bridge brief bright brilliant bring broad broke broken brother brought brown brush bubble bucket
budget bugs build building built bullet bunch burger burn burnt burst bury busy butter button buying cabin cable cake
calendar call calm camera camp campus canal cancel candle candy cannot canvas capital captain card cards care career
careful carefully careless carpet carrot carry cars cartoon case cash castle casual catch category cattle caught cause
ceiling celebrate cell cent center central centre century cereal certain certainly chain chair chalk challenge champ
chance change changed channel chapter character charge charity charm chart chase chat cheap cheaper cheapest cheat
check cheek cheer cheese chef cherry chess chest chew chicken chief child children chill chilly chips chocolate choice
choir choose chosen church cinema circle citizen city civil claim class classic classroom clean clear clearly clever
click client cliff climate climb clock close closed closer closet cloth clothes cloud cloudy club clue coach coast
coat code coffee coin cold collar collect college color colour column combat come comedy comfort comfortable coming
command comment common company compare complain complete completely computer concert condition confident confused
connect consider contact contain content contest context continue control convince cook cookie cookies cooking cool
copper copy corn corner correct cost costume cottage cotton couch cough could count counter country county couple
courage course court cousin cover crack craft crash crazy cream create creature credit crew crime crisp crop cross
crowd crown cruel crush crying cultural culture cupboard curious current curtain curve cushion custom customer cute
cycle daily damage dance dancer danger dangerous dare dark darling data date daughter dawn dead deadline deaf deal
dear death debate debt decade decide decision deck deep deeply deer defeat defend define degree delay delicious
deliver demand dentist deny depend depth describe desert design desk dessert detail develop device diary dictionary
diet differ difference different difficult digital dinner direct direction directly dirt dirty disagree disappear
discover discuss disease dish distance divide doctor document dollar dollars domain donkey door double doubt dough
down downstairs downtown dozen draft drag dragon drama draw drawer drawing dream dress drink drive driver driving drop
drove drown drug drum drunk duck dull during dust duty each eager early earn earth easily east eastern easy eaten
edge edit education effect effort eggs eight either elbow elder election electric electricity elephant else email
emergency emotion empty ending enemy energy engage engine enjoy enormous enough enter entire entirely entrance
envelope equal equipment error escape especially essay even evening event events ever every everybody everyone
everything everywhere evidence evil exact exactly exam example excellent except exchange excited exciting excuse
exercise exist exit expect expensive experience expert explain explore express extra extreme extremely fabric face
facility fact factory fail failed failure faint fair fairly fairy faith fake fall false fame familiar family famous
fancy fantastic farm farmer fashion fast faster fastest father fault favor favorite favour favourite fear feast
feather feature feed feel feeling feet fell fellow felt female fence festival fever field fierce fifteen fifty fight
figure file fill film final finally finance find fine finger finish fire firm first fish fishing fist five flag flame
flash flat flavor flavour flight float flood floor flour flower flowers flying focus fold folk follow food fool foolish
foot football force forest forever forget forgive fork form formal former fortune forty forward found fountain four
fourteen frame free freedom freeze fresh friday fridge fried friend friendly friends frighten frog front frozen fruit
frying fuel full fully funny furniture further future gain gallery game games garage garbage garden garlic gate gather
gave general gentle gently gentleman genuine ghost giant gift ginger girl girls give given giving glad glass glasses
global glove gloves glue goal goat going gold golden golf gone good goodbye goods gorgeous gossip govern government
grab grade gradually grain grand grandfather grandma grandmother grandpa grant grape grapes grass grateful grave
gravy gray great greedy green greet grew grey grief grill grin grind grip grocery ground group grow growth guard guess
guest guide guilty guitar habit hair haircut half hall hammer hand handle handsome hang happen happened happily happy
harbor harbour hard hardly harm harvest hate have head headache health healthy hear heard heart heat heater heaven
heavy height held hell hello helmet help helpful hence herb here hero hidden hide high highway hill hint hire history
hobby hockey hold hole holiday hollow holy home homework honest honey hood hook hope horrible horror horse hospital
host hotel hotels hour hours house household housing however huge human humor humour hundred hung hungry hunt hurry
hurt husband idea ideal ideas identify identity idiot ignore illegal illness image imagine immediately impact
important impossible improve inch include including income increase indeed indoor industry infant inform information
injury inner innocent insect inside insist instance instant instead insurance intend interest interested interesting
internet interview into introduce invent invest invite iron island issue item items jacket jail jeans jelly jewel
jewelry joke journey judge juice jump jungle junior jury just justice keen keep kettle kick kidding kids kill kind
kindly king kingdom kiss kitchen kite kitten knee knife knock know knowledge known label labor labour lack ladder lady
lake lamb lamp land language large largely laser last late lately later laugh launch laundry lawn lawyer layer lazy
lead leader leaf league lean learn learning least leather leave lecture left legal lemon lend length less lesson
letter level library license lift light lightning like likely limit line link lion lips liquid list listen literally
little live lively liver living load loan local lock lonely long look loose lord lose loss lost lots loud lounge love
lovely lover lower loyal luck lucky lunch lung machine mad madam made magazine magic mail main mainly major make male
mall manage manager manner many maple marble march mark market marriage married marry mask mass master match material
math maths matter maximum maybe meal mean meaning meant measure meat medal media medical medicine medium meet meeting
melt member memory mental mention menu mercy mere merely mess message metal method middle midnight might mild mile
miles milk mind mine minimum minor minus minute minutes mirror miss missing mistake misunderstand mixed mixture
model modern moment monday money monkey monster month months mood moon moral more morning most mostly mother motion
motor mountain mouse mouth move movement movie movies much muddy multiply murder muscle museum mushroom music musical
must mystery nail naked name narrow nasty nation national native natural nature naughty near nearby nearly neat
necessary neck need needle negative neighbor neighbour neither nephew nerve nervous network never news newspaper next
nice niece night nine nobody noise noisy none noodles noon normal normally north northern nose note nothing notice
novel number nurse nuts object obvious obviously occasion ocean offer office officer often okay older olive once
onion online only open opera opinion opposite option orange order ordinary organ organize original other otherwise
ought ounce outdoor outside oven over owner oxygen pace pack package page pain painful paint painter painting pair
palace pale palm panel panic pants paper parade pardon parent parents park parking part partly party pass passenger
passion passport password past pasta path patient pattern pause peace peaceful peach peanut pear pencil penny people
pepper perfect perfectly perform perhaps period permanent permission person personal pets phone photo photograph
phrase physical piano pick picnic picture pictures piece pigeon pile pill pillow pilot pink pint pipe pity pizza
place plain plan plane planet plant plants plastic plate play player please pleased pleasure plenty plus pocket poem
poet point poison police polite political pond pool poor popular population pork port portion position positive
possible possibly post postcard potato potatoes pound pour powder power powerful practice praise pray prefer prepare
present president press pretty prevent previous price pride priest prince princess print prison private prize
probably problem process produce product profit program project promise proof proper properly property protect proud
prove provide public pull pump pumpkin punch punish pupil puppy pure purple purpose purse push puzzle quality
quarter queen question quick quickly quiet quietly quite rabbit race radio rail railway rain rainbow raise random rare
rarely rather reach read reading ready real realize really reason receive recent recently recipe record recover
reduce refuse region relax release relief religion rely remain remember remind remote remove rent repair repeat
replace reply report request require rescue research respect rest restaurant result return rice rich ride ridiculous
right ring rise risk river road roast rock role roll roof room root rope rose rotten rough round route royal rubber
rude ruin rule ruler rumor rumour runner rural rush sadly safe safety said sail salad salary sale salmon salt same
sand sandwich sauce sausage save saying scale scared scarf scary scene school science scissors scream screen screw
search season seat second secret secretary section secure security seed seem seen seldom select sell send senior
sense sensible sentence separate serious seriously servant serve service session settle seven several severe shade
shadow shake shall shallow shame shape share shark sharp shave sheep sheet shelf shell shelter shift shine shiny ship
shirt shock shoe shoes shoot shop shopping shore short shortly shot should shoulder shout show shower shut shy sick
side sigh sight sign signal silence silent silk silly silver similar simple simply since sing singer single sink
sister site situation size skill skin skirt sleep sleepy slice slide slight slightly slim slip slow slowly small
smart smell smile smoke smooth snack snake snow soap soccer social society sock socks soft soil soldier solid solve
some somebody somehow someone something sometimes somewhere song soon sore sorry sort soul sound soup sour south
southern space spare speak speaker special speech speed spell spend spent spicy spider spill spin spirit spite split
spoil spoon sport sports spot spread spring square squeeze stadium staff stage stair stairs stamp stand standard star
stare start station stay steak steal steam steel steep step stick sticky stiff still sting stir stock stomach stone
stood stop store storm story stove straight strange stranger strawberry stream street strength stress stretch strict
strike string strong strongly student study stuff stupid style subject succeed success sudden suddenly sugar suggest
suit summer sunday sunny super supper supply support suppose sure surely surface surgery surprise surprised surround
survive suspect swallow swear sweat sweater sweep sweet swim swimming swing switch sword symbol system table tablet
tail tale talent talk tall tank tape target task taste tasty taught taxi teach teacher tear tears teeth telephone
television temple tend tender tennis tent term terrible terribly test text than thank thanks theater theatre theme
then theory there thick thief thin thing things think thirsty thirteen thirty those though thought thousand thread
threat three threw throat through throw thumb thunder thursday ticket tidy tiger tight till timber tiny tired tissue
title toast today toilet tomato tomatoes tomorrow tone tongue tonight tool tools tooth topic total touch tough tour
tourist towel tower town toys track trade traffic train training transport trash travel tray treat treatment tree
trees trend trial trick trip trouble truck true truly trust truth tuesday tune tunnel turkey turn turtle twelve
twenty twice twin type typical ugly umbrella uncle under understand unfair uniform union unique unit universe
university unless until unusual upper upset upstairs urban urgent used useful useless usual usually vacation valley
value vegetable vegetables vehicle very video view village violin visit visitor voice volume vote wage wait waiter
wake walk wall wallet wander want warm warn wash waste watch water wave weak wealth weapon wear weather wedding
wednesday weed week weekend weekly weigh weight weird welcome west western whale wheat wheel when where whether
which while whisper whistle white whole wide widely wife wild will willing wind window windy wine wing winner winter
wire wise wish witch within without witness woman women wonder wonderful wood wooden wool word words work worker
world worried worry worse worst worth would wound wrap wrist write writer writing written wrong yard yeah year yellow
yesterday young younger youth zero zone
`;

/** Every everyday word, lower case. */
export const EVERYDAY_WORDS: ReadonlySet<string> = new Set(WORDS.split(/\s+/).filter(Boolean));

/** Whether `w` (any case) is an everyday English word, or one's plain plural ("pizzas", "hotels"). */
export function everydayWord(w: string): boolean {
  const x = w.toLowerCase();
  return EVERYDAY_WORDS.has(x) || (x.length > 4 && x.endsWith("s") && EVERYDAY_WORDS.has(x.slice(0, -1)));
}

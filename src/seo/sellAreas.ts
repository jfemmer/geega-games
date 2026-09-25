// Where Geega Games buys Magic: The Gathering cards in person. One page per
// area at /sell-magic-cards/:slug (SellAreaPage), plus the St. Louis page.
//
// Rules for this file, because these pages only help rankings if they're
// genuinely useful to someone in that city (otherwise Google treats them as
// doorway pages — https://developers.google.com/search/docs/essentials/spam-policies#doorways):
//   * Only add an area the owner will actually drive to (inside MAX_DRIVE_HOURS
//     of St. Louis, in a state listed in site.ts SERVICE_STATES).
//   * Every area needs its own intro written for that place — never a copy
//     of another area's text with the city name swapped.
//   * Drive times and distances are approximate one-way figures from St.
//     Louis; keep them rounded and always shown with "about".
//   * No payout-percentage or turnaround promises (owner's content rule).

export interface SellArea {
  slug: string;
  /** Display name, e.g. "Kansas City". */
  city: string;
  /** Set when the name reads with "the" in a sentence ("in the Quad Cities"). */
  article?: "the";
  /** Postal abbreviation of the main state, e.g. "MO". */
  stateAbbr: string;
  /** Full state name for structured data. */
  state: string;
  /** e.g. "about 3½–4 hours" — always approximate. */
  driveTime: string;
  /** Rounded one-way road miles from St. Louis. */
  driveMiles: number;
  /** How the trip usually goes, e.g. "west on I-70". Omitted when routes vary. */
  route?: string;
  /** Unique, place-specific intro paragraph. */
  intro: string;
  /** Real nearby communities covered on the same trip. */
  alsoServing: string[];
  /** Slugs of 2–3 nearby areas, for "other areas we travel to" links. */
  neighbors: string[];
}

export const SELL_AREAS: SellArea[] = [
  {
    slug: "columbia-mo",
    city: "Columbia",
    stateAbbr: "MO",
    state: "Missouri",
    driveTime: "about 2 hours",
    driveMiles: 125,
    route: "west on I-70",
    intro:
      "Columbia is one of the easiest trips we make — a straight shot down I-70 with no big-city traffic on either end. Between Mizzou, Stephens and Columbia College, mid-Missouri has a lot of Magic players, and plenty of binders that end up in a closet after graduation or a move. Jefferson City and the surrounding towns are easy to cover on the same trip.",
    alsoServing: ["Jefferson City", "Fulton", "Boonville", "Moberly", "Mexico", "Ashland"],
    neighbors: ["kansas-city", "springfield-mo", "quad-cities"],
  },
  {
    slug: "kansas-city",
    city: "Kansas City",
    stateAbbr: "MO",
    state: "Missouri",
    driveTime: "about 3½–4 hours",
    driveMiles: 250,
    route: "west on I-70",
    intro:
      "Kansas City is straight across the state on I-70 and home to one of the biggest Magic communities in our range. We meet sellers on both sides of the state line — Independence, Lee's Summit and North Kansas City in Missouri, and Overland Park, Olathe and Lenexa in Kansas — and Columbia and Boonville sit right on the way if that's easier for you.",
    alsoServing: [
      "Independence",
      "Lee's Summit",
      "Blue Springs",
      "North Kansas City",
      "Overland Park, KS",
      "Olathe, KS",
      "Lenexa, KS",
      "Shawnee, KS",
      "Lawrence, KS",
    ],
    neighbors: ["columbia-mo", "springfield-mo", "des-moines"],
  },
  {
    slug: "springfield-mo",
    city: "Springfield",
    stateAbbr: "MO",
    state: "Missouri",
    driveTime: "about 3–3½ hours",
    driveMiles: 215,
    route: "southwest on I-44",
    intro:
      "Springfield is about three hours down I-44, with Rolla and Lebanon along the way, which makes the whole southwest Missouri corridor easy to cover in one trip. From Springfield we also meet sellers in Nixa, Ozark and Republic, and down toward Branson and the lakes. Joplin is roughly another hour west.",
    alsoServing: ["Rolla", "Lebanon", "Nixa", "Ozark", "Republic", "Branson", "Joplin"],
    neighbors: ["tulsa", "columbia-mo", "little-rock"],
  },
  {
    slug: "springfield-il",
    city: "Springfield",
    stateAbbr: "IL",
    state: "Illinois",
    driveTime: "about 1½–2 hours",
    driveMiles: 100,
    route: "north on I-55",
    intro:
      "Illinois' capital is under two hours up I-55 — close enough that a meetup here is a simple day trip rather than an overnight. We cover the whole central Illinois stretch between St. Louis and Springfield, including Litchfield and Carlinville along the interstate, and out to Jacksonville, Lincoln and Decatur.",
    alsoServing: ["Litchfield", "Carlinville", "Jacksonville", "Lincoln", "Decatur", "Chatham"],
    neighbors: ["peoria", "champaign-urbana", "quad-cities"],
  },
  {
    slug: "peoria",
    city: "Peoria",
    stateAbbr: "IL",
    state: "Illinois",
    driveTime: "about 2½–3 hours",
    driveMiles: 170,
    route: "north on I-55, then I-155",
    intro:
      "Peoria is about two and a half hours north: up I-55 to Lincoln, then I-155 into town. With Bradley University in Peoria and Illinois State in Normal, this part of the state has a steady mix of long-time players and students, and Bloomington–Normal sits right on I-55 if meeting there is easier.",
    alsoServing: ["East Peoria", "Pekin", "Morton", "Washington", "Peoria Heights", "Bloomington–Normal"],
    neighbors: ["springfield-il", "quad-cities", "chicago"],
  },
  {
    slug: "champaign-urbana",
    city: "Champaign–Urbana",
    stateAbbr: "IL",
    state: "Illinois",
    driveTime: "about 2½–3 hours",
    driveMiles: 180,
    route: "east on I-70, then north on I-57",
    intro:
      "Champaign–Urbana is about two and a half hours away — east on I-70 to Effingham, then north on I-57. The University of Illinois keeps the local Magic scene busy, and every semester some of those collections get sold. We also cover Mattoon and Charleston along I-57, and Danville to the east.",
    alsoServing: ["Savoy", "Rantoul", "Mahomet", "Danville", "Mattoon", "Charleston", "Effingham"],
    neighbors: ["springfield-il", "indianapolis", "chicago"],
  },
  {
    slug: "chicago",
    city: "Chicago",
    stateAbbr: "IL",
    state: "Illinois",
    driveTime: "about 4½–5 hours",
    driveMiles: 300,
    route: "north on I-55",
    intro:
      "Chicago is the biggest Magic market within our range — about four and a half hours up I-55. Because traffic can add an hour on its own, we plan Chicagoland trips around a meeting spot that's easy to reach from the interstate, and the southwest suburbs along I-55 (Joliet, Bolingbrook, Naperville) are often the simplest middle ground. We'll still come into the city or out to the north and west suburbs for the right collection.",
    alsoServing: [
      "Joliet",
      "Bolingbrook",
      "Naperville",
      "Aurora",
      "Plainfield",
      "Orland Park",
      "Schaumburg",
      "Evanston",
    ],
    neighbors: ["peoria", "champaign-urbana", "indianapolis"],
  },
  {
    slug: "indianapolis",
    city: "Indianapolis",
    stateAbbr: "IN",
    state: "Indiana",
    driveTime: "about 3½–4 hours",
    driveMiles: 245,
    route: "east on I-70",
    intro:
      "Indianapolis is a straight run east on I-70, passing Effingham and Terre Haute on the way — both easy places to meet if you're west of the city. Around Indy we meet sellers from Carmel and Fishers down to Greenwood, and Bloomington (home of Indiana University) is also within range.",
    alsoServing: ["Terre Haute", "Carmel", "Fishers", "Noblesville", "Greenwood", "Plainfield", "Avon", "Bloomington"],
    neighbors: ["champaign-urbana", "louisville", "evansville"],
  },
  {
    slug: "evansville",
    city: "Evansville",
    stateAbbr: "IN",
    state: "Indiana",
    driveTime: "about 2½–3 hours",
    driveMiles: 170,
    route: "east on I-64",
    intro:
      "Evansville is about two and a half hours east on I-64, passing Mount Vernon, Illinois on the way. The tri-state area is all in range on the same trip — Newburgh on the Indiana side, and Henderson and Owensboro across the river in Kentucky.",
    alsoServing: ["Newburgh", "Mount Vernon, IL", "Henderson, KY", "Owensboro, KY", "Princeton", "Vincennes"],
    neighbors: ["louisville", "nashville", "indianapolis"],
  },
  {
    slug: "louisville",
    city: "Louisville",
    stateAbbr: "KY",
    state: "Kentucky",
    driveTime: "about 4 hours",
    driveMiles: 265,
    route: "east on I-64",
    intro:
      "Louisville is about four hours east on I-64, straight across southern Illinois and Indiana. We cover the metro on both sides of the Ohio River — Jeffersonville, New Albany and Clarksville on the Indiana side — and down to Elizabethtown. Lexington is roughly another hour east.",
    alsoServing: [
      "Jeffersonville, IN",
      "New Albany, IN",
      "Clarksville, IN",
      "Shepherdsville",
      "Shelbyville",
      "Elizabethtown",
      "Lexington",
    ],
    neighbors: ["evansville", "indianapolis", "nashville"],
  },
  {
    slug: "nashville",
    city: "Nashville",
    stateAbbr: "TN",
    state: "Tennessee",
    driveTime: "about 4½ hours",
    driveMiles: 310,
    route: "I-64 east, I-57 south, then I-24 through Paducah",
    intro:
      "Nashville is about four and a half hours away, and the route runs through Paducah, Kentucky and Clarksville, Tennessee on I-24 — so sellers along that corridor are on the way, too. Around Nashville we meet sellers in Franklin, Brentwood, Murfreesboro, Hendersonville and Mt. Juliet.",
    alsoServing: [
      "Franklin",
      "Brentwood",
      "Murfreesboro",
      "Hendersonville",
      "Mt. Juliet",
      "Clarksville, TN",
      "Paducah, KY",
    ],
    neighbors: ["evansville", "memphis", "louisville"],
  },
  {
    slug: "memphis",
    city: "Memphis",
    stateAbbr: "TN",
    state: "Tennessee",
    driveTime: "about 4–4½ hours",
    driveMiles: 285,
    route: "south on I-55",
    intro:
      "Memphis is about four hours straight down I-55, through Cape Girardeau and Sikeston and across the Missouri Bootheel into Arkansas. We meet sellers across the Mid-South — Germantown, Bartlett and Collierville in Tennessee, Southaven and Olive Branch in Mississippi, and West Memphis and Jonesboro in Arkansas.",
    alsoServing: [
      "Germantown",
      "Bartlett",
      "Collierville",
      "Southaven, MS",
      "Olive Branch, MS",
      "West Memphis, AR",
      "Jonesboro, AR",
      "Cape Girardeau, MO",
    ],
    neighbors: ["little-rock", "nashville", "evansville"],
  },
  {
    slug: "little-rock",
    city: "Little Rock",
    stateAbbr: "AR",
    state: "Arkansas",
    driveTime: "about 5–5½ hours",
    driveMiles: 350,
    route: "south on US-67 through Poplar Bluff and Searcy",
    intro:
      "Little Rock is near the edge of our range — about five hours south on US-67, through Poplar Bluff and Searcy. Because it's a full day of driving, we'll usually talk through the collection with you first (a few photos go a long way) so the trip is planned properly. Central Arkansas is covered on the same trip: North Little Rock, Conway, Benton, Bryant and Cabot.",
    alsoServing: ["North Little Rock", "Conway", "Benton", "Bryant", "Sherwood", "Cabot", "Searcy"],
    neighbors: ["memphis", "springfield-mo", "tulsa"],
  },
  {
    slug: "tulsa",
    city: "Tulsa",
    stateAbbr: "OK",
    state: "Oklahoma",
    driveTime: "about 5½–6 hours",
    driveMiles: 395,
    route: "southwest on I-44",
    intro:
      "Tulsa is the far southwestern edge of where we'll drive — about five and a half to six hours on I-44, with Rolla, Springfield and Joplin along the way. For a trip this long we'll plan the day with you in advance, and anywhere along I-44 is fair game as a meeting point. Around Tulsa we cover Broken Arrow, Owasso, Jenks and Bixby.",
    alsoServing: ["Broken Arrow", "Owasso", "Jenks", "Bixby", "Sand Springs", "Claremore", "Joplin, MO"],
    neighbors: ["springfield-mo", "little-rock", "kansas-city"],
  },
  {
    slug: "des-moines",
    city: "Des Moines",
    stateAbbr: "IA",
    state: "Iowa",
    driveTime: "about 5–5½ hours",
    driveMiles: 345,
    intro:
      "Des Moines is about five hours north and one of the longer trips we make, so we'll get a sense of the collection with you first and plan a day that works. We cover the metro — West Des Moines, Ankeny, Urbandale, Johnston and Waukee — and Ames, home of Iowa State, is about half an hour further north.",
    alsoServing: ["West Des Moines", "Ankeny", "Urbandale", "Johnston", "Waukee", "Altoona", "Ames"],
    neighbors: ["quad-cities", "kansas-city", "columbia-mo"],
  },
  {
    slug: "quad-cities",
    city: "Quad Cities",
    article: "the",
    stateAbbr: "IA",
    state: "Iowa",
    driveTime: "about 4 hours",
    driveMiles: 250,
    route: "north on US-61 along the Mississippi",
    intro:
      "The Quad Cities are about four hours north, following the Mississippi on US-61 through Hannibal and Burlington — so river towns along the way are easy stops. We meet sellers on both sides of the river: Davenport and Bettendorf in Iowa, and Moline, Rock Island and East Moline in Illinois. Iowa City is about another hour west.",
    alsoServing: [
      "Davenport, IA",
      "Bettendorf, IA",
      "Moline, IL",
      "Rock Island, IL",
      "East Moline, IL",
      "Burlington, IA",
      "Hannibal, MO",
      "Iowa City, IA",
    ],
    neighbors: ["peoria", "des-moines", "springfield-il"],
  },
];

export function findSellArea(slug: string): SellArea | undefined {
  return SELL_AREAS.find((a) => a.slug === slug);
}

/** "Kansas City, MO" — Quad Cities spans two states, so it's just the name. */
export function areaLabel(area: SellArea): string {
  return area.slug === "quad-cities" ? area.city : `${area.city}, ${area.stateAbbr}`;
}

/** For use inside a sentence: "Kansas City", "the Quad Cities". */
export function areaInSentence(area: SellArea, name: string = area.city): string {
  return area.article ? `${area.article} ${name}` : name;
}

/** Just the city, unless two areas share it: "Springfield (MO)". For use inside sentences. */
export function shortAreaName(area: SellArea): string {
  const shared = SELL_AREAS.filter((a) => a.city === area.city).length > 1;
  return areaInSentence(area, shared ? `${area.city} (${area.stateAbbr})` : area.city);
}

export function sellAreaPath(slug: string): string {
  return `/sell-magic-cards/${slug}`;
}

/** The /sell form, preselecting how the seller wants to hand the cards over (see SellPage). */
export function sellFormPath(handoff?: "local" | "ship"): string {
  return handoff ? `/sell?handoff=${handoff}` : "/sell";
}

/** The St. Louis page is its own route, not one of SELL_AREAS. */
export const ST_LOUIS_PATH = "/sell-magic-cards/st-louis";

// St. Louis metro communities we meet in (all real places inside the metro).
export const ST_LOUIS_METRO = {
  missouri: [
    "St. Louis City",
    "Clayton",
    "Kirkwood",
    "Webster Groves",
    "Chesterfield",
    "Ballwin",
    "Florissant",
    "Maryland Heights",
    "Creve Coeur",
    "University City",
    "Maplewood",
    "Affton",
    "Oakville",
    "St. Charles",
    "St. Peters",
    "O'Fallon",
    "Wentzville",
    "Lake Saint Louis",
    "Arnold",
    "Festus",
    "Washington",
  ],
  illinois: [
    "Belleville",
    "O'Fallon",
    "Edwardsville",
    "Collinsville",
    "Glen Carbon",
    "Granite City",
    "Alton",
    "Swansea",
  ],
};

// Towns roughly two hours or less from St. Louis — easy day trips that don't
// have their own page.
export const ST_LOUIS_DAY_TRIPS = {
  missouri: ["Jefferson City", "Rolla", "Farmington", "Cape Girardeau", "Hannibal"],
  illinois: ["Quincy", "Carbondale", "Mount Vernon", "Effingham"],
};

/** "a, b and c" */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Blissful TV — content + nav data.
 * Swap the gradient placeholders for real artwork by adding an `img` field
 * to each item and rendering <Image source={{uri:item.img}}/> in <PosterArt>.
 */

export const ROWS = [
  {
    title: "Continue Watching",
    items: [
      { title: "Weapons", year: 2025, kind: "Movie", rating: "7.4", runtime: "2h 8m",
        genres: ["Horror", "Mystery"], hue: 222, hue2: 250, progress: 0.34,
        blurb: "When every child in a town vanishes on the same night at the same time, a community unravels searching for answers." },
      { title: "Daredevil: Born Again", year: 2025, kind: "Series", rating: "8.6", runtime: "S1 · E5",
        genres: ["Action", "Crime"], hue: 2, hue2: 350, progress: 0.18,
        blurb: "Matt Murdock balances life as a blind lawyer with his crusade as a masked vigilante on the streets of Hell's Kitchen." },
      { title: "From", year: 2025, kind: "Series", rating: "7.8", runtime: "S3 · E2",
        genres: ["Horror", "Sci-Fi"], hue: 38, hue2: 22, progress: 0.9,
        blurb: "Trapped in a town that holds them captive, strangers fight to stay alive and uncover a way out of a waking nightmare." },
      { title: "The Shawshank Redemption", year: 1994, kind: "Movie", rating: "9.3", runtime: "2h 22m",
        genres: ["Drama"], hue: 30, hue2: 16, progress: 0.42,
        blurb: "Over decades behind bars, a wrongly convicted banker forges an unlikely friendship and an even more unlikely hope." },
      { title: "Legends", year: 2025, kind: "Series", rating: "7.9", runtime: "S1 · E1",
        genres: ["Drama", "History"], hue: 150, hue2: 120, progress: 0.08,
        blurb: "A sweeping chronicle of the people whose quiet choices bent the course of a century." },
    ],
  },
  {
    title: "Popular Movies",
    items: [
      { title: "The Mandalorian and Grogu", year: 2026, kind: "Movie", rating: "6.8", runtime: "2h 12m",
        genres: ["Action", "Adventure", "Family"], hue: 28, hue2: 44,
        blurb: "Once a lone bounty hunter, Mandalorian Din Djarin and his apprentice Grogu embark on a new adventure across the Outer Rim." },
      { title: "Project Hail Mary", year: 2026, kind: "Movie", rating: "8.3", runtime: "2h 25m",
        genres: ["Sci-Fi", "Thriller"], hue: 210, hue2: 188,
        blurb: "A lone astronaut wakes with no memory at the edge of the solar system — and the survival of Earth resting on him." },
      { title: "Masters of the Universe", year: 2026, kind: "Movie", rating: "7.4", runtime: "2h 6m",
        genres: ["Fantasy", "Action"], hue: 268, hue2: 300,
        blurb: "Prince Adam discovers the power of Grayskull and becomes He-Man to defend Eternia from the sorcery of Skeletor." },
      { title: "Pressure", year: 2026, kind: "Movie", rating: "7.7", runtime: "1h 58m",
        genres: ["Drama", "History", "War"], hue: 14, hue2: 30,
        blurb: "The untold true story of the meteorologist whose forecast decided the fate of the D-Day landings." },
      { title: "Apex", year: 2025, kind: "Movie", rating: "6.1", runtime: "1h 49m",
        genres: ["Thriller"], hue: 120, hue2: 96,
        blurb: "A hunting trip in the deep wilderness turns when the hunters realize something far more dangerous is tracking them." },
    ],
  },
  {
    title: "Popular Series",
    items: [
      { title: "Spider-Noir", year: 2025, kind: "Series", rating: "8.7", runtime: "S1 · E8",
        genres: ["Crime", "Drama"], hue: 230, hue2: 260,
        blurb: "In a shadowy 1930s underworld, a hard-boiled detective with extraordinary abilities hunts the city's darkest secrets." },
      { title: "Cape Fear", year: 2025, kind: "Series", rating: "5.3", runtime: "S1 · E3",
        genres: ["Thriller"], hue: 8, hue2: 350,
        blurb: "A family's idyllic life curdles into dread when a figure from the past returns with a meticulous plan for revenge." },
      { title: "The Boroughs", year: 2025, kind: "Series", rating: "7.2", runtime: "S1 · E6",
        genres: ["Mystery", "Sci-Fi"], hue: 205, hue2: 230,
        blurb: "A group of retirees in a quiet desert town confront an ancient force stirring beneath their cul-de-sac." },
      { title: "Widow's Bay", year: 2025, kind: "Series", rating: "8.3", runtime: "S2 · E1",
        genres: ["Drama", "Mystery"], hue: 190, hue2: 205,
        blurb: "On a remote island, a tight-knit community closes ranks when an outsider starts asking the wrong questions." },
      { title: "Dutton Ranch", year: 2025, kind: "Series", rating: "9.3", runtime: "S5 · E4",
        genres: ["Drama", "Western"], hue: 18, hue2: 4,
        blurb: "A dynasty fights to hold the largest ranch in the country against developers, rivals, and its own fractures." },
    ],
  },
  {
    title: "Trending Now",
    items: [
      { title: "Remarkably Bright Creatures", year: 2025, kind: "Movie", rating: "7.8", runtime: "1h 52m",
        genres: ["Drama"], hue: 168, hue2: 140,
        blurb: "A grieving widow and a remarkably perceptive octopus form an unlikely bond that unravels a decades-old mystery." },
      { title: "Mortal Kombat II", year: 2025, kind: "Movie", rating: "6.7", runtime: "2h 1m",
        genres: ["Action", "Fantasy"], hue: 6, hue2: 32,
        blurb: "Earth's champions are drawn back into a brutal tournament where the fate of entire realms hangs on every battle." },
      { title: "Euphoria", year: 2025, kind: "Series", rating: "8.2", runtime: "S3 · E1",
        genres: ["Drama"], hue: 320, hue2: 280,
        blurb: "A group of high-school students navigate love and friendship in a world of drugs, social media, and identity." },
      { title: "Off Campus", year: 2025, kind: "Series", rating: "8.2", runtime: "S1 · E10",
        genres: ["Comedy", "Romance"], hue: 198, hue2: 220,
        blurb: "Four roommates and a tangle of crushes turn a college hockey season into the messiest year of their lives." },
      { title: "Paw Patrol: Winter", year: 2025, kind: "Movie", rating: "5.2", runtime: "1h 24m",
        genres: ["Family", "Animation"], hue: 200, hue2: 165,
        blurb: "When a snowstorm threatens Adventure Bay, the pups suit up for their biggest cold-weather rescue yet." },
    ],
  },
];


export const FRIENDS = [
  { id: 'fr-paco', name: 'paco', seen: 'last seen 4 hr ago' },
  { id: 'fr-keca', name: 'Keca', seen: 'last seen yesterday' },
  { id: 'fr-kura', name: 'kura mi', seen: 'last seen 1 wk ago' },
  { id: 'fr-test', name: 'test', seen: 'last seen 2 wk ago' },
  { id: 'fr-kris', name: 'kris', seen: 'last seen 2 hr ago' },
  { id: 'fr-milos', name: 'milos', seen: 'watching now' },
];

export const REQUESTS = [
  { id: 'fr-req-test3', name: 'test3', msg: 'wants to be friends' },
];

export const NAV = [
  { id: 'nav-search', label: 'Search', icon: 'search' },
  { id: 'nav-home', label: 'Home', icon: 'home' },
  { id: 'nav-discover', label: 'Discover', icon: 'discover' },
  { id: 'nav-library', label: 'Library', icon: 'library' },
  { id: 'nav-addons', label: 'Addons', icon: 'addons' },
  { id: 'nav-party', label: 'Join Party', icon: 'party' },
  { id: 'nav-settings', label: 'Settings', icon: 'settings' },
];

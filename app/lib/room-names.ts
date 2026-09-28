const ADJECTIVES = [
  "brave",
  "bright",
  "calm",
  "clever",
  "cool",
  "cosy",
  "crisp",
  "curious",
  "eager",
  "fancy",
  "fast",
  "gentle",
  "golden",
  "happy",
  "jolly",
  "kind",
  "lively",
  "lucky",
  "mellow",
  "merry",
  "mighty",
  "neat",
  "nimble",
  "polite",
  "proud",
  "quick",
  "quiet",
  "rapid",
  "shiny",
  "silly",
  "smart",
  "snappy",
  "sunny",
  "swift",
  "tidy",
  "witty",
];

const NOUNS = [
  "badger",
  "beaver",
  "bison",
  "camel",
  "cat",
  "cheetah",
  "dolphin",
  "duck",
  "eagle",
  "falcon",
  "fox",
  "frog",
  "gecko",
  "goat",
  "heron",
  "koala",
  "lemur",
  "lion",
  "llama",
  "lobster",
  "moose",
  "otter",
  "owl",
  "panda",
  "parrot",
  "penguin",
  "puffin",
  "rabbit",
  "seal",
  "sloth",
  "squid",
  "swan",
  "tiger",
  "turtle",
  "walrus",
  "whale",
  "wolf",
  "zebra",
];

/** Letters and digits that can't be mistaken for each other when read aloud or typed. */
const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomIndex(length: number): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! % length;
}

function pick<T>(items: readonly T[]): T {
  return items[randomIndex(items.length)] as T;
}

/**
 * A friendly call name such as "happy-panda-7k3q". The random suffix makes
 * names practically impossible to guess (about a billion combinations), so
 * strangers can't wander into a call.
 */
export function randomRoomName(): string {
  const suffix = Array.from({ length: 4 }, () => pick([...SUFFIX_ALPHABET])).join("");
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${suffix}`;
}

// 10 questions: fun first, educational second. answerIndex is server-only —
// never ship this file (or its contents) to the client.
export const QUESTIONS = [
  {
    id: "q1",
    q: "Before co-founding Stellar, Jed McCaleb built a Magic: The Gathering card-trading site that he later converted into... which infamous bitcoin exchange?",
    choices: ["BitConnect", "Mt. Gox", "QuadrigaCX", "FTX"],
    answerIndex: 1,
    funFact:
      "Mt. Gox literally stands for 'Magic: The Gathering Online eXchange.' Jed sold it in 2011 — well before things went sideways.",
  },
  {
    id: "q2",
    q: "The smallest unit of a lumen (0.0000001 XLM) is called a...",
    choices: ["Stellarino", "Photon", "Stroop", "Lumenette"],
    answerIndex: 2,
    funFact: "Yes, a stroop — widely beloved as a nod to the stroopwafel. Delicious AND divisible.",
  },
  {
    id: "q3",
    q: "In November 2019, SDF did something dramatic with 55 billion XLM. What was it?",
    choices: [
      "Burned them forever",
      "Airdropped them to Fortnite players",
      "Traded them for Dogecoin",
      "Locked them in a vault under HQ",
    ],
    answerIndex: 0,
    funFact:
      "SDF burned over half the total XLM supply in one announcement at Meridian 2019 — one of the largest token burns ever.",
  },
  {
    id: "q4",
    q: "Stellar's consensus protocol was authored by Stanford professor David Mazières, reportedly in part on a whiteboard. What's it called?",
    choices: [
      "Proof of Stellar Work",
      "The Stellar Consensus Protocol (SCP)",
      "Nakamoto-2",
      "Byzantine Star Agreement",
    ],
    answerIndex: 1,
    funFact:
      "SCP uses federated Byzantine agreement — no mining, no staking, just nodes choosing whom to trust. The whitepaper dropped in 2015.",
  },
  {
    id: "q5",
    q: "Stellar's smart contract platform is named after a Japanese calculating tool. Which one?",
    choices: ["Soroban (an abacus)", "Katana (a sword)", "Origami (paper folding)", "Sudoku (a puzzle)"],
    answerIndex: 0,
    funFact: "Soroban — the Japanese abacus — went live on mainnet in early 2023 with Protocol 20.",
  },
  {
    id: "q6",
    q: "Which payments company loaned SDF $3 million to get started in 2014 — and got repaid in lumens?",
    choices: ["PayPal", "Square", "Stripe", "Venmo"],
    answerIndex: 2,
    funFact: "Stripe's seed loan was repaid with 2% of the initial lumen supply. Not a bad trade.",
  },
  {
    id: "q7",
    q: "Roughly how long does the Stellar network take to close a ledger (confirm transactions)?",
    choices: ["~10 minutes", "~1 hour", "~5 seconds", "It depends on the moon phase"],
    answerIndex: 2,
    funFact: "About 5 seconds — which is why your trivia winnings arrive before you finish celebrating.",
  },
  {
    id: "q8",
    q: "Stellar's annual flagship conference — and the namesake of the Meridian Pay wallet you're using right now — is called...",
    choices: ["Equator", "Meridian", "Perihelion", "StellarCon"],
    answerIndex: 1,
    funFact: "Meridian has hopped the globe since 2019 — Mexico City, Cape Town, Rome, Madrid, London...",
  },
  {
    id: "q9",
    q: "Which money-transfer giant teamed up with Stellar so people can move between cash and digital dollars at retail locations worldwide?",
    choices: ["Western Union", "MoneyGram", "Wise", "The Postal Service"],
    answerIndex: 1,
    funFact:
      "MoneyGram Ramps lets users cash USDC in and out on Stellar at hundreds of thousands of locations.",
  },
  {
    id: "q10",
    q: "When the Stellar network launched in 2014, how many lumens existed at genesis?",
    choices: ["21 million", "100 billion", "1 trillion", "Exactly 42"],
    answerIndex: 1,
    funFact:
      "100 billion XLM at genesis. After the 2019 burn, supply now sits around 50 billion — and no new lumens are created.",
  },
];

export function publicQuestion(q, index, total) {
  return { id: q.id, number: index + 1, total, q: q.q, choices: q.choices };
}

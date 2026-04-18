const STOPWORDS = new Set([
  "a","an","the","and","or","but","of","for","to","in","on","at","by","with",
  "is","are","was","were","be","been","being","that","this","these","those",
  "i","me","my","mine","you","your","we","our","us","they","them","their",
  "build","make","create","need","want","please","help","like","just","really",
  "should","would","could","can","will","do","does","did","get","got","gets",
  "agent","ai","bot","assistant","platform","dashboard","app","application",
  "tool","system","that","which","who","whom","when","where","how","why","what",
  "from","into","over","under","about","as","it","its","so","also","than","then",
  "all","any","every","each","some","one","two","more","most","very","much","many",
  "new","old","good","bad","best","top","using","use","uses","based",
]);

export interface PromptEntities {
  domain: string;
  domainPlural: string;
  verbs: string[];
  itemNames: string[];
  metricLabels: string[];
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

function pluralize(word: string): string {
  if (!word) return word;
  if (/s$/i.test(word)) return word;
  if (/(x|z|ch|sh)$/i.test(word)) return word + "es";
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  return word + "s";
}

export function pastTense(verb: string): string {
  if (!verb) return verb;
  if (/e$/i.test(verb)) return verb + "d";
  if (/[^aeiou]y$/i.test(verb)) return verb.slice(0, -1) + "ied";
  return verb + "ed";
}

export function extractEntities(prompt: string): PromptEntities {
  const cleaned = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(" ").filter(Boolean);
  const meaningful = tokens.filter((t) => t.length > 2 && !STOPWORDS.has(t));

  const verbCandidates = ["monitor","track","manage","handle","alert","notify","summarize","review","fetch","sync","analyze","draft","schedule","approve","triage","prioritize","follow","escalate"];
  const verbs = Array.from(new Set(meaningful.filter((t) => verbCandidates.includes(t))));

  const nouns = meaningful.filter((t) => !verbCandidates.includes(t));
  const domain = nouns[0] || meaningful[0] || "items";
  const domainPlural = pluralize(domain);

  const seen = new Set<string>();
  const itemPool: string[] = [];
  for (const n of nouns) {
    const cap = titleCase(n);
    if (!seen.has(cap)) {
      seen.add(cap);
      itemPool.push(cap);
    }
  }
  while (itemPool.length < 4) {
    itemPool.push(`${titleCase(domain)} item ${itemPool.length + 1}`);
  }

  const itemNames = itemPool.slice(0, 4);
  const metricLabels = [
    `Total ${pluralize(titleCase(domain))}`,
    verbs[0] ? `${titleCase(verbs[0])}d today` : "Processed today",
    "Pending review",
  ];

  return { domain, domainPlural, verbs, itemNames, metricLabels };
}

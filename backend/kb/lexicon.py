"""
Static lexicons for the heuristic extractor: predicate surface forms, role phrases,
type keywords and common words that are capitalised in headings but are not entities.
"""

# canonical predicate → active-voice surface forms (subject does it to object)
ACTIVE_PREDICATES = {
    "founded": ["co-founded", "cofounded", "founded", "established", "set up"],
    "acquired": ["acquired", "acquires", "bought", "buys", "purchased", "took over"],
    "merged with": ["merged with", "merges with"],
    "partnered with": ["partnered with", "partners with", "teamed up with", "signed a partnership with",
                       "formed a partnership with", "entered a partnership with", "allied with"],
    "collaborates with": ["collaborates with", "collaborated with", "works closely with", "worked closely with",
                          "cooperates with", "cooperated with", "works with", "worked with"],
    "leads": ["leads", "led", "heads", "headed", "directs", "directed", "runs", "ran", "chairs", "chaired",
              "manages", "managed", "oversees", "oversaw", "coordinates", "coordinated"],
    "administers": ["administers", "administered"],
    "worked at": ["works at", "worked at", "works for", "worked for", "is employed by", "was employed by",
                  "served at", "previously worked at", "formerly worked at"],
    "joined": ["joined", "joins", "rejoined"],
    "studied at": ["studied at", "graduated from", "trained at", "earned a phd from", "earned a doctorate from",
                   "received a phd from"],
    "funds": ["funds", "funded", "financed", "finances", "sponsors", "sponsored", "invested in", "invests in",
              "provides funding to", "provided funding to", "provides grants to", "backs", "backed",
              "bankrolled", "subsidizes", "subsidises", "subsidized", "subsidised"],
    "develops": ["develops", "developed", "designs", "designed", "builds", "built", "engineers", "engineered",
                 "invented", "invents", "pioneered", "pioneers", "prototyped"],
    "created": ["created", "creates", "introduced", "introduces"],
    "produces": ["produces", "produced", "manufactures", "manufactured", "makes", "generates", "generated"],
    "supplies": ["supplies", "supplied", "delivers", "delivered", "sells", "sold", "ships", "shipped"],
    "provides": ["provides", "provided", "offers", "offered"],
    "uses": ["uses", "used", "deploys", "deployed", "adopted", "adopts", "relies on", "relied on", "depends on",
             "depended on", "installed", "installs", "integrates", "integrated", "licensed", "licenses"],
    "operates": ["operates", "operated", "owns", "owned", "maintains", "maintained", "controls", "controlled"],
    "located in": ["is based in", "is headquartered in", "is located in", "was based in", "based in",
                   "headquartered in", "located in"],
    "part of": ["is part of", "is a subsidiary of", "is a division of", "is a unit of", "belongs to",
                "is a member of", "is affiliated with", "was part of"],
    "regulates": ["regulates", "regulated", "audits", "audited", "certifies", "certified", "approves", "approved"],
    "studies": ["studies", "studied", "researches", "researched", "investigates", "investigated", "analyzes",
                "analyzed", "analyses", "analysed", "examines", "examined", "monitors", "monitored", "measures",
                "measured", "tracks", "tracked", "surveyed", "surveys"],
    "published": ["published", "publishes", "authored", "co-authored", "wrote", "released", "issued"],
    "causes": ["causes", "caused", "triggers", "triggered", "leads to", "led to", "results in", "resulted in",
               "drives", "drove"],
    "contributes to": ["contributes to", "contributed to"],
    "reduces": ["reduces", "reduced", "lowers", "lowered", "decreases", "decreased", "mitigates", "mitigated",
                "prevents", "prevented", "eliminates", "eliminated", "avoids", "avoided"],
    "increases": ["increases", "increased", "raises", "raised", "boosts", "boosted", "improves", "improved",
                  "enhances", "enhanced", "accelerates", "accelerated", "worsens", "worsened", "exacerbates",
                  "exacerbated"],
    "linked to": ["is linked to", "was linked to", "are linked to", "were linked to", "is associated with",
                  "was associated with", "are associated with", "were associated with", "correlates with",
                  "correlated with", "is related to", "are related to"],
    "treats": ["treats", "treated", "cures", "cured"],
    "replaced": ["replaced", "replaces", "superseded", "supersedes"],
    "closed": ["closed", "shut down", "decommissioned", "phased out"],
    "enacted": ["passed", "enacted", "signed into law"],
    "requires": ["requires", "required", "mandates", "mandated", "obliges", "obligates"],
    "awarded": ["awarded", "granted"],
    "advises": ["advises", "advised", "mentors", "mentored", "consults for", "consulted for", "counsels"],
    "competes with": ["competes with", "competed with", "rivals"],
    "hired": ["hired", "hires", "recruited", "recruits", "employs", "employed", "appointed", "appoints"],
    "serves": ["serves", "served", "powers", "powered"],
    "recommends": ["recommends", "recommended", "proposes", "proposed", "endorses", "endorsed"],
    "expanded to": ["expanded to", "expanded into", "expands to", "expands into"],
}

# canonical predicate → passive surface forms (object does it to subject; swap on match)
PASSIVE_PREDICATES = {
    "founded": ["was founded by", "were founded by", "was co-founded by", "was established by",
                "was set up by", "was started by", "founded by"],
    "acquired": ["was acquired by", "was bought by", "was purchased by", "acquired by"],
    "leads": ["is led by", "was led by", "is headed by", "was headed by", "is directed by", "was directed by",
              "is run by", "was run by", "is chaired by", "was chaired by", "is managed by", "was managed by",
              "is overseen by", "was overseen by", "is coordinated by", "led by"],
    "funds": ["is funded by", "was funded by", "are funded by", "were funded by", "is financed by",
              "was financed by", "is sponsored by", "was sponsored by", "is backed by", "was backed by",
              "funded by", "backed by"],
    "develops": ["was developed by", "is developed by", "were developed by", "was designed by",
                 "is designed by", "was built by", "is built by", "was invented by", "was pioneered by",
                 "developed by", "designed by", "built by"],
    "created": ["was created by", "is created by", "created by", "was introduced by"],
    "produces": ["is produced by", "was produced by", "is manufactured by", "was manufactured by",
                 "produced by", "manufactured by", "made by"],
    "supplies": ["is supplied by", "was supplied by", "are supplied by", "were supplied by", "supplied by",
                 "delivered by", "sold by"],
    "provides": ["is provided by", "was provided by", "provided by", "offered by"],
    "uses": ["is used by", "was used by", "are used by", "were used by", "used by", "is deployed by",
             "was deployed by", "deployed by"],
    "operates": ["is operated by", "was operated by", "operated by", "is owned by", "was owned by", "owned by",
                 "is maintained by"],
    "regulates": ["is regulated by", "was regulated by", "are regulated by", "regulated by",
                  "was approved by", "is approved by", "is certified by", "was certified by", "approved by"],
    "studies": ["was studied by", "is studied by", "is monitored by", "was monitored by",
                "was investigated by", "was analyzed by"],
    "published": ["was published by", "was authored by", "was written by", "was issued by",
                  "was released by", "published by"],
    "causes": ["is caused by", "was caused by", "are caused by", "caused by", "is driven by", "was driven by",
               "was triggered by"],
    "reduces": ["is reduced by", "was reduced by", "reduced by"],
    "requires": ["is required by", "was required by", "required by", "is mandated by", "was mandated by",
                 "mandated by"],
    "enacted": ["was passed by", "was enacted by", "passed by", "enacted by"],
    "hired": ["was hired by", "was recruited by", "was appointed by"],
    "advises": ["is advised by", "was advised by", "was mentored by"],
    "serves": ["is served by", "was served by", "is powered by", "was powered by", "powered by"],
    "treats": ["is treated by", "was treated by", "treated by"],
    "replaced": ["was replaced by", "is replaced by", "replaced by"],
    "closed": ["was closed by", "was shut down by", "was decommissioned by"],
    "awarded": ["was awarded by"],
}

# "received <a|the> <0-2 words> <grant|funding|...> from X" → X funds subject (passive form)
RECEIVED_FROM_PATTERN = (
    r"(?:received|receives|receive|obtained|secured|won)\s+(?:a\s+|an\s+|the\s+)?"
    r"(?:[\w$\-]+\s+){0,3}?(?:grant|grants|funding|rebate|rebates|investment|investments|support|"
    r"financing|subsidy|subsidies|award|awards|loan|loans|backing)\s+from"
)

# role phrase → canonical predicate (person —pred→ organisation)
ROLE_PREDICATES = {
    "ceo of": ["chief executive officer", "chief executive", "ceo", "managing director"],
    "cto of": ["chief technology officer", "cto"],
    "cfo of": ["chief financial officer", "cfo"],
    "coo of": ["chief operating officer", "coo"],
    "chief scientist of": ["chief scientist"],
    "founded": ["founder", "co-founder", "cofounder"],
    "leads": ["executive director", "director", "head", "president", "chair", "chairman", "chairwoman",
              "chairperson", "leader", "dean", "principal investigator", "commissioner"],
    "works at": ["researcher", "scientist", "engineer", "professor", "fellow", "analyst", "economist",
                 "physician", "doctor", "epidemiologist", "employee", "spokesperson", "lecturer", "manager",
                 "officer", "postdoc"],
    "member of": ["board member", "member", "trustee"],
    "advises": ["advisor", "adviser", "consultant"],
}

def predicate_surface_forms(predicate: str) -> list:
    """All surface forms behind a canonical predicate ('located in' → 'based in', 'headquartered in', …)."""
    forms = [predicate]
    for table in (ACTIVE_PREDICATES, PASSIVE_PREDICATES, ROLE_PREDICATES):
        for canon, surf in table.items():
            if predicate == canon or predicate.startswith(canon + " "):
                forms.extend(surf)
    return forms


PERSON_SUBJECT_PREDICATES = {"ceo of", "cto of", "cfo of", "coo of", "chief scientist of", "worked at",
                             "studied at", "joined", "member of"}
LOCATION_OBJECT_PREDICATES = {"located in", "serves", "expanded to"}

ORG_WORDS = set("""
institute institution university college school academy foundation commission agency authority council
committee ministry department bureau office board center centre hospital clinic laboratory laboratories lab
labs systems technologies tech inc corp corporation company co ltd llc group partners ventures capital
holdings bank fund trust association society consortium alliance network grid energy power utilities
utility solutions industries media pharma pharmaceuticals biotech motors airlines press legislature
parliament congress senate court police army navy party union federation organization organisation
coalition club league studio studios analytics robotics dynamics materials services works electric
""".split())
FACILITY_WORDS = set("plant facility station factory mine refinery farm dam airport terminal depot warehouse".split())
POLICY_WORDS = set("""
act law bill directive regulation regulations treaty accord agreement policy program programme initiative
plan standard strategy protocol framework mandate
""".split())
PUBLICATION_WORDS = set("journal review gazette proceedings magazine letters".split())
LOCATION_WORDS = set("""
city county bay river valley island islands coast state province region district lake sea ocean mountains
mountain peninsula harbor harbour village town street avenue square beach delta basin desert forest heights
springs falls hills
""".split())
LOCATION_FIRST_WORDS = set("port lake mount fort san santa".split())
PROJECT_WORDS = set("study survey trial project pilot".split())
PRODUCT_WORDS = set("battery batteries cell cells panel panels platform model app device engine".split())

# Determiners / sentence starters stripped from the front of capitalised runs.
LEADING_STOP = set("""
the a an in on at after before during since however meanwhile this that these those its their his her our
both each every many some several most all under over according while when although though because if as
by for from with without unlike like today yesterday currently recently later earlier also then now
overall finally first second third next last despite following through throughout among between within
across beyond toward towards upon once yet still thus therefore moreover furthermore additionally instead
otherwise here there we they it he she i you not no yes such other another one two three about around
""".split())

TITLE_PREFIXES = {"dr", "prof", "professor", "mr", "mrs", "ms", "miss", "sir", "dame", "commissioner",
                  "senator", "governor", "mayor", "minister", "judge", "chancellor", "president", "rev"}

ROLE_WORDS = {"ceo", "cto", "cfo", "coo", "chief", "executive", "officer", "director", "president", "chair",
              "chairman", "chairwoman", "founder", "co-founder", "head", "professor", "minister", "mayor",
              "governor", "secretary", "manager", "vice", "senior", "lead", "principal", "technology",
              "financial", "operating", "scientist", "managing"}

MONTHS_DAYS = set("""
january february march april may june july august september october november december monday tuesday
wednesday thursday friday saturday sunday
""".split())

HEADING_TAIL_WORDS = set("""
report brief profile overview summary study annual company policy analysis update review background
introduction notes factsheet fact sheet whitepaper paper outlook findings recommendations memo
""".split())

# Words often capitalised in headings / sentence starts that are not named entities on their own.
COMMON_WORDS = set("""
about acquisitions action activity agenda analysis annual appendix approach area areas assessment background
battery batteries benefits brief budget business case challenges change chapter clean climate coal
community company comparison conclusion conclusions context contents costs customers data demand
deployment description design details development discussion economic economy education efficiency
electricity emissions energy environment environmental evidence executive expansion expected
experience facts figure finance financial findings funding future goals governance grid growth health
highlights history impact impacts implementation incentives industry information infrastructure
innovation introduction investment investors issues key leadership lessons limitations list management
mandate market markets materials medical method methods mission model next note notes objectives
operations opportunities outcomes outlook overview partners partnerships people performance plan
plans policy power products profile program progress project projects public quality questions
recommendations references regional regulation renewable report research results review risk risks
safety scope section solar solutions staff storage strategy study summary supply support sustainability
system systems table team technology technologies timeline topics transition trends update use
value vision water work workforce year years respiratory childhood air pollution transport
""".split())

GENERIC_NOUNS = set("""
study program project report research results team company work data plan system effort approach solution
product products service services area areas part way ways year years people thing things group number
amount level levels rate rates use time times case cases result issue issues percent share utilities
""".split())

COREF_GENERIC_ORG = {"company", "firm", "startup", "organization", "organisation", "group", "utility",
                     "operator", "regulator", "business", "agency", "venture"}

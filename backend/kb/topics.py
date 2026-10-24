"""
Topic augmentation — community detection, grounded topic summaries, cross-topic links.

  1. Weighted entity graph: extracted relations (weight grows with distinct evidence)
     + co-mentions in the same passage (weaker signal).
  2. Louvain communities (networkx, fixed seed; inputs are sorted so the result is the same
     whichever graph store returned the rows and whatever Python's set order is).
  3. Each community gets a theme label (Gemini title, or its central concepts / keywords),
     TF-IDF keywords, the documents it spans and a summary:
       - LLM summary (Gemini) over the community's triples + passages, citations validated
       - otherwise an extractive summary of the passages that mention the most members
     Summaries carry [n] markers that index `evidence_chunk_ids`, so they are checkable.
  4. Cross-topic links: relations whose endpoints sit in different communities (bridges).
"""

import hashlib
import math
import re
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

import networkx as nx

from backend.kb import lexicon as L
from backend.kb.llm import LLMUnavailable
from backend.core.ranking import jaccard_sim as jaccard
from backend.kb.text_utils import STOPWORDS, find_all_ci, normalize_name, split_sentences, stem, tokenize
from backend.utils.logger import get_logger

log = get_logger(__name__)

MAX_LLM_SUMMARIES = 12

# predicate / role vocabulary says *how* things relate, not *what* a topic is about
_RELATION_WORDS = {t for table in (L.ACTIVE_PREDICATES, L.PASSIVE_PREDICATES, L.ROLE_PREDICATES)
                   for forms in table.values() for f in forms for t in tokenize(f)} | set(L.LEADING_STOP)

TOPIC_SUMMARY_PROMPT = """\
You summarise one topic community from a knowledge graph built from a user's documents.

Key entities: {entities}

Relations (subject — predicate → object):
{triples}

Passages:
{passages}

Write JSON: {{"title": "<= 6 word topic title", "summary": "2-3 sentences"}}
Rules: use ONLY the passages; end every sentence with citations like [1] or [2][3] that point to the
passages supporting it; no outside knowledge; no invented facts.
"""


# ─── alias scan → mentions ───────────────────────────────────────────────────

def scan_mentions(chunks: List[Dict[str, Any]], alias_index: Dict[str, str],
                  concept_ids: Set[str]) -> List[Tuple[str, str, str]]:
    """Find every known entity alias in every chunk (normalised n-gram match)."""
    by_first: Dict[str, int] = defaultdict(int)
    for norm in alias_index:
        toks = norm.split()
        if toks:
            by_first[toks[0]] = max(by_first[toks[0]], len(toks))
    rows: List[Tuple[str, str, str]] = []
    for ch in chunks:
        words = [(m.group(), m.start()) for m in re.finditer(r"[A-Za-z0-9][A-Za-z0-9'’\-&.]*", ch["text"])]
        low = [normalize_name(w) for w, _ in words]
        found: Set[str] = set()
        for i, (w, _) in enumerate(words):
            first = low[i].split()[0] if low[i] else ""
            maxn = by_first.get(first, 0)
            if not maxn:
                continue
            for n in range(min(maxn + 1, 7), 0, -1):
                if i + n > len(words):
                    continue
                cand = normalize_name(" ".join(x for x, _ in words[i:i + n]))
                eid = alias_index.get(cand)
                if not eid:
                    continue
                if n == 1 and (len(cand) < 4 or (eid not in concept_ids and not w[:1].isupper())):
                    continue
                found.add(eid)
                break
        rows.extend((eid, ch["chunk_id"], ch["doc_id"]) for eid in sorted(found))
    return rows


# ─── graph + communities ─────────────────────────────────────────────────────

def build_weighted_graph(entities: Dict[str, Dict[str, Any]], relations: List[Dict[str, Any]],
                         mentions: List[Tuple[str, str, str]]) -> nx.Graph:
    G = nx.Graph()
    doc_count: Dict[str, Set[str]] = defaultdict(set)
    by_chunk: Dict[str, Set[str]] = defaultdict(set)
    for eid, cid, did in mentions:
        doc_count[eid].add(did)
        by_chunk[cid].add(eid)
    related: Set[str] = set()
    for r in relations:
        s, o = r["subject_id"], r["object_id"]
        if s not in entities or o not in entities or s == o:
            continue
        related.update((s, o))
        w = 1.0 + 0.5 * min(int(r.get("evidence_count") or 1) - 1, 4)
        if G.has_edge(s, o):
            G[s][o]["weight"] += w
        else:
            G.add_edge(s, o, weight=w)
    salient = {e for e in entities if e in related or len(doc_count.get(e, ())) >= 2}
    G.add_nodes_from(n for n in sorted(salient) if n not in G)
    mention_total = Counter(eid for eid, _, _ in mentions)
    for cid in sorted(by_chunk):
        ents = [e for e in by_chunk[cid] if e in salient]
        ents = sorted(ents, key=lambda e: (-mention_total[e], e))[:15]
        for i in range(len(ents)):
            for j in range(i + 1, len(ents)):
                a, b = ents[i], ents[j]
                if G.has_edge(a, b):
                    G[a][b]["weight"] += 0.3
                else:
                    G.add_edge(a, b, weight=0.3, co_only=True)
    return G


def detect_communities(G: nx.Graph, resolution: float = 1.0, seed: int = 42) -> List[Set[str]]:
    if G.number_of_nodes() == 0:
        return []
    if G.number_of_edges() == 0:
        return [{n} for n in G.nodes]
    comms = nx.community.louvain_communities(G, weight="weight", resolution=resolution, seed=seed)
    return sorted((set(c) for c in comms), key=lambda c: (-len(c), sorted(c)[0]))


def signature(members: Set[str]) -> str:
    return hashlib.sha1("|".join(sorted(members)).encode()).hexdigest()


# ─── summaries ───────────────────────────────────────────────────────────────

def _keywords(member_names: List[str], member_chunks: Set[str], chunk_text: Dict[str, str], df: Counter,
              n_sentences: int, exclude: Set[str], k: int = 6) -> List[str]:
    """TF-IDF over only the sentences that mention a community member (not whole chunks,
    which also talk about neighbouring topics). Named-entity tokens are excluded."""
    tf: Counter = Counter()
    for cid in member_chunks:
        for _, _, sent in split_sentences(chunk_text.get(cid, "")):
            if not any(find_all_ci(sent, n) for n in member_names):
                continue
            for t in tokenize(sent):
                if len(t) >= 4 and t not in STOPWORDS and not t.isdigit() and t not in exclude:
                    tf[t] += 1
    scored = {t: c * math.log((1 + n_sentences) / (1 + df[t])) for t, c in tf.items()}
    return [t for t, _ in sorted(scored.items(), key=lambda x: (-x[1], x[0]))[:k]]


_THEME_TYPES = ("Concept", "Policy", "Project", "Technology", "Product", "Event")
_SMALL_WORDS = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"}


def _title(phrase: str) -> str:
    words = phrase.split()
    return " ".join(w if (i and w.lower() in _SMALL_WORDS) or w[:1].isupper()
                    else "-".join(p[:1].upper() + p[1:] for p in w.split("-")) for i, w in enumerate(words))


def topic_label(ordered: List[str], entities: Dict[str, Dict[str, Any]], rel_degree: Counter,
                keywords: List[str]) -> str:
    """What the topic is *about*: up to two non-overlapping theme phrases. Candidates are the community's
    concepts / policies / projects / technologies that take part in its relations, ranked by how many
    relations they join, then by how many of the topic's phrases share their words ("perovskite" in
    two concepts), then concepts before named themes; TF-IDF keywords fill in. Organisation and person
    names are used only when nothing thematic exists."""
    def terms(phrase: str) -> Set[str]:
        return {stem(t) for t in tokenize(phrase) if t not in STOPWORDS}

    rank = {m: i for i, m in enumerate(ordered)}
    themed = [m for m in ordered if entities[m]["type"] in _THEME_TYPES and rel_degree[m] >= 1]
    phrases = list(dict.fromkeys([entities[m]["name"].lower() for m in themed] + [k.lower() for k in keywords]))
    support = Counter(t for p in phrases for t in terms(p))
    themed.sort(key=lambda m: (-rel_degree[m], -max((support[t] for t in terms(entities[m]["name"])), default=0),
                               entities[m]["type"] != "Concept", rank[m]))
    picked: List[str] = []
    seen: Set[str] = set()
    for phrase in [entities[m]["name"] for m in themed] + [k for k in keywords if len(k) >= 4]:
        toks = terms(phrase)
        if not toks or toks & seen:
            continue  # "batteries" adds nothing after "sodium-ion batteries"
        picked.append(phrase)
        seen |= toks
        if len(picked) == 2:
            break
    if not picked:
        picked = [entities[m]["name"] for m in ordered[:2]]
    return " & ".join(_title(p) for p in picked)


def extractive_summary(top_names: List[str], member_names: List[str], member_chunks: List[str],
                       chunk_text: Dict[str, str], evidence_sentences: Set[str],
                       max_sentences: int = 3) -> Tuple[str, List[str]]:
    """Pick passage sentences covering the most community members. Returns (summary, chunk_ids)."""
    cands: List[Tuple[float, str, str]] = []
    for cid in member_chunks:
        for _, _, sent in split_sentences(chunk_text.get(cid, "")):
            if len(sent) < 25 or not sent.endswith((".", "!", "?")):
                continue
            hits = sum(1 for n in member_names if find_all_ci(sent, n))
            if hits == 0:
                continue
            score = hits + (1.0 if sent in evidence_sentences else 0.0) + \
                0.5 * sum(1 for n in top_names[:3] if find_all_ci(sent, n))
            cands.append((score, sent, cid))
    cands.sort(key=lambda x: -x[0])
    chosen: List[Tuple[str, str]] = []
    for _, sent, cid in cands:
        if any(jaccard(sent, s) > 0.6 for s, _ in chosen):
            continue
        chosen.append((sent, cid))
        if len(chosen) >= max_sentences:
            break
    evidence: List[str] = []
    parts = []
    for sent, cid in chosen:
        if cid not in evidence:
            evidence.append(cid)
        parts.append(f"{sent} [{evidence.index(cid) + 1}]")
    return " ".join(parts), evidence


async def llm_summary(llm, top_names, triples, member_chunks, chunk_text) -> Optional[Dict[str, Any]]:
    passages = member_chunks[:6]
    if not passages:
        return None
    prompt = TOPIC_SUMMARY_PROMPT.format(
        entities=", ".join(top_names[:10]),
        triples="\n".join(f"- {s} — {p} → {o}" for s, p, o in triples[:25]) or "- (none)",
        passages="\n\n".join(f"[{i + 1}] {chunk_text[c][:900]}" for i, c in enumerate(passages)),
    )
    try:
        data = await llm.complete_json(prompt, fast=True, max_tokens=600, temperature=0.1)
    except LLMUnavailable as e:
        log.warning(f"Topic summary LLM failed, extractive fallback: {e}")
        return None
    if not isinstance(data, dict):
        return None
    summary = str(data.get("summary", "")).strip()
    title = re.sub(r"\s+", " ", str(data.get("title", "")).strip())[:60]
    cited = [int(n) for n in re.findall(r"\[(\d+)\]", summary)]
    if not summary or not cited:
        return None
    # drop markers that point at passages we never showed, renumber the rest
    valid = [n for n in dict.fromkeys(cited) if 1 <= n <= len(passages)]
    if not valid:
        return None
    remap = {old: new for new, old in enumerate(valid, start=1)}
    summary = re.sub(r"\[(\d+)\]", lambda m: f"[{remap[int(m.group(1))]}]" if int(m.group(1)) in remap else "", summary)
    return {"label": title, "summary": re.sub(r"\s{2,}", " ", summary).strip(),
            "evidence_chunk_ids": [passages[n - 1] for n in valid], "method": "llm"}


# ─── orchestration ───────────────────────────────────────────────────────────

async def rebuild_topics(store, llm=None, resolution: float = 1.0) -> Dict[str, Any]:
    chunks = store.all_chunks()
    alias_index = store.alias_index()
    entity_rows = store.get_entities(list(set(alias_index.values())))
    concept_ids = {eid for eid, e in entity_rows.items() if e["type"] == "Concept"}
    store.replace_scan_mentions(scan_mentions(chunks, alias_index, concept_ids))

    mentions = store.entity_mentions()
    relations = store.relations()
    entities = store.get_entities(list({m[0] for m in mentions} | {r["subject_id"] for r in relations}
                                       | {r["object_id"] for r in relations}))
    G = build_weighted_graph(entities, relations, mentions)
    comms = detect_communities(G, resolution)

    chunk_text = {c["chunk_id"]: c["text"] for c in chunks}
    chunk_doc = {c["chunk_id"]: c["doc_id"] for c in chunks}
    df: Counter = Counter()  # sentence-level document frequency
    n_sentences = 0
    for c in chunks:
        for _, _, sent in split_sentences(c["text"]):
            n_sentences += 1
            df.update(set(tokenize(sent)))
    named_tokens = {t for e in entities.values() if e["type"] != "Concept" for t in tokenize(e["name"])}
    by_entity_chunks: Dict[str, List[str]] = defaultdict(list)
    for eid, cid, _ in mentions:
        if cid in chunk_text:
            by_entity_chunks[eid].append(cid)
    rel_evidence = store.relation_evidence([r["relation_id"] for r in relations])
    evidence_sentences = {e["sentence"] for evs in rel_evidence.values() for e in evs}

    assignments: Dict[str, Optional[str]] = {n: None for n in G.nodes}
    topics: List[Dict[str, Any]] = []
    llm_budget = MAX_LLM_SUMMARIES if llm is not None else 0
    for members in comms:
        if len(members) < 2:
            continue
        sig = signature(members)
        cid = "t_" + sig[:10]
        strength = {m: sum(G[m][n]["weight"] for n in G.neighbors(m) if n in members) for m in members}
        ordered = sorted(members, key=lambda m: (-strength[m], entities[m]["name"]))
        names = [entities[m]["name"] for m in ordered]
        rel_degree: Counter = Counter()  # relations inside the community, per member
        for r in relations:
            if r["subject_id"] in members and r["object_id"] in members:
                rel_degree[r["subject_id"]] += 1
                rel_degree[r["object_id"]] += 1
        chunk_counter: Counter = Counter()
        for m in sorted(members):
            chunk_counter.update(set(by_entity_chunks.get(m, [])))
        member_chunks = sorted(chunk_counter, key=lambda c: (-chunk_counter[c], c))
        doc_ids = [d for d, _ in Counter(chunk_doc[c] for c in member_chunks).most_common()]
        exclude = named_tokens | _RELATION_WORDS | {t for n in names for t in tokenize(n)}
        concept_kw = [entities[m]["name"] for m in ordered if entities[m]["type"] == "Concept"][:3]
        keywords = concept_kw + _keywords(names, set(member_chunks), chunk_text, df, n_sentences, exclude,
                                          k=6 - len(concept_kw))
        label = topic_label(ordered, entities, rel_degree, keywords)
        triples = [(entities[r["subject_id"]]["name"], r["predicate"], entities[r["object_id"]]["name"])
                   for r in relations if r["subject_id"] in members and r["object_id"] in members]

        want = "llm" if llm_budget > 0 and len(members) >= 3 else "extractive"
        cache_key = f"{sig}:{want}"
        cached = store.cached_summary(cache_key)
        result = None
        if cached:
            result = dict(cached, label=cached["label"] if cached["method"] == "llm" else label)
        elif want == "llm":
            llm_budget -= 1
            result = await llm_summary(llm, names, triples, member_chunks, chunk_text)
            if result:
                result["label"] = result["label"] or label
                result["keywords"] = keywords
                store.cache_summary(cache_key, result)
        if not result:
            summary, ev = extractive_summary(names[:6], names, member_chunks[:12], chunk_text, evidence_sentences)
            result = {"label": label, "summary": summary or f"Entities: {', '.join(names[:6])}.",
                      "evidence_chunk_ids": ev, "method": "extractive", "keywords": keywords}
            store.cache_summary(f"{sig}:extractive", result)

        for m in members:
            assignments[m] = cid
        topics.append({
            "community_id": cid, "label": result["label"] or label, "summary": result["summary"],
            "keywords": keywords, "size": len(members), "method": result["method"],
            "evidence_chunk_ids": result["evidence_chunk_ids"], "doc_ids": doc_ids, "signature": sig,
            "rank": len(topics), "top_entities": [m for m in ordered[:8]],
        })

    links = cross_topic_links(G, assignments, relations, entities)
    store.replace_communities(assignments, topics, links)
    log.info(f"Topics rebuilt: {len(topics)} communities, {len(links)} cross-topic links, "
             f"{G.number_of_nodes()} salient entities")
    return {"topics": len(topics), "links": len(links), "salient_entities": G.number_of_nodes()}


def cross_topic_links(G: nx.Graph, assignments: Dict[str, Optional[str]], relations: List[Dict[str, Any]],
                      entities: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    weight: Dict[Tuple[str, str], float] = defaultdict(float)
    bridges: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    for u, v, d in G.edges(data=True):
        a, b = assignments.get(u), assignments.get(v)
        if a and b and a != b:
            weight[tuple(sorted((a, b)))] += d["weight"]
    for r in sorted(relations, key=lambda r: -int(r.get("evidence_count") or 1)):
        a, b = assignments.get(r["subject_id"]), assignments.get(r["object_id"])
        if a and b and a != b:
            key = tuple(sorted((a, b)))
            if len(bridges[key]) < 5:
                bridges[key].append({
                    "relation_id": r["relation_id"], "predicate": r["predicate"],
                    "subject": {"id": r["subject_id"], "name": entities[r["subject_id"]]["name"]},
                    "object": {"id": r["object_id"], "name": entities[r["object_id"]]["name"]},
                })
    return [{"source": k[0], "target": k[1], "weight": round(w, 2), "bridges": bridges.get(k, [])}
            for k, w in sorted(weight.items(), key=lambda x: -x[1]) if w >= 0.5 or bridges.get(k)]

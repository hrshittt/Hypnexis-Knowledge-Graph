"""Entity resolution, persistent graph store, topic communities."""

import re

from conftest import make_service, run, sample_payload

from backend.kb.resolution import EntityResolver, entity_id_for
from backend.kb.store import KnowledgeStore
from backend.kb.text_utils import normalize_name


def test_normalize_name_equivalences():
    same = ["The Voltaic Systems Inc.", "Voltaic Systems", "voltaic systems'", "Voltaic System", "VOLTAIC SYSTEMS"]
    assert len({normalize_name(x) for x in same}) == 1
    assert normalize_name("Dr. Lena Park") == normalize_name("Lena Park")
    assert normalize_name("sodium-ion batteries") == normalize_name("sodium ion battery")
    assert normalize_name("Port Calder") != normalize_name("Port Carter")


def test_resolver_dedups_aliases_surnames_and_typos():
    res = EntityResolver({}, {})
    a, new_a = res.resolve("Amina Diallo", "Person")
    b, new_b = res.resolve("Dr. Amina Diallo", "Person")
    c, _ = res.resolve("Diallo", "Person")
    d, _ = res.resolve("Coastal Energy Commision", "Organization")  # typo
    e, _ = res.resolve("Coastal Energy Commission", "Organization")
    assert new_a and not new_b and a == b == c
    assert d == e
    res.add_alias("CEC", "Coastal Energy Commission")
    assert res.lookup("CEC") == e
    assert a == entity_id_for(normalize_name("Amina Diallo"))  # deterministic ids


def test_resolver_keeps_distinct_people_apart():
    res = EntityResolver({}, {})
    x, _ = res.resolve("Lena Park", "Person")
    y, _ = res.resolve("Mira Park", "Person")
    z, _ = res.resolve("Park", "Person")  # ambiguous surname → separate node, not a wrong merge
    assert x != y and z not in (x, y)


def test_store_persists_across_reopen(tmp_path):
    svc = make_service(tmp_path / "kb")
    run(svc.ingest_files_and_wait(sample_payload("voltaic_systems_brief.txt")))
    stats = svc.store.stats()
    svc.store.close()
    reopened = KnowledgeStore(tmp_path / "kb" / "knowledge.db")
    assert reopened.stats() == stats and stats["relations"] > 5
    rels = reopened.relations()
    assert all(r["evidence_count"] >= 1 for r in rels)
    reopened.close()


def test_cross_document_entities_merge(loaded_kb):
    ents = [e for e in loaded_kb.store.get_entities(list(loaded_kb.store.alias_index().values())).values()
            if e["name"] == "Voltaic Systems"]
    assert len(ents) == 1
    mention_docs = {d for eid, _, d in loaded_kb.store.entity_mentions() if eid == ents[0]["entity_id"]}
    # one node, linked to every document whose text names it (3 of the 5 samples)
    expected = {c["doc_id"] for c in loaded_kb.store.all_chunks() if "Voltaic Systems" in c["text"]}
    assert mention_docs == expected and len(expected) == 3


def test_reingesting_same_content_is_a_noop(kb):
    run(kb.ingest_files_and_wait(sample_payload("aurora_institute_profile.txt")))
    before = kb.store.stats()
    reg = run(kb.ingest_files_and_wait(sample_payload("aurora_institute_profile.txt")))
    assert reg["job"] is None and reg["results"][0]["status"] == "duplicate"
    assert kb.store.stats() == before


def test_topics_are_grounded(loaded_kb):
    topics = loaded_kb.store.communities()
    assert len(topics) >= 3
    chunks = loaded_kb.store.get_chunks([c for t in topics for c in t["evidence_chunk_ids"]])
    members = {}
    for eid, e in loaded_kb.store.get_entities(list(loaded_kb.store.alias_index().values())).items():
        if e["community_id"]:
            members.setdefault(e["community_id"], set()).add(eid)
    for t in topics:
        assert t["size"] == len(members[t["community_id"]]) >= 2
        assert set(t["top_entities"]) <= members[t["community_id"]]
        # every summary sentence ends with [n] pointing at a passage that contains that sentence
        for sentence, n in re.findall(r"(.+?)\s\[(\d+)\]\s?", t["summary"]):
            text = chunks[t["evidence_chunk_ids"][int(n) - 1]]["text"]
            assert sentence.strip() in text


def test_cross_topic_links_have_bridges(loaded_kb):
    links = loaded_kb.store.community_links()
    assert links
    comm = {e["entity_id"]: e["community_id"]
            for e in loaded_kb.store.get_entities(list(loaded_kb.store.alias_index().values())).values()}
    for link in links:
        for br in link["bridges"]:
            ends = {comm[br["subject"]["id"]], comm[br["object"]["id"]]}
            assert ends == {link["source"], link["target"]}


def test_health_study_forms_its_own_topic(loaded_kb):
    by_name = {e["name"]: e["community_id"]
               for e in loaded_kb.store.get_entities(list(loaded_kb.store.alias_index().values())).values()}
    assert by_name["Amina Diallo"] == by_name["childhood asthma"]
    assert by_name["Amina Diallo"] != by_name["Voltaic Systems"]

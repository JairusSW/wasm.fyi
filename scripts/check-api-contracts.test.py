"""Negative contract checks for the test-only payload validator."""
import copy
import importlib.util
import json
import sys
from pathlib import Path
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("contracts", Path(__file__).with_name("check-api-contracts.py"))
contracts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contracts)


class Contracts(unittest.TestCase):
    def result(self):
        directory = contracts.ROOT / "service/testdata/site-v2"
        manifest = json.loads((directory / "manifest.json").read_text())
        for entry in manifest["objects"]:
            if entry["kind"] == "record":
                record = json.loads((directory / "objects" / entry["sha256"]).read_bytes())
                if record["kind"] == "result":
                    return record["data"]
        self.fail("result fixture missing")

    def test_bounded_evidence_index(self):
        index = {"kind": "evidence-index", "schema": 1, "references": ["a" * 64, "a" * 64]}
        contracts.validate(index, "EvidenceIndex", "ordered index with repeated references")
        for key, value in [("references", []), ("references", ["a" * 64] * 129),
                           ("references", ["bad"]), ("schema", 2), ("trials", [])]:
            changed = copy.deepcopy(index)
            changed[key] = value
            with self.assertRaises(ValueError):
                contracts.validate(changed, "EvidenceIndex", "invalid index")

    def test_versioned_aggregate_summary_is_bounded_and_has_no_membership_preload(self):
        lane = "c" * 64
        scope = {"revision": "a" * 64, "selection": "current", "environment": "b" * 64,
                 "lanes": [lane], "laneKind": "track", "baseline": lane,
                 "selectors": [{"definition": "d" * 64, "method": "e" * 64, "analysis": "fixture"}],
                 "policy": "shared-geometric-v1", "weighting": "workload", "workloads": "applications",
                 "mixedConfigurations": "reject", "collectors": "allow-unrecorded-timing",
                 "definitions": "require-registered", "contracts": "latest-in-scope"}
        population = {"configuration": lane, "status": "available", "reason": "", "value": 4,
                      "ratio": 1, "ratioStatus": "available", "ratioReason": "", "count": 1,
                      "workloads": 1, "members": None, "reports": None, "approximateInputs": 0, "ratioUsesApproximateInputs": False}
        comparison = {"version": "wasmfyi-cohort-v3", "valueRepresentation": "float64", "baseline": lane, "policy": scope["policy"],
                      "weighting": "workload", "requested": [lane], "participants": [lane], "omitted": [],
                      "populations": [population], "uncertainty": "unavailable", "uncertaintyReason": "policy unavailable"}
        summary = {"scope": scope, "cohort": "fixture-token", "digest": "f" * 64,
                   "categoryPolicy": "fixture", "eligibilityPolicy": "fixture", "excluded": {},
                   "comparison": comparison, "reportCounts": {lane: 1}, "configurationCounts": {lane: 1}}
        contracts.validate(summary, "AggregateSummary", "bounded current-version aggregate")
        for key, value in [("members", []), ("reports", []), ("count", -1), ("approximateInputs", -1), ("ratioUsesApproximateInputs", "yes")]:
            changed = copy.deepcopy(summary)
            changed["comparison"]["populations"][0][key] = value
            with self.assertRaises(ValueError):
                contracts.validate(changed, "AggregateSummary", "invalid population")
        for key, value in [("version", "wasmfyi-cohort-v1"), ("uncertainty", "available"),
                           ("requested", [f"{i:064x}" for i in range(33)]), ("populations", [population] * 33)]:
            changed = copy.deepcopy(summary)
            changed["comparison"][key] = value
            with self.assertRaises(ValueError):
                contracts.validate(changed, "AggregateSummary", "invalid comparison summary")

    def test_history_changes_are_bounded_and_do_not_invent_uncertainty(self):
        lane = "c" * 64
        scope = {"revision": "a" * 64, "selection": "current", "environment": "b" * 64,
                 "lanes": [lane], "laneKind": "track", "baseline": lane,
                 "selectors": [{"definition": "d" * 64, "method": "e" * 64, "analysis": "fixture"}],
                 "policy": "shared-geometric-v1", "weighting": "workload", "workloads": "applications",
                 "mixedConfigurations": "reject", "collectors": "allow-unrecorded-timing",
                 "definitions": "require-registered", "contracts": "latest-in-scope"}
        value = {"policy": "matched-workload-change-v1", "beforeScope": scope, "afterScope": scope,
                 "beforeDigest": "f" * 64, "afterDigest": "f" * 64, "status": "unavailable",
                 "reason": "no matches", "before": None, "after": None, "ratio": None,
                 "matchedCells": 0, "matchedWorkloads": 0, "beforeOnlyCells": 1,
                 "afterOnlyCells": 1, "reusedCells": 0, "approximateInputs": 0,
                 "uncertainty": "unavailable", "uncertaintyReason": "not paired"}
        contracts.validate(value, "HistoryChange", "missing matches remain unavailable")
        for key, invalid in [("members", []), ("samples", []), ("uncertainty", "available"),
                             ("matchedCells", 10001), ("reusedCells", -1), ("policy", "old")]:
            changed = copy.deepcopy(value)
            changed[key] = invalid
            with self.assertRaises(ValueError):
                contracts.validate(changed, "HistoryChange", "invalid change")

    def test_history_binding_preserves_roles_and_separate_dates(self):
        binding = {"reportId": "a" * 64, "configurationId": "b" * 64,
                   "policy": "declared-build-history-v1", "targetDate": "2026-01-01",
                   "sourceDate": "2025-12-31T23:59:59Z", "sourceRevision": "c" * 40,
                   "buildRole": "source"}
        context = {"binding": binding, "collectedAt": None,
                   "publishedAt": "2026-10-06T12:00:00Z",
                   "interpretationSource": "trusted-publisher-assertion",
                   "collectionTimeSource": "source-report-created"}
        contracts.validate(context, "HistoryContext", "unknown collection time remains null")
        release = {"version": "v1.2.3", "publishedAt": "2026-01-02T00:00:00Z",
                   "url": "https://example.test/releases/v1.2.3"}
        for key, invalid in [("release", release), ("buildRole", "release"),
                             ("targetDate", "2026-02-30"), ("sourceRevision", "main"),
                             ("samples", [])]:
            changed = copy.deepcopy(binding)
            changed[key] = invalid
            with self.assertRaises(ValueError):
                contracts.validate(changed, "HistoryBinding", "invalid binding")
        binding["buildRole"] = "release"
        binding["release"] = release
        contracts.validate(binding, "HistoryBinding", "explicit release association")
        context["interpretationSource"] = "source-verified"
        with self.assertRaises(ValueError):
            contracts.validate(context, "HistoryContext", "publisher role is not source verification")

    def test_report_archive_requires_packing_and_source_seal(self):
        value = {"schema": 1, "kind": "report-file", "reportId": "a" * 64,
                 "name": "report.tar.gz", "mediaType": "application/gzip", "encoding": "identity",
                 "sha256": "b" * 64, "bytes": 1, "chunks": [{"sha256": "b" * 64, "bytes": 1}],
                 "packingVersion": "sealed-files-tar-gzip-v1", "sourceSealSha256": "c" * 64}
        contracts.validate(value, "ReportFile", "bounded archive derivative")
        for key, invalid in [("packingVersion", "unknown"), ("name", "../report.tar.gz"),
                             ("mediaType", "application/vnd.apache.parquet"), ("bytes", 0),
                             ("chunks", []), ("sourceSealSha256", "missing")]:
            changed = copy.deepcopy(value)
            changed[key] = invalid
            with self.assertRaises(ValueError):
                contracts.validate(changed, "ReportFile", "invalid archive")
        for key in ("packingVersion", "sourceSealSha256"):
            changed = copy.deepcopy(value)
            del changed[key]
            with self.assertRaises(ValueError):
                contracts.validate(changed, "ReportFile", "missing archive provenance")

    def test_request_telemetry_is_bounded_and_has_no_identity_labels(self):
        value = {"class": "summary", "active": 0, "completed": 1,
                 "statuses": [0, 0, 1, 0, 0, 0], "latency": [1, 0, 0, 0, 0, 0, 0, 0],
                 "writtenBytes": 10, "decodedJSONBytes": 100, "canceled": 0,
                 "deadlines": 0, "writeErrors": 0, "streamAborts": 0, "panics": 0}
        contracts.validate(value, "RequestRouteStats", "fixed route telemetry")
        for key, invalid in [("class", "/results/private-id"), ("path", "/secret"),
                             ("client", "192.0.2.1"), ("token", "secret"),
                             ("active", -1), ("statuses", [0] * 7), ("latency", [0] * 9)]:
            changed = copy.deepcopy(value)
            changed[key] = invalid
            with self.assertRaises(ValueError):
                contracts.validate(changed, "RequestRouteStats", "unbounded or identifying telemetry")

    def test_transport_reference_aliases_resolve_only_local_schema(self):
        for root in ("site-v2.schema.json", "./site-v2.schema.json", contracts.SCHEMA["$id"]):
            reference = contracts.transport_reference(root + "#/$defs/Digest")
            contracts.validate("a" * 64, {"$ref": reference}, "local transport alias")
        for reference in ("https://other.test/schema.json#/$defs/Digest", "../site-v2.schema.json"):
            with self.assertRaises(ValueError):
                contracts.transport_reference(reference)

    def test_revision_pages_are_bounded_and_have_explicit_continuation(self):
        page = {"revision": "a" * 64, "items": ["a" * 64], "total": 100005,
                "complete": False, "nextCursor": "signed-successor"}
        contracts.validate(page, "RevisionPage", "large frozen chain")
        for key, value in [("items", []), ("items", [f"{i:064x}" for i in range(1001)]),
                           ("total", 0), ("nextCursor", ""), ("complete", True)]:
            changed = copy.deepcopy(page)
            changed[key] = value
            with self.assertRaises(ValueError):
                contracts.validate(changed, "RevisionPage", "invalid revision page")

    def test_required_provenance_and_date(self):
        result = self.result()
        contracts.validate(result, "ResultData", "valid source")
        missing = copy.deepcopy(result)
        del missing["trackId"]
        with self.assertRaises(ValueError):
            contracts.validate(missing, "ResultData", "missing track")
        result["created"] = "yesterday"
        with self.assertRaises(ValueError):
            contracts.validate(result, "ResultData", "bad date")

    def test_summary_does_not_accept_full_method(self):
        summary = self.result()
        summary.pop("measurementMethod", None)
        summary["measurementMethodId"] = "a" * 64
        contracts.validate(summary, "ResultSummaryData", "referenced method")
        summary["measurementMethod"] = {}
        with self.assertRaises(ValueError):
            contracts.validate(summary, "ResultSummaryData", "recipe preload")

    def test_function_attribution_and_page_type(self):
        row = {"module_index": 0, "wasm_index": 7, "offset": 0, "length": 32, "tier": "cranelift", "generation": 0}
        contracts.validate(row, "NativeFunction", "valid function")
        row["length"] = -1
        with self.assertRaises(ValueError):
            contracts.validate(row, "NativeFunction", "invalid range")
        with self.assertRaises(ValueError):
            contracts.validate({"items": []}, "CohortMemberPage", "missing frozen scope")

    def test_session_page_boundaries_and_no_evidence_preload(self):
        job = {"id": "a" * 64, "session": "session", "machine": "local",
               "corpus": "corpus-0001", "attempt": "attempt-1",
               "configuredHarnessPin": "pinned-source", "plan": "b" * 64,
               "parentBundleSha256": "c" * 64, "collectionStatus": "completed",
               "publicationStatus": "published", "publishedAt": "2026-10-06T00:00:00Z",
               "reports": ["d" * 64]}
        page = {"revision": "e" * 64, "items": [job], "total": 2,
                "complete": False, "nextCursor": "signed-cursor",
                "sort": "machine-corpus-attempt-id"}
        contracts.validate(page, "SessionJobPage", "valid partial frozen page")
        for key, value in [("total", -1), ("items", [job] * 1001),
                           ("sort", "arrival-order"), ("objects", []), ("nextCursor", ""), ("complete", True)]:
            changed = copy.deepcopy(page)
            changed[key] = value
            with self.assertRaises(ValueError):
                contracts.validate(changed, "SessionJobPage", "invalid page")
        for key, value in [("publicationStatus", "staged"), ("publishedAt", "today"),
                           ("reports", ["d" * 64] * 9), ("exports", [])]:
            changed = copy.deepcopy(page)
            changed["items"][0][key] = value
            with self.assertRaises(ValueError):
                contracts.validate(changed, "SessionJobPage", "invalid job reference")

    def test_plan_registration_has_no_attempt_or_evidence(self):
        registration = {"schema": 1, "session": "planned-session", "plan": "a" * 64,
                        "configuredHarnessPin": "b" * 40,
                        "sessionPlan": {"schema": 1, "bytes": 10,
                                        "chunks": [{"sha256": "c" * 64, "bytes": 10, "kind": "binary"}]}}
        contracts.validate(registration, "PlanRegistration", "pre-job scope")
        for key, value in [("attempt", "invented"), ("exports", []), ("machine", "local"),
                           ("session", "../escape"), ("configuredHarnessPin", "short"), ("schema", 2)]:
            bad = copy.deepcopy(registration)
            bad[key] = value
            with self.assertRaises(ValueError):
                contracts.validate(bad, "PlanRegistration", "invalid registration")
        for key, value in [("bytes", 16777217), ("chunks", []),
                           ("chunks", registration["sessionPlan"]["chunks"] * 17)]:
            bad = copy.deepcopy(registration)
            bad["sessionPlan"][key] = value
            with self.assertRaises(ValueError):
                contracts.validate(bad, "PlanRegistration", "unbounded registration")

    def test_registered_scope_does_not_preload_inventory(self):
        scope = {"id": "before-work", "registrationId": "a" * 64, "plan": "b" * 64,
                 "configuredHarnessPin": "c" * 40, "members": 2, "plannedJobs": 4,
                 "status": "registered"}
        contracts.validate(scope, "RegisteredSession", "small registered scope")
        for key, value in [("jobs", []), ("chunks", []), ("reports", []),
                           ("status", "completed"), ("members", 129), ("plannedJobs", 100001)]:
            bad = copy.deepcopy(scope)
            bad[key] = value
            with self.assertRaises(ValueError):
                contracts.validate(bad, "RegisteredSession", "unbounded or fabricated scope")

    def test_progress_is_small_operational_metadata(self):
        update = {"schema": 1, "session": "s", "plan": "a" * 64, "machine": "local",
                  "corpus": "corpus-0001", "attempt": "attempt-1", "sequence": 1,
                  "status": "running", "phase": "timing", "observedAt": "2026-10-06T00:00:00Z"}
        receipt = {"id": "b" * 64, "update": update, "recordedAt": "2026-10-06T00:00:01Z"}
        contracts.validate(receipt, "AttemptProgress", "operational receipt")
        for key, value in [("samples", []), ("reports", []), ("sequence", 0),
                           ("sequence", 10001), ("status", "published"), ("observedAt", "today")]:
            bad = copy.deepcopy(receipt)
            bad["update"][key] = value
            with self.assertRaises(ValueError):
                contracts.validate(bad, "AttemptProgress", "invalid progress")

    def test_attempt_page_is_bounded_and_marks_continuation(self):
        page = {"progressRoot": "a" * 64, "items": [], "total": 2,
                "complete": False, "nextCursor": "signed", "sort": "machine-corpus-attempt"}
        contracts.validate(page, "AttemptProgressPage", "partial progress page")
        for key, value in [("sort", "arrival"), ("total", 10001), ("samples", []),
                           ("nextCursor", ""), ("progressRoot", ""), ("complete", True)]:
            bad = copy.deepcopy(page)
            bad[key] = value
            with self.assertRaises(ValueError):
                contracts.validate(bad, "AttemptProgressPage", "invalid progress page")

    def test_session_error_contracts(self):
        contracts.validate({"error": "request limit"}, "APIError", "admission error")
        contracts.validate({"error": "invalid request", "code": "invalid_request"},
                           "APIError", "classified error")
        for value in [{}, {"error": ""}, {"error": "failure", "code": "invented"},
                      {"error": "failure", "rawEvidence": {}}]:
            with self.assertRaises(ValueError):
                contracts.validate(value, "APIError", "invalid error")


if __name__ == "__main__":
    unittest.main()

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

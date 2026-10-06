# /// script
# requires-python = ">=3.11"
# dependencies = ["jsonschema[format-nongpl]==4.26.0"]
# ///
"""Validate real producer exports and captured API responses against local schemas.
Run with uv run scripts/check-api-contracts.py --export DIR --responses FILE.
No schema references are fetched from the network during validation.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "schemas/site-v2.schema.json").read_text())
OPENAPI = json.loads((ROOT / "schemas/api-v1.openapi.json").read_text())
REGISTRY = Registry().with_resource(SCHEMA["$id"], Resource.from_contents(SCHEMA))
Draft202012Validator.check_schema(SCHEMA)
COUNT = 0


def validate(value, definition, context):
    global COUNT
    schema = {"$ref": SCHEMA["$id"] + "#/$defs/" + definition} if isinstance(definition, str) else definition
    validator = Draft202012Validator(schema, registry=REGISTRY, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(value), key=lambda e: str(e.path))
    if errors:
        error = errors[0]
        raise ValueError(f"{context}: {list(error.path)}: {error.message}")
    COUNT += 1


def export(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    validate(manifest, "ExportManifest", str(directory))
    descriptors = list(manifest["objects"])
    for page in manifest.get("inventoryPages", []):
        body = (directory / "objects" / page["sha256"]).read_bytes()
        if len(body) != page["bytes"] or hashlib.sha256(body).hexdigest() != page["sha256"]:
            raise ValueError("inventory digest/size mismatch")
        inventory = json.loads(body)
        validate(inventory, "InventoryPage", page["sha256"])
        if len(inventory["objects"]) != page["objects"] or sum(o["bytes"] for o in inventory["objects"]) != page["contentBytes"]:
            raise ValueError("inventory commitments differ")
        descriptors.extend(inventory["objects"])
    for descriptor in descriptors:
        body = (directory / "objects" / descriptor["sha256"]).read_bytes()
        if len(body) != descriptor["bytes"] or hashlib.sha256(body).hexdigest() != descriptor["sha256"]:
            raise ValueError("payload digest/size mismatch")
        if descriptor["kind"] == "binary":
            continue
        value = json.loads(body)
        context = descriptor["sha256"]
        if descriptor["kind"] == "record":
            validate(value, "WireRecord", context)
            if value["kind"] == "result":
                validate(value["data"], "ResultData", context)
            elif value["kind"] == "report-file":
                validate(value["data"], "ReportFile", context)
            elif value["kind"] == "report" and "analysisSections" in value["data"]:
                validate(value["data"]["analysisSections"], "ReportAnalysisReferences", context)
        elif isinstance(value, dict):
            definitions = {"evidence-index": "EvidenceIndex", "json-resource": "JSONResource", "json-fragment": "JSONFragment", "report-analysis": "ReportAnalysis"}
            if value.get("kind") in definitions:
                validate(value, definitions[value["kind"]], context)
            if value.get("kind") == "native-image-metadata":
                for shard in value.get("functionShards", []):
                    validate(shard, "NativeFunctionShard", context)
                for digest in value.get("functions", []):
                    rows = json.loads((directory / "objects" / digest).read_bytes())
                    # Chunked oversized rows are checked as JSON resources above.
                    if isinstance(rows, list):
                        for row in rows:
                            validate(row, "NativeFunction", digest)


def transport_reference(reference):
    location, separator, fragment = reference.partition("#")
    if location in ("site-v2.schema.json", "./site-v2.schema.json", SCHEMA["$id"]):
        return SCHEMA["$id"] + (separator + fragment if separator else "")
    raise ValueError("unsupported transport schema reference")


def responses(path):
    typed = 0
    for line in path.read_text().splitlines():
        capture = json.loads(line)
        route = urlsplit(capture["route"]).path
        segments = route.split("/")
        matches = []
        for candidate, methods in OPENAPI["paths"].items():
            parts = candidate.split("/")
            if len(parts) == len(segments) and all(a == b or a.startswith("{") for a, b in zip(parts, segments)):
                matches.append((sum(not p.startswith("{") for p in parts), methods))
        if not matches:
            raise ValueError(f"undocumented response route: {route}")
        operation = max(matches, key=lambda x: x[0])[1]["get"]
        response = operation["responses"][str(capture["status"])]
        while "$ref" in response:
            reference = response["$ref"]
            if not reference.startswith("#/"):
                raise ValueError("nonlocal OpenAPI response reference")
            response = OPENAPI
            for part in reference[2:].split("/"):
                response = response[part.replace("~1", "/").replace("~0", "~")]
        schema = response["content"]["application/json"]["schema"]
        if "$ref" in schema:
            reference = transport_reference(schema["$ref"])
            schema = {"$ref": reference}
            typed += 1
        validate(capture["body"], schema, route)
    if not typed:
        raise ValueError("response capture contains no typed endpoint contracts")
    print(f"Typed endpoint responses checked: {typed}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--export", type=Path, action="append", default=[])
    parser.add_argument("--responses", type=Path)
    args = parser.parse_args()
    if not args.export and not args.responses:
        parser.error("provide --export or --responses")
    for directory in args.export:
        export(directory)
    if args.responses:
        responses(args.responses)
    print(f"Schema contracts checked: {COUNT}")

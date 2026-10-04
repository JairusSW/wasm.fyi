import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { digest } from "./wasmbench.mjs";
export async function verifyParentBundle(directory, plan) {
  const index = JSON.parse(await readFile(join(directory, "index.json"))),
    metadata = await readFile(join(directory, index.metadata));
  if (
    index.schema !== 1 ||
    index.id !== plan.id ||
    JSON.parse(metadata).planSha256 !== plan.identity
  )
    throw Error("Parent collection bundle belongs to another plan");
  if (index.metadataSha256 && digest(metadata) !== index.metadataSha256)
    throw Error("Parent metadata digest mismatch");
  const full = createHash("sha256");
  let bytes = 0;
  for (const [i, part] of index.parts.entries()) {
    if (part.path !== `bundle.tar.gz.part-${String(i).padStart(3, "0")}`)
      throw Error("Unsafe parent archive part");
    const hash = createHash("sha256");
    let size = 0;
    for await (const b of createReadStream(join(directory, part.path))) {
      hash.update(b);
      full.update(b);
      size += b.length;
    }
    if (hash.digest("hex") !== part.sha256 || size !== part.bytes)
      throw Error("Parent archive part digest mismatch");
    bytes += size;
  }
  if (bytes !== index.bytes || full.digest("hex") !== index.sha256)
    throw Error("Parent archive digest mismatch");
  return index;
}

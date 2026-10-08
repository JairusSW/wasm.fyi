//! Pure-core adapters: no CLI, filesystem, clock, entropy, or host imports.
//! Each invocation reconstructs its state and hashes every output byte.
static mut OUTPUT: Vec<u8> = Vec::new();
#[no_mangle]
pub extern "C" fn output_ptr() -> *const u8 { unsafe { (&raw const OUTPUT).as_ref().unwrap().as_ptr() } }
#[no_mangle]
pub extern "C" fn output_len() -> usize { unsafe { (&raw const OUTPUT).as_ref().unwrap().len() } }
#[no_mangle]
pub extern "C" fn benchmark() -> u64 {
    let output = workload();
    let hash = output.iter().fold(14695981039346656037u64, |h,b| (h ^ *b as u64).wrapping_mul(1099511628211));
    unsafe { OUTPUT = output; }
    hash
}
#[cfg(feature="sort")]
fn workload() -> Vec<u8> {
    let mut lines: Vec<_> = include_str!("../fixtures/lines.txt").lines().collect();
    lines.sort();
    (lines.join("\n") + "\n").into_bytes()
}
#[cfg(feature="base64-work")]
fn workload() -> Vec<u8> {
    use base64::{Engine,engine::general_purpose::{STANDARD,URL_SAFE_NO_PAD}};
    let input = include_bytes!("../fixtures/binary.bin");
    let a = STANDARD.encode(input);
    let b = URL_SAFE_NO_PAD.encode(input);
    let decoded = STANDARD.decode(&a).unwrap();
    let decoded_b = URL_SAFE_NO_PAD.decode(&b).unwrap();
    [a.as_bytes(), b"\n", b.as_bytes(), b"\n", &decoded, &decoded_b].concat()
}
#[cfg(feature="wc")]
fn workload() -> Vec<u8> {
    use unicode_segmentation::UnicodeSegmentation;
    let input = include_str!("../fixtures/words.txt");
    format!("{} {} {} {} {}\n",input.bytes().filter(|b|*b==b'\n').count(),input.split_whitespace().count(),input.len(),input.chars().count(),input.graphemes(true).count()).into_bytes()
}
#[cfg(feature="scan")]
fn workload() -> Vec<u8> {
    let input = include_str!("../fixtures/source.txt");
    let patterns = [r"(?m)^fn\s+([A-Za-z_][A-Za-z_0-9]*)\(([^\n]*)\)",r"\b(?:TODO|FIXME):[^\n]*",r"\b[0-9]{2,4}\b",r"(?m)^use\s+([a-z_:]+);$"];
    let mut out = String::new();
    for (i,p) in patterns.iter().enumerate() {
        let re = regex::Regex::new(p).unwrap();
        for m in re.find_iter(input) {out.push_str(&format!("{}:{}:{}:{}\n",i,m.start(),m.end(),m.as_str()));}
    }
    out.into_bytes()
}
#[cfg(feature="csv-work")]
fn workload() -> Vec<u8> {
    let rows: serde_json::Value = serde_json::from_slice(include_bytes!("../fixtures/people.json")).unwrap();
    let mut w = csv::WriterBuilder::new().terminator(csv::Terminator::CRLF).from_writer(Vec::new());
    w.write_record(["id","name","city","score","active"]).unwrap();
    for r in rows.as_array().unwrap() {w.write_record([r["id"].to_string(),r["name"].as_str().unwrap().to_owned(),r["city"].as_str().unwrap().to_owned(),r["score"].to_string(),r["active"].to_string()]).unwrap();}
    w.into_inner().unwrap()
}
#[cfg(feature="query")]
fn workload() -> Vec<u8> {
    use jaq_core::{load::{Arena,File,Loader},Ctx,RcIter};
    use jaq_json::Val;
    let input: serde_json::Value = serde_json::from_slice(include_bytes!("../fixtures/people.json")).unwrap();
    let queries = ["map(select(.active and .score >= 50) | [.id, .name, (.score * 2)])", "sort_by(.score) | reverse | .[:12] | map([.id,.score])", "group_by(.city) | map([.[0].city, length, (map(.score) | add)])", "reduce .[] as $p (0; . + $p.score)"];
    let mut out = String::new();
    for query in queries {
        let arena = Arena::default();
        let loader = Loader::new(jaq_std::defs().chain(jaq_json::defs()));
        let modules = loader.load(&arena, File{code:query,path:()}).unwrap();
        let filter = jaq_core::Compiler::default().with_funs(jaq_std::funs().chain(jaq_json::funs())).compile(modules).unwrap();
        let inputs = RcIter::new(core::iter::empty());
        for value in filter.run((Ctx::new([], &inputs),Val::from(input.clone()))) {out.push_str(&value.unwrap().to_string());out.push('\n');}
    }
    out.into_bytes()
}
#[cfg(feature="zip-work")]
fn workload() -> Vec<u8> {
    use std::io::{Cursor,Read};
    let mut archive = zip::ZipArchive::new(Cursor::new(include_bytes!("../fixtures/tree.zip"))).unwrap();
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).unwrap();
        out.extend_from_slice(format!("{}\t{}\t{}\n",file.name(),file.size(),file.crc32()).as_bytes());
        file.read_to_end(&mut out).unwrap();
        out.push(b'\n');
    }
    out
}
#[cfg(feature="x25519")]
fn workload() -> Vec<u8> {
    let mut out = Vec::new();
    for i in 0..64u32 {
        let secret = core::array::from_fn(|j| ((i*37 + j as u32*19 + 11) & 255) as u8);
        out.extend_from_slice(&x25519_dalek::x25519(secret,x25519_dalek::X25519_BASEPOINT_BYTES));
    }
    out
}

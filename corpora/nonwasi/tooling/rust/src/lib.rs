// Last output is retained only for independent host verification; every run recomputes it.
static OUTPUT: std::sync::Mutex<Vec<u8>> = std::sync::Mutex::new(Vec::new());
#[no_mangle]
pub extern "C" fn output_ptr() -> *const u8 { OUTPUT.lock().unwrap().as_ptr() }
#[no_mangle]
pub extern "C" fn output_len() -> usize { OUTPUT.lock().unwrap().len() }
fn commit(bytes: Vec<u8>) -> u32 {
 let hash=bytes.iter().fold(2166136261u32,|h,b|(h^u32::from(*b)).wrapping_mul(16777619));
 *OUTPUT.lock().unwrap()=bytes; hash
}
#[no_mangle]
pub extern "C" fn reset() {}
#[cfg(feature="assembler")]
#[no_mangle]
pub extern "C" fn run() -> u32 {
 let bytes=wat::parse_str(include_str!("fixture.wat")).expect("valid fixture");
 wasmparser::Validator::new().validate_all(&bytes).expect("valid binary");
 commit(bytes)
}
#[cfg(feature="minifier")]
pub fn minify() -> String {
 use oxc_allocator::Allocator;
 use oxc_codegen::{Codegen,CodegenOptions};
 use oxc_minifier::{Minifier,MinifierOptions};
 use oxc_parser::Parser;
 use oxc_span::SourceType;
 let allocator=Allocator::default();
 let parsed=Parser::new(&allocator,include_str!("fixture.js"),SourceType::cjs()).parse();
 assert!(parsed.errors.is_empty());
 let mut program=parsed.program;
 let result=Minifier::new(MinifierOptions::default()).build(&allocator,&mut program);
 Codegen::new().with_options(CodegenOptions{minify:true,comments:false,..CodegenOptions::default()}).with_scoping(result.scoping).build(&program).code
}
#[cfg(feature="minifier")]
#[no_mangle]
pub extern "C" fn run() -> u32 {
 commit(minify().into_bytes())
}

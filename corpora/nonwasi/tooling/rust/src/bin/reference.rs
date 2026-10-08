fn main() {
 #[cfg(feature="minifier")] print!("{}",tooling_core::minify());
 #[cfg(feature="assembler")] { use std::io::Write; std::io::stdout().write_all(&wat::parse_str(include_str!("../fixture.wat")).unwrap()).unwrap(); }
}

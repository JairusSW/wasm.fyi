MRuby::Build.new do |conf|
  conf.toolchain :gcc
  conf.gem core: 'mruby-bin-mrbc'
  conf.gem core: 'mruby-compiler'
end
MRuby::CrossBuild.new('core-wasm') do |conf|
  conf.toolchain :gcc
  conf.cc.command = ENV.fetch('WASI_SDK_PATH') + '/bin/clang'
  conf.cc.flags = ['-O2', '-flto', '-fno-stack-protector', '-ffunction-sections', '-fdata-sections']
  conf.cc.defines += %w[MRB_NO_STDIO MRB_INT64 NDEBUG]
  conf.archiver.command = ENV.fetch('WASI_SDK_PATH') + '/bin/llvm-ar'
  conf.gem core: 'mruby-compiler'
end

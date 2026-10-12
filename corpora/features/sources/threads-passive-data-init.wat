(module (memory 2 2 shared) (data $seed "\11\36\5b\80\a5\ca\ef\14\39\5e\83\a8\cd\f2\17\3c\61\86\ab\d0\f5\1a\3f\64\89\ae\d3\f8\1d\42\67\8c\b1\d6\fb\20\45\6a\8f\b4\d9\fe\23\48\6d\92\b7\dc\01\26\4b\70\95\ba\df\04\29\4e\73\98\bd\e2\07\2c")
  (func (export "benchmark") (param $n i32) (result i32)
    (local $i i32) (local $a i32) 
    
    (loop $loop
      (local.set $a (i32.add (local.get $a) (block (result i32) (memory.init $seed (i32.add (i32.shl (i32.and (local.get $i) (i32.const 8191)) (i32.const 2)) (i32.const 1)) (i32.and (local.get $i) (i32.const 15)) (i32.const 33)) (i32.load8_u (i32.add (i32.shl (i32.and (local.get $i) (i32.const 8191)) (i32.const 2)) (i32.const 33))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop (i32.lt_u (local.get $i) (local.get $n))))
    (local.get $a)))

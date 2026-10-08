(module
  ;; Both finite input lanes are positive, far inside the signed i32 range.
  ;; Fractional quarters and halves are exact; lanes 2 and 3 must be zero.

  (func (export "finite-truncation-zero-lanes") (param $n i32) (result i32)
    (local $i i32) (local $total i32) (local $v v128)
    (block $done
      (br_if $done (i32.eqz (local.get $n)))
      (loop $again
        (local.set $total (i32.add (local.get $total) (block (result i32)
    (local.set $v (i32x4.relaxed_trunc_f64x2_s_zero
      (f64x2.replace_lane 1
        (f64x2.splat (f64.add (f64.convert_i32_u (i32.and (local.get $i) (i32.const 255))) (f64.const 0.75)))
        (f64.add (f64.convert_i32_u (i32.shl (i32.and (local.get $i) (i32.const 255)) (i32.const 1))) (f64.const 0.5)))))
    (i32.add
      (i32.add (i32x4.extract_lane 0 (local.get $v)) (i32x4.extract_lane 1 (local.get $v)))
      (i32.add (i32x4.extract_lane 2 (local.get $v)) (i32x4.extract_lane 3 (local.get $v)))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $again (i32.lt_u (local.get $i) (local.get $n)))))
    (local.get $total))
  ;; One operand is 16384, so the ambiguous (-32768, -32768) pair is impossible.
  ;; The other operand is 0..255, making rounded multiplication ceil(i / 2).

  (func (export "bounded-q15-rounded-multiply") (param $n i32) (result i32)
    (local $i i32) (local $total i32)
    (block $done
      (br_if $done (i32.eqz (local.get $n)))
      (loop $again
        (local.set $total (i32.add (local.get $total) (i16x8.extract_lane_s 5
    (i16x8.relaxed_q15mulr_s
      (i16x8.splat (i32.and (local.get $i) (i32.const 255)))
      (i16x8.splat (i32.const 16384))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $again (i32.lt_u (local.get $i) (local.get $n)))))
    (local.get $total))
)

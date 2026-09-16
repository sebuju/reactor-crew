//! V8-parity transcendentals: Sun fdlibm cores (e_pow/e_exp/e_log/e_log10)
//! with V8 12.x edge semantics for `Math.pow`.
//!
//! The room/sec gates demand bitwise parity with Node's `Math.pow/exp/log`
//! (V8 does NOT call the system libm: it runs its own fdlibm-derived core,
//! which disagrees with the `libm` crate by 1 ulp on ~5-10% of inputs).
//! A 1-ulp `pow(h,4/3)` disagreement in liquid friction flips marginally
//! drained cells between 0 and 1e-16 kg, which `lqWriteP` then amplifies
//! into 1e5-scale pressure flips. So these must match V8 bit for bit.
//!
//! Verified by differential testing against Node (see tools/mathsweep.js).

const NEG_NAN_BITS: u64 = 0xFFF8000000000000;

#[inline]
fn neg_nan() -> f64 {
    f64::from_bits(NEG_NAN_BITS)
}

#[inline]
fn hiw(x: f64) -> i32 {
    (x.to_bits() >> 32) as u32 as i32
}

#[inline]
fn low(x: f64) -> u32 {
    (x.to_bits() & 0xffffffff) as u32
}

#[inline]
fn with_hi(x: f64, h: i32) -> f64 {
    f64::from_bits(((h as u32 as u64) << 32) | (x.to_bits() & 0xffffffff))
}

#[inline]
fn with_lo(x: f64, l: u32) -> f64 {
    f64::from_bits((x.to_bits() & 0xffffffff00000000) | l as u64)
}

// e_pow constants (hex from Sun fdlibm).
const BP0: f64 = 1.0;
const BP1: f64 = 1.5;
const DP_H1: f64 = f64::from_bits(0x3FE2B80340000000);
const DP_L1: f64 = f64::from_bits(0x3E4CFDEB43CFD006);
const THRD: f64 = f64::from_bits(0x3FD5555555555555);
const TWO53: f64 = f64::from_bits(0x4340000000000000);
const HUGE_POW: f64 = 1.0e300;
const TINY_POW: f64 = 1.0e-300;
const L1: f64 = f64::from_bits(0x3FE3333333333303);
const L2: f64 = f64::from_bits(0x3FDB6DB6DB6FABFF);
const L3: f64 = f64::from_bits(0x3FD55555518F264D);
const L4: f64 = f64::from_bits(0x3FD17460A91D4101);
const L5: f64 = f64::from_bits(0x3FCD864A93C9DB65);
const L6: f64 = f64::from_bits(0x3FCA7E284A454EEF);
const P1C: f64 = f64::from_bits(0x3FC555555555553E);
const P2C: f64 = f64::from_bits(0xBF66C16C16BEBD93);
const P3C: f64 = f64::from_bits(0x3F11566AAF25DE2C);
const P4C: f64 = f64::from_bits(0xBEBBBD41C5D26BF1);
const P5C: f64 = f64::from_bits(0x3E66376972BEA4D0);
const LG2: f64 = f64::from_bits(0x3FE62E42FEFA39EF);
const LG2_H: f64 = f64::from_bits(0x3FE62E4300000000);
const LG2_L: f64 = f64::from_bits(0xBE205C610CA86C39);
const OVT: f64 = 8.0085662595372944372e-17;
const CP: f64 = f64::from_bits(0x3FEEC709DC3A03FD);
const CP_H: f64 = f64::from_bits(0x3FEEC709E0000000);
const CP_L: f64 = f64::from_bits(0xBE3E2FE0145B01F5);
const IVLN2: f64 = f64::from_bits(0x3FF71547652B82FE);
const IVLN2_H: f64 = f64::from_bits(0x3FF7154760000000);
const IVLN2_L: f64 = f64::from_bits(0x3E54AE0BF85DDF44);

/// `scalbn`: x * 2^n, exact bit manipulation (only subnormal outputs in
/// `pow`, but correct generally).
fn scalbn(x: f64, n: i32) -> f64 {
    if x == 0.0 || !x.is_finite() || n == 0 {
        return x;
    }
    let bits = x.to_bits();
    let sign = bits & 0x8000000000000000;
    let mut exp = ((bits >> 52) & 0x7ff) as i64;
    let mut mant = bits & 0x000fffffffffffff;
    if exp == 0 {
        // subnormal input: normalize.
        let mut shift = 0i64;
        while mant & 0x0010000000000000 == 0 {
            mant <<= 1;
            shift += 1;
        }
        mant &= 0x000fffffffffffff;
        exp = 1 - shift;
    }
    let e2 = exp + n as i64;
    if e2 >= 0x7ff {
        return f64::from_bits(sign | 0x7ff0000000000000);
    }
    if e2 > 0 {
        return f64::from_bits(sign | ((e2 as u64) << 52) | mant);
    }
    // subnormal output (or underflow to zero).
    let sh = 1 - e2;
    if sh >= 64 {
        return f64::from_bits(sign);
    }
    let m = (mant | 0x0010000000000000) >> sh;
    f64::from_bits(sign | m)
}

/// Sun fdlibm `pow` core (V8's algorithm; edge cases handled by `pow`).
fn fd_pow(x: f64, y: f64) -> f64 {
    let (mut z, ax, mut z_h, mut z_l, mut p_h, mut p_l): (f64, f64, f64, f64, f64, f64);
    let (y1, mut t1, mut t2, mut r, mut s, mut t, mut u, mut v, mut w): (f64, f64, f64, f64, f64, f64, f64, f64, f64);
    let (mut i, mut j, mut k, mut yisint, mut n): (i32, i32, i32, i32, i32);
    let (hx, hy, ix, iy): (i32, i32, i32, i32);
    let (lx, ly): (u32, u32);

    let hx0 = hiw(x);
    let lx0 = low(x);
    let hy0 = hiw(y);
    let ly0 = low(y);
    hx = hx0;
    lx = lx0;
    hy = hy0;
    ly = ly0;
    ix = hx & 0x7fffffff;
    iy = hy & 0x7fffffff;

    // y==zero: x**0 = 1.
    if (iy | ly as i32) == 0 {
        return 1.0;
    }
    // NOTE: V8 has no x==1 early-out (unlike Sun): 1**y flows into the
    // NaN check, so 1**NaN propagates the NaN payload like any other base.
    // y!=zero: result is NaN if either arg is NaN.
    if ix > 0x7ff00000
        || (ix == 0x7ff00000 && lx != 0)
        || iy > 0x7ff00000
        || (iy == 0x7ff00000 && ly != 0)
    {
        return x + y;
    }

    yisint = 0;
    if hx < 0 {
        if iy >= 0x43400000 {
            yisint = 2;
        } else if iy >= 0x3ff00000 {
            k = (iy >> 20) - 0x3ff;
            if k > 20 {
                j = (ly >> ((52 - k) as u32)) as i32;
                if ((j as u32).wrapping_shl((52 - k) as u32)) == ly {
                    yisint = 2 - (j & 1);
                }
            } else if ly == 0 {
                j = iy >> (20 - k);
                if (j.wrapping_shl((20 - k) as u32)) == iy {
                    yisint = 2 - (j & 1);
                }
            }
        }
    }

    // special value of y.
    if ly == 0 {
        if iy == 0x7ff00000 {
            // y is +-inf; (|x|==1)**+-inf is NaN (V8: y-y, not Sun's 1).
            if ((ix - 0x3ff00000) | lx as i32) == 0 {
                return y - y;
            } else if ix >= 0x3ff00000 {
                return if hy >= 0 { y } else { 0.0 };
            } else {
                return if hy < 0 { -y } else { 0.0 };
            }
        }
        if iy == 0x3ff00000 {
            // y is +-1.
            if hy < 0 {
                return 1.0 / x;
            } else {
                return x;
            }
        }
        if hy == 0x40000000 {
            return x * x; // y is 2.
        }
        if hy == 0x3fe00000 {
            // y is 0.5.
            if hx >= 0 {
                return x.sqrt();
            }
        }
    }

    ax = x.abs();
    // special value of x.
    if lx == 0 {
        if ix == 0x7ff00000 || ix == 0 || ix == 0x3ff00000 {
            z = ax;
            if hy < 0 {
                z = 1.0 / z;
            }
            if hx < 0 {
                if ((ix - 0x3ff00000) | yisint) == 0 {
                    // (-1)**non-int is NaN (V8: signaling NaN).
                    return f64::from_bits(0x7FF0000000000001);
                } else if yisint == 1 {
                    z = -z;
                }
            }
            return z;
        }
    }

    n = ((hx as u32) >> 31) as i32 - 1;

    // (x<0)**(non-int) is NaN (V8 returns sNaN payload 1 here).
    if (n | yisint) == 0 {
        return f64::from_bits(0x7FF0000000000001);
    }
    s = 1.0;
    if (n | (yisint - 1)) == 0 {
        s = -1.0;
    }

    // |y| is huge.
    if iy > 0x41e00000 {
        if iy > 0x43f00000 {
            if ix <= 0x3fefffff {
                return if hy < 0 { HUGE_POW * HUGE_POW } else { TINY_POW * TINY_POW };
            }
            if ix >= 0x3ff00000 {
                return if hy > 0 { HUGE_POW * HUGE_POW } else { TINY_POW * TINY_POW };
            }
        }
        if ix < 0x3fefffff {
            return if hy < 0 { s * HUGE_POW * HUGE_POW } else { s * TINY_POW * TINY_POW };
        }
        if ix > 0x3ff00000 {
            return if hy > 0 { s * HUGE_POW * HUGE_POW } else { s * TINY_POW * TINY_POW };
        }
        t = ax - 1.0;
        w = (t * t) * (0.5 - t * (THRD - t * 0.25));
        u = IVLN2_H * t;
        v = t * IVLN2_L - w * IVLN2;
        t1 = u + v;
        t1 = with_lo(t1, 0);
        t2 = v - (t1 - u);
    } else {
        let (ss, mut s2, mut s_h, mut s_l, mut t_h, mut t_l): (f64, f64, f64, f64, f64, f64);
        n = 0;
        let mut axm = ax;
        let mut ixm = ix;
        if ixm < 0x00100000 {
            axm *= TWO53;
            n -= 53;
            ixm = hiw(axm);
        }
        n += (ixm >> 20) - 0x3ff;
        j = ixm & 0x000fffff;
        ixm = j | 0x3ff00000;
        if j <= 0x3988E {
            k = 0;
        } else if j < 0xBB67A {
            k = 1;
        } else {
            k = 0;
            n += 1;
            ixm -= 0x00100000;
        }
        axm = with_hi(axm, ixm);

        u = axm - if k == 0 { BP0 } else { BP1 };
        v = 1.0 / (axm + if k == 0 { BP0 } else { BP1 });
        ss = u * v;
        s_h = ss;
        s_h = with_lo(s_h, 0);
        t_h = 0.0;
        t_h = with_hi(t_h, ((ixm >> 1) | 0x20000000) + 0x00080000 + (k << 18));
        let bpk = if k == 0 { BP0 } else { BP1 };
        t_l = axm - (t_h - bpk);
        s_l = v * ((u - s_h * t_h) - s_h * t_l);
        s2 = ss * ss;
        r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
        r += s_l * (s_h + ss);
        s2 = s_h * s_h;
        t_h = 3.0 + s2 + r;
        t_h = with_lo(t_h, 0);
        t_l = r - ((t_h - 3.0) - s2);
        u = s_h * t_h;
        v = s_l * t_h + t_l * ss;
        p_h = u + v;
        p_h = with_lo(p_h, 0);
        p_l = v - (p_h - u);
        z_h = CP_H * p_h;
        z_l = CP_L * p_h + p_l * CP + if k == 0 { 0.0 } else { DP_L1 };
        t = n as f64;
        let dp_hk = if k == 0 { 0.0 } else { DP_H1 };
        t1 = ((z_h + z_l) + dp_hk) + t;
        t1 = with_lo(t1, 0);
        t2 = z_l - (((t1 - t) - dp_hk) - z_h);
    }

    // split up y into y1+y2 and compute (y1+y2)*(t1+t2).
    y1 = with_lo(y, 0);
    p_l = (y - y1) * t1 + y * t2;
    p_h = y1 * t1;
    z = p_l + p_h;
    j = hiw(z);
    i = low(z) as i32;
    if j >= 0x40900000 {
        if ((j - 0x40900000) | i) != 0 {
            return s * HUGE_POW * HUGE_POW;
        } else if p_l + OVT > z - p_h {
            return s * HUGE_POW * HUGE_POW;
        }
    } else if (j & 0x7fffffff) >= 0x4090cc00u32 as i32 {
        if ((j - 0xc090cc00u32 as i32) | i) != 0 {
            return s * TINY_POW * TINY_POW;
        } else if p_l <= z - p_h {
            return s * TINY_POW * TINY_POW;
        }
    }
    i = j & 0x7fffffff;
    k = (i >> 20) - 0x3ff;
    n = 0;
    if i > 0x3fe00000 {
        n = j.wrapping_add((0x00100000u32.wrapping_shr((k + 1) as u32)) as i32);
        k = ((n & 0x7fffffff) >> 20) - 0x3ff;
        t = 0.0;
        t = with_hi(t, n & !(0x000fffff_i32.wrapping_shr(k as u32)));
        n = (((n & 0x000fffff) | 0x00100000) >> ((20 - k) as u32)) as i32;
        if j < 0 {
            n = -n;
        }
        p_h -= t;
    }
    t = p_l + p_h;
    t = with_lo(t, 0);
    u = t * LG2_H;
    v = (p_l - (t - p_h)) * LG2 + t * LG2_L;
    z = u + v;
    w = v - (z - u);
    t = z * z;
    t1 = z - t * (P1C + t * (P2C + t * (P3C + t * (P4C + t * P5C))));
    // V8 divides by the combined denominator (Sun subtracts after dividing).
    r = (z * t1) / ((t1 - 2.0) - (w + z * w));
    z = 1.0 - (r - z);
    j = hiw(z);
    j = j.wrapping_add(((n as u32).wrapping_shl(20)) as i32);
    if (j >> 20) <= 0 {
        z = scalbn(z, n);
    } else {
        z = with_hi(z, j);
    }
    s * z
}

/// `Math.pow` with V8 12.x semantics (= the fdlibm core above; V8's edge
/// behavior lives in the core, not in a wrapper).
pub fn pow(x: f64, y: f64) -> f64 {
    fd_pow(x, y)
}

// e_exp constants.
const O_THRESH: f64 = f64::from_bits(0x40862E42FEFA39EF);
const U_THRESH: f64 = f64::from_bits(0xC0874910D52D3051);
const LN2HI0: f64 = f64::from_bits(0x3FE62E42FEE00000);
const LN2LO0: f64 = f64::from_bits(0x3DEA39EF35793C76);
const INVLN2: f64 = f64::from_bits(0x3FF71547652B82FE);
const TWOM1000: f64 = f64::from_bits(0x0170000000000000);
const HUGE_EXP: f64 = 1.0e300;

/// Sun fdlibm `exp` (= V8 `Math.exp` core).
pub fn exp(x: f64) -> f64 {
    let (mut y, mut hi, mut lo, c, mut t, twopk): (f64, f64, f64, f64, f64, f64);
    let (mut k, xsb): (i32, i32);
    let mut hx: u32;
    // Unreachable init: the |x|<2^-28 path always returns early, but the
    // compiler needs definite assignment (C would read garbage there).
    hi = 0.0;
    lo = 0.0;

    let mut xx = x;
    hx = (xx.to_bits() >> 32) as u32;
    xsb = ((hx >> 31) & 1) as i32;
    hx &= 0x7fffffff;

    if hx >= 0x40862E42 {
        if hx >= 0x7ff00000 {
            let lx = low(xx);
            if ((hx & 0xfffff) | lx) != 0 {
                return xx + xx;
            } else {
                return if xsb == 0 { xx } else { 0.0 };
            }
        }
        if xx > O_THRESH {
            return HUGE_EXP * HUGE_EXP;
        }
        if xx < U_THRESH {
            return TWOM1000 * TWOM1000;
        }
    }

    if hx > 0x3fd62e42 {
        if hx < 0x3FF0A2B2 {
            // V8 special-cases exp(1) to the correctly-rounded E.
            if xx == 1.0 {
                return f64::from_bits(0x4005BF0A8B145769);
            }
            let ln2hi = if xsb == 0 { LN2HI0 } else { -LN2HI0 };
            let ln2lo = if xsb == 0 { LN2LO0 } else { -LN2LO0 };
            hi = xx - ln2hi;
            lo = ln2lo;
            k = 1 - xsb - xsb;
        } else {
            let half = if xsb == 0 { 0.5 } else { -0.5 };
            k = (INVLN2 * xx + half) as i32;
            t = k as f64;
            hi = xx - t * LN2HI0;
            lo = t * LN2LO0;
        }
        xx = hi - lo;
    } else if hx < 0x3e300000 {
        if HUGE_EXP + xx > 1.0 {
            return 1.0 + xx;
        }
        k = 0;
    } else {
        k = 0;
    }

    t = xx * xx;
    if k >= -1021 {
        twopk = f64::from_bits((((0x3ff + k) as u32).wrapping_shl(20) as u64) << 32);
    } else {
        twopk = f64::from_bits((((0x3ff + (k + 1000)) as u32).wrapping_shl(20) as u64) << 32);
    }
    c = xx - t * (P1C + t * (P2C + t * (P3C + t * (P4C + t * P5C))));
    if k == 0 {
        return 1.0 - ((xx * c) / (c - 2.0) - xx);
    }
    y = 1.0 - ((lo - (xx * c) / (2.0 - c)) - hi);
    if k >= -1021 {
        if k == 1024 {
            return y * 2.0 * f64::from_bits(0x7FE0000000000000);
        }
        return y * twopk;
    }
    y * twopk * TWOM1000
}

// e_log constants.
const LN2_HI: f64 = f64::from_bits(0x3FE62E42FEE00000);
const LN2_LO: f64 = f64::from_bits(0x3DEA39EF35793C76);
const TWO54: f64 = f64::from_bits(0x4350000000000000);
const LG1: f64 = f64::from_bits(0x3FE5555555555593);
const LG2L: f64 = f64::from_bits(0x3FD999999997FA04);
const LG3: f64 = f64::from_bits(0x3FD2492494229359);
const LG4: f64 = f64::from_bits(0x3FCC71C51D8E78AF);
const LG5: f64 = f64::from_bits(0x3FC7466496CB03DE);
const LG6: f64 = f64::from_bits(0x3FC39A09D078C69F);
const LG7: f64 = f64::from_bits(0x3FC2F112DF3E5244);

// log10 constants (V8 form: single ivln10).
const IVLN10: f64 = f64::from_bits(0x3FDBCB7B1526E50E);
const LOG10_2HI: f64 = f64::from_bits(0x3FD34413509F6000);
const LOG10_2LO: f64 = f64::from_bits(0x3D59FEF311F12B36);

/// Sun fdlibm `log` (= V8 `Math.log` core).
pub fn log(x: f64) -> f64 {
    let (hfsq, mut f, s, z, r, w, t1, t2, dk): (f64, f64, f64, f64, f64, f64, f64, f64, f64);
    let (mut k, mut hx, mut i, j): (i32, i32, i32, i32);
    let lx: u32;

    let mut xx = x;
    let b = xx.to_bits();
    hx = (b >> 32) as u32 as i32;
    lx = (b & 0xffffffff) as u32;

    k = 0;
    if hx < 0x00100000 {
        if ((hx & 0x7fffffff) | lx as i32) == 0 {
            return -TWO54 / 0.0;
        }
        if hx < 0 {
            return (xx - xx) / 0.0;
        }
        k -= 54;
        xx *= TWO54;
        hx = hiw(xx);
    }
    if hx >= 0x7ff00000 {
        return xx + xx;
    }
    k += (hx >> 20) - 1023;
    hx &= 0x000fffff;
    i = (hx.wrapping_add(0x95f64)) & 0x100000;
    xx = with_hi(xx, hx | (i ^ 0x3ff00000));
    k += i >> 20;
    f = xx - 1.0;
    if (0x000fffff & (2 + hx)) < 3 {
        if f == 0.0 {
            if k == 0 {
                return 0.0;
            } else {
                dk = k as f64;
                return dk * LN2_HI + dk * LN2_LO;
            }
        }
        r = f * f * (0.5 - 0.33333333333333333 * f);
        if k == 0 {
            return f - r;
        } else {
            dk = k as f64;
            return dk * LN2_HI - ((r - dk * LN2_LO) - f);
        }
    }
    s = f / (2.0 + f);
    dk = k as f64;
    z = s * s;
    i = hx - 0x6147a;
    w = z * z;
    j = 0x6b851 - hx;
    t1 = w * (LG2L + w * (LG4 + w * LG6));
    t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
    i |= j;
    r = t2 + t1;
    if i > 0 {
        hfsq = 0.5 * f * f;
        if k == 0 {
            return f - (hfsq - s * (hfsq + r));
        } else {
            return dk * LN2_HI - ((hfsq - (s * (hfsq + r) + dk * LN2_LO)) - f);
        }
    } else {
        if k == 0 {
            return f - s * (f - r);
        } else {
            return dk * LN2_HI - ((s * (f - r) - dk * LN2_LO) - f);
        }
    }
}

/// V8 `Math.log10`: reduction + `ivln10 * log(x)` (NOT Sun's k_log1p form).
pub fn log10(x: f64) -> f64 {
    let (mut i, mut k, mut hx): (i32, i32, i32);
    let mut lx: u32;

    let mut xx = x;
    let b = xx.to_bits();
    hx = (b >> 32) as u32 as i32;
    lx = (b & 0xffffffff) as u32;

    k = 0;
    if hx < 0x00100000 {
        if (((hx & 0x7fffffff) as u32) | lx) == 0 {
            return f64::NEG_INFINITY;
        }
        if hx < 0 {
            return neg_nan();
        }
        k -= 54;
        xx *= TWO54;
        hx = hiw(xx);
        lx = low(xx);
    }
    if hx >= 0x7ff00000 {
        return xx + xx;
    }
    if hx == 0x3ff00000 && lx == 0 {
        return 0.0;
    }
    k += (hx >> 20) - 1023;

    // C++ evaluates (k & 0x80000000) as UNSIGNED, so this shift is logical:
    // i is 0 (k>=0) or +1 (k<0), never -1.
    i = (((k as u32) & 0x80000000) >> 31) as i32;
    hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
    let y = (k + i) as f64;
    xx = with_hi(xx, hx);
    xx = with_lo(xx, lx);

    let z = y * LOG10_2LO + IVLN10 * log(xx);
    z + y * LOG10_2HI
}

#[cfg(test)]
mod tests {
    use super::*;

    // Golden vectors recorded from Node 22 (V8 12.4) hot paths. These pin
    // V8-parity for every transcendental the sim routes through here; the
    // room/sec gates amplify even 1-ulp disagreements into hard failures.
    // (Known V8 quirk NOT covered: interpreted Math.pow(+0, odd-int) is -0;
    // optimized tiers give +0 like here, and no sim path feeds +0 with an
    // odd-integer exponent.)
    #[test]
    fn v8_parity_goldens() {
        let cases: &[(&str, u64, u64, u64)] = &[
            // friction / hull / sat-curve shapes actually exercised.
            ("pow", 0x3F710594C7EC5125, 0x3FF5555555555555, 0x3F45E4AD8F5413DE), // pow(hf,4/3)
            ("pow", 0x4000000000000000, 0x3FF5555555555555, 0x400428A2F98D728B), // pow(2,4/3)
            ("pow", 0x4077526666666666, 0x4010000000000000, 0x42120E77B70A9AA0), // pow(373.15,4)
            ("pow", 0x4059000000000000, 0x3FD0000000000000, 0x40094C583ADA5B52), // pow(100,0.25)
            ("pow", 0x3FE0000000000000, 0x3FE999999999999A, 0x3FE2611186BAE674), // pow(0.5,0.8)
            ("pow", 0x4004000000000000, 0x4010000000000000, 0x4043880000000000), // pow(2.5,4)
            ("pow", 0x3FF0000000000000, 0x7FF8000000000000, 0x7FF8000000000000), // 1**NaN propagates
            ("pow", 0xBFF0000000000000, 0x7FF0000000000000, 0xFFF8000000000000), // (-1)**inf
            ("pow", 0xC000000000000000, 0x3FE0000000000000, 0x7FF0000000000001), // (-2)**0.5 domain sNaN
            ("pow", 0x8000000000000000, 0x4008000000000000, 0x8000000000000000), // (-0)**3
            ("pow", 0x0000000000000000, 0x0000000000000000, 0x3FF0000000000000), // 0**0
            ("pow", 0x4000000000000000, 0xC090CC0000000000, 0x0000000000000000), // 2**-1075 underflow
            ("pow", 0x4024000000000000, 0xC073600000000000, 0x000012688B70E62B), // 10**-310
            ("pow", 0x3FF0000000000001, 0x400C000000000000, 0x3FF0000000000004), // (1+1ulp)**3.5
            ("exp", 0x3FF0000000000000, 0, 0x4005BF0A8B145769),                 // exp(1) special-cased
            ("exp", 0xBFE0000000000000, 0, 0x3FE368B2FC6F960A),                 // exp(-0.5)
            ("exp", 0x4085E00000000000, 0, 0x7F0D945DF4F8EC8E),                 // exp(700)
            ("exp", 0xC087480000000000, 0, 0x0000000000000001),                 // exp(-745 subnormal
            ("log", 0x3FF0000000000000, 0, 0x0000000000000000),                 // log(1)
            ("log", 0x3FE0000000000000, 0, 0xBFE62E42FEFA39EF),                 // log(0.5)
            ("log", 0x3E112E0BE826D695, 0, 0xC034B927F32BFFB8),                 // log(1e-9)
            ("log", 0x412E848000000000, 0, 0x402BA18A998FFFA0),                 // log(1e6)
            ("log10", 0x3FF0000000000000, 0, 0x0000000000000000),
            ("log10", 0x4024000000000000, 0, 0x3FF0000000000000),
            ("log10", 0x4059000000000000, 0, 0x4000000000000000),
            ("log10", 0x3FF8000000000000, 0, 0x3FC68A288B60B7FC),
            ("log10", 0x401D333333333333, 0, 0x3FEBA057434368C8),
            ("log10", 0x4000000000000000, 0, 0x3FD34413509F79FF),
        ];
        for (op, xb, yb, want) in cases {
            let got = match *op {
                "pow" => pow(f64::from_bits(*xb), f64::from_bits(*yb)).to_bits(),
                "exp" => exp(f64::from_bits(*xb)).to_bits(),
                "log" => log(f64::from_bits(*xb)).to_bits(),
                _ => log10(f64::from_bits(*xb)).to_bits(),
            };
            assert_eq!(got, *want, "{op}({xb:016x},{yb:016x})");
        }
    }
}

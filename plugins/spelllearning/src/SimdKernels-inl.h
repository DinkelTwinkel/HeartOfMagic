// SimdKernels-inl.h — Highway per-target SIMD implementations
//
// This file is included multiple times by SimdKernels.cpp via foreach_target.h,
// once per SIMD target (SSE2, SSE4, AVX2, AVX-512, etc.).
// Do NOT include this from PCH.h or any other translation unit.

#include "hwy/highway.h"
#include "hwy/contrib/dot/dot-inl.h"

HWY_BEFORE_NAMESPACE();
namespace SimdKernels {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

float DenseDotProductImpl(const float* HWY_RESTRICT a,
                          const float* HWY_RESTRICT b,
                          size_t count) {
    const hn::ScalableTag<float> d;
    // Use kPaddedToVector: caller guarantees RoundUpTo(count, Lanes(d))
    // elements are accessible (zero-filled padding).
    // kAtLeastOneVector: count >= Lanes(d) (vocab size is always >= 16).
    return hn::Dot::Compute<hn::Dot::kPaddedToVector | hn::Dot::kAtLeastOneVector>(
        d, a, b, count);
}

}  // namespace HWY_NAMESPACE
}  // namespace SimdKernels
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace SimdKernels {

HWY_EXPORT(DenseDotProductImpl);

float DenseDotProduct(const float* a, const float* b, size_t count) {
    return HWY_DYNAMIC_DISPATCH(DenseDotProductImpl)(a, b, count);
}

}  // namespace SimdKernels
#endif  // HWY_ONCE

#pragma once

#include <cstddef>

// =============================================================================
// SimdKernels — Highway runtime-dispatched SIMD operations
//
// Highway automatically selects the best available SIMD instruction set
// at runtime (SSE2, SSE4, AVX2, AVX-512), so the plugin works on all
// x86-64 hardware without requiring specific instruction set support.
// =============================================================================

namespace SimdKernels
{
    // Dense dot product of two float arrays.
    // Arrays must have at least `count` accessible elements.
    // For best performance, `count` should be padded to a multiple of 16
    // with zero-filled padding elements.
    float DenseDotProduct(const float* a, const float* b, size_t count);

    // Padding alignment for dense vectors (max SIMD lane count for float on x86-64)
    inline constexpr size_t kFloatPadding = 16;

    // Round up to a multiple of kFloatPadding
    inline constexpr size_t PadToSimd(size_t n) {
        return (n + kFloatPadding - 1) & ~(kFloatPadding - 1);
    }
}

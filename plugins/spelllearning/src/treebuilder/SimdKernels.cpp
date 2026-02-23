// SimdKernels.cpp — Highway foreach_target dispatch wrapper
//
// This file triggers Highway to compile SimdKernels-inl.h once per
// SIMD target (SSE2, SSE4, AVX2, AVX-512). At runtime, Highway
// automatically selects the best available target.
//
// IMPORTANT: This file must be excluded from unity builds and PCH.
// See CMakeLists.txt: SKIP_UNITY_BUILD_INCLUSION ON, SKIP_PRECOMPILE_HEADERS ON

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "SimdKernels-inl.h"
#include "hwy/foreach_target.h"

#include "SimdKernels-inl.h"

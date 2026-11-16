#include "FragmentKeepPolicy.h"
#include <cassert>
#include <cstdint>
#include <initializer_list>
using U = int64_t; // LayoutUnit's 1/64 CSS-pixel units, no floating rounding.
using namespace WebCore::PrintFragmentPolicy;
int main()
{
    constexpr U page=937*64, remaining=2708; // Real baseline: 42.3125px left.
    assert(firstFragmentShift(page,remaining,U{120*64},false)==remaining);
    assert(firstFragmentShift(page,page,U{120*64},false)==0);
    assert(firstFragmentShift(page,U{400*64},U{120*64},false)==0);
    assert(firstFragmentShift(page,remaining,page+1,false)==0); // Over-height first row.
    assert(firstFragmentShift(page,remaining,U{120*64},true)==0);
    assert(firstFragmentShift(U{0},remaining,U{120*64},false)==0);
    assert(firstFragmentShift(page,remaining,remaining,false)==0); // Exact fit.
    assert(firstFragmentShift(page,remaining,remaining+1,false)==remaining);
    assert(rowShift(page,U{910*64},U{40*64},U{30*64},false,false)==57*64);
    assert(rowShift(page,U{0},U{40*64},U{30*64},true,false)==30*64);
    assert(rowShift(page,U{30*64},U{40*64},U{30*64},true,false)==0); // Idempotent.
    assert(rowShift(page,U{100*64},U{40*64},U{30*64},false,false)==0);
    assert(rowShift(page,U{100*64},U{40*64},U{30*64},false,true)==867*64);
    assert(rowShift(page,U{0},page,U{30*64},true,false)==0);
    // A4/Letter and portrait/landscape budgets; preserve order and reserve
    // every continuation header without consuming an extra page at exact fit.
    for (U p : {U{937*64},U{880*64},U{640*64},U{600*64}}) {
        U y=100*64; U old=-1; const U h=30*64,row=40*64;
        for (int i=0;i<300;i++) {
            U delta=rowShift(p,y%p,row,h,y>=p,false); y+=delta;
            assert(y>old); assert(y%p+row<=p);
            if(y>=p) assert(y%p>=h);
            assert(rowShift(p,y%p,row,h,y>=p,false)==0);
            old=y;y+=row;
        }
    }
}

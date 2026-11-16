#include "PrintLinkAnnotationPolicy.h"
#include <cassert>
#include <vector>
struct Unit { int value; int rawValue() const { return value; } };
struct Rect {
    int a,b,c,d;
    Unit x() const { return {a}; } Unit y() const { return {b}; }
    Unit width() const { return {c}; } Unit height() const { return {d}; }
    bool isEmpty() const { return c<=0 || d<=0; }
    bool operator==(const Rect&) const = default;
};
struct Rectangles : std::vector<Rect> {
    using std::vector<Rect>::vector;
    void append(const Rect& r) { push_back(r); }
};
int main() {
    using WebCore::uniquePrintLinkFragments;
    Rect a{0,0,64,64},neighbor{64,0,64,64},near{1,0,64,64},overlap{32,0,64,64},nextline{0,64,64,64};
    Rectangles input{a,a,neighbor,near,overlap,nextline,a};
    assert((uniquePrintLinkFragments(input)==Rectangles{a,neighbor,near,overlap,nextline}));
    // New call (different page, paint phase, element or URL) cannot inherit a set.
    for (int page=0;page<4;++page) assert((uniquePrintLinkFragments(Rectangles{a,a})==Rectangles{a}));
    assert(uniquePrintLinkFragments(Rectangles{}).empty());
    assert(uniquePrintLinkFragments(Rectangles{{0,0,0,64},{0,0,64,-1}}).empty());
    Rectangles many;for(int i=0;i<100000;++i){many.append({i,0,64,64});many.append({i,0,64,64});}
    auto result=uniquePrintLinkFragments(many);assert(result.size()==100000);
    for(int i=0;i<100000;++i) assert((result[i]==Rect{i,0,64,64}));
}

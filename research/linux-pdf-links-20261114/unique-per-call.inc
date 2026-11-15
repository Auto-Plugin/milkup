// Research-only A/B candidate. No state survives this one collection.
template<typename Rectangles> Rectangles uniquePerCall(const Rectangles& input)
{
    Rectangles result;
    for (const auto& rect : input) {
        if (std::find(result.begin(), result.end(), rect) == result.end())
            result.append(rect);
    }
    return result;
}

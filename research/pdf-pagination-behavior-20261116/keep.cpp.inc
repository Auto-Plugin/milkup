// Only the minimum leading fragment participates in keep-with-next. Keeping
// a complete multi-page table unbreakable cannot satisfy this constraint.
static std::optional<LayoutUnit> leadingTableFragment(RenderBox& child)
{
    auto* wrapper = dynamicDowncast<RenderBlockFlow>(child);
    if (!wrapper || wrapper->childrenInline() || wrapper->isTransformed() || wrapper->isFloatingOrOutOfFlowPositioned())
        return std::nullopt;
    auto* heading = dynamicDowncast<RenderBox>(wrapper->firstChild());
    auto* table = heading ? dynamicDowncast<RenderTable>(heading->nextSibling()) : nullptr;
    if (!heading || !table || heading->isFloatingOrOutOfFlowPositioned() || heading->isTransformed()
        || table->isFloatingOrOutOfFlowPositioned() || table->isTransformed()
        || !heading->writingMode().isHorizontal() || !table->writingMode().isHorizontal())
        return std::nullopt;
    auto after = heading->style().breakAfter();
    if (after != BreakBetween::Avoid && after != BreakBetween::AvoidPage)
        return std::nullopt;
    auto* header = table->header();
    auto* body = table->firstBody();
    auto* firstRow = body ? body->firstRow() : nullptr;
    if (!header || !firstRow || heading->needsLayout() || table->needsLayout()
        || alwaysPageBreak(table->style().breakBefore()) || alwaysPageBreak(header->style().breakBefore())
        || alwaysPageBreak(body->style().breakBefore()) || alwaysPageBreak(firstRow->style().breakBefore())
        || alwaysPageBreak(header->style().breakAfter()))
        return std::nullopt;
    // This is the actual laid-out row bottom, including collapsed margins,
    // table borders and header/body offsets. No guessed CSS or font metrics.
    auto prefix = table->logicalTop() + body->logicalTop() + firstRow->logicalTop() + firstRow->logicalHeight();
    if (prefix <= heading->logicalTop() + heading->logicalHeight())
        return std::nullopt;
    return prefix;
}


// RESEARCH ONLY: same-process page boundaries for all controlled fixture kinds.
static void milkupCombinedPage(Document& document, int page, const char* phase, bool ready)
{
    if (!std::getenv("MILKUP_COMBINED_PROBE"))
        return;
    auto title = document.title();
    if (title != "MILKUP_PAGINATION_LAYOUT_V1"_s && title != "MILKUP_PRINT_LAYOUT_V1"_s
        && title != "MILKUP_DIGIT_RESEARCH"_s && title != "MILKUP_COMBINED_TEXT"_s)
        return;
    static unsigned records = 0;
    if (++records > 128 || page < 0 || page >= 64) {
        std::fprintf(stderr, "MILKUP_COMBINED {\"kind\":\"error\"}\n");
        return;
    }
    std::fprintf(stderr, "MILKUP_COMBINED {\"kind\":\"page\",\"phase\":\"%s\",\"page\":%d,\"printing\":%s,\"layoutReady\":%s}\n",
        phase, page + 1, document.printing() ? "true" : "false", ready ? "true" : "false");
    std::fflush(stderr);
}

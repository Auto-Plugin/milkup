# First corner smoke failure: stale pointer exposure

The first bottom-right vertical axis reached125, but horizontal stayed0 rather than69. Class range/blob/dimensions remained consistent. The preview moved upward220.8125CSSpx, leaving an11.6875CSSpx visible strip. Alignment had not started.

The harness currently chooses one pointer position for both axes and all batches. This creates a test-side stale-hit exposure. Existing records cannot prove the exact scroll-event cause or actual pointer trajectory, so this is not a product root-cause determination.

`summary.json` contains exact source hashes, observations, causal limits and the proposed test-only per-axis/per-batch hit refresh with original inputs and budgets. No files in the product tree were changed and no runtime was started.

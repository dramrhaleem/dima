# Inputs for the final web audit

Preliminary observations only. Complete the full audit before its remediation cycle.

## B5 rendered candidate — duplicate session controls

Observed on the current `dc5e818e939acaa2cef7dffae0be302df1b98c9c9626ae6c38abbdcc610fcd23` build screenshots (`.impeccable/review/b5-focus-desktop.png` and `b5-focus-mobile.png`): the global Focus dock duplicates the visible personal session timer and Pause/Finish controls. On narrow viewports its fixed area also covers part of the shared clock at the initial scroll position. This is visual clutter/viewport consumption, not evidence that content is unreachable; scrolling and viewport interaction need inspection in the final audit. Candidate refinement: show the dock when the main session controls are outside the usable viewport, preserving access elsewhere. No fix applied during this observation. This is an input to the post-stage full audit, not that completed audit or acceptance.

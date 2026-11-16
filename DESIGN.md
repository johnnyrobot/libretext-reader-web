# Passage annotation controls

This design applies only to the annotation workspace embedded in the existing LibreTexts textbook. The textbook, navigation, Listen and translation retain their existing design and owners.

Use the inherited font and restrained textbook blue. Primary actions use #005d85 with white text; body text uses #172b3a on white. Muted text #425766, borders #8ca9b8 and pale #f3f6f8 quote surfaces separate controls without decorative depth. Personal marks are warm yellow and course marks pale blue; visible audience text and row actions convey meaning independently of color.

The primary sequence is selected passage, explicit Highlight or Discuss, then deliberate Save or Post. The panel offers Discuss, My highlights and Find & export as named views. Exact quote/occurrence controls live in a native details element as a keyboard alternative. Keep the source visible and all annotation DOM outside main.

Desktop uses a 26rem side panel with an independently scrolling body. At 760px and below, use the existing source-preserving bottom-panel layout. Compact account/close controls leave space for tasks. The selection toolbar sits above the existing annotation entry, including during Listen. Controls have at least44px height and a visible3px focus ring. Keep focus on the user's current action during jumps and restore the entry on close.

Use explicit loading, acknowledgment, unknown-outcome, authorization and stale-source messages. Never display a validation error before submission or imply a failed refresh erased an acknowledged save. No decorative animation is needed for this task surface.

Discussion authors use a stable four-color accent palette derived from their account ID. Names remain visible and decorative initials are hidden from assistive technology; palette collisions convey no membership, role or permission. Replies use a single modest connector and indentation, without nested cards. The selected passage has a pale blue surface; the named question composer and its filled Post question button lead the course task. Reply actions use outlined buttons. In forced colors, names, indentation and a bordered initials marker preserve grouping.

LT-563 strengthens the structural hierarchy: participation uses continuous4px neutral leading rules with12–16px inner padding and named Passage context/Ask about this passage/Conversations headings. Account, views and refresh/visibility utilities form a separate unbarred band with horizontal separators. Replies and reply composers are indented20–24px within the conversation, with2px connectors at every viewport; no mobile flattening. Border widths, spacing, headings and forced-color CanvasText rules carry meaning independently of color. This explicitly requested structural device supersedes the previous modest one-pixel treatment.

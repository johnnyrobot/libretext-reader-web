# LibreTexts passage annotations

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Students reading existing LibreTexts textbooks, and instructors contributing within the admitted course. Current release uses an explicitly synthetic private audience. Anonymous visitors retain public reading.

## Product Purpose

Save exact passages for oneself, discuss them explicitly with the course, find and revisit permitted annotations, and export them without losing source identity. Primary interaction: select text, choose Highlight or Discuss, then revisit the mark or conversation.

## Capabilities and Constraints

Chief confirmed all five capabilities on2026-11-14: persistent passage highlights; visibility/overlap/jump controls; explicit personal/course separation; tags/search; portable standards-based JSON. Server authority enforces visibility, session membership, idempotency and exact revision/quote/range anchors. Stale targets never relocate by fuzzy matching. Existing discussions, drafts and receipts remain preserved. No import, realtime, grading or platform migration. LT551 unread is Todo/unimplemented, so no unread UI/count claim. CSV optional later.

## Operating Context

Annotation controls live inside existing textbook pages alongside existing Reader/Listen modes. The textbook DOM/content, typography/navigation and existing Listen/translation behavior remain intact. Only annotation-specific UI/helpers/tests and minimal annotation publisher asset handling are assigned here. LT555/PR20/source corrections remain paused.

## Brand Commitments

Preserve LibreTexts textbook identity. This replaces annotation controls/panel usability, not the general Reader visual system. Product labels make visibility and actions explicit.

## Accessibility & Inclusion

WCAG2.1AA implementation checks, keyboard creation/navigation, visible focus, text/status semantics, noncolour distinctions and responsive behavior are required. Actual VoiceOver remains SKIPPED BY OWNER; no whole-site conformance or spoken-delivery claim.

## Evidence on Hand

Live anonymous baseline inspected2026-11-14; screenshot and request/scope evidence in /Users/johnnyrobot/code/social-reading-plan/ANNOTATION-REDESIGN-IMPLEMENTATION-BRIEF.md. Source backend85c229b, Reader82c8fdf. Confirmed delegated product decisions are in Chief amendment12bdcd57. No testimonials or learning-gain claims.

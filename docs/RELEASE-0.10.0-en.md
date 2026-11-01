# Glossleaf 0.10.0 — Reading room

October 31, 2026. Built on 0.9.5; the older release is preserved.

The PDF reader now uses a single 44px header and a collapsible annotation dock. Select text for four instant highlight colours, underline, a margin note or copy; citations, excerpts, clipboard notes and translation live in More. Translation opens beside the original. T opens the dock, L opens contents/thumbnails/bookmarks, F enters focus mode, and Cmd/Ctrl+F searches the document.

The page navigator supports printed PDF labels, relative jumps, thumbnail previews, annotation ticks and bookmarks. You can set the first printed page in Document information. Notes and exported quotations use the printed label while keeping the physical PDF page for positioning.

Enter writes a note for the selection; N writes a page note. A 260px margin leaves the original clear. Compact windows use a lower drawer, then restore the reading position when it closes. Notes save after 0.8 seconds; new empty drafts create no records. The Notes button cycles between margins, the review list and hidden notes. The review list provides page groups, search and filters. The bundled WenKai font and existing Source Serif family work offline.

Local PDFs remain linked to their originals; no duplicate is added for normal reading. Printing opens the original in the system reader. Markdown can include or omit quoted source text. Standard PDF annotation embedding, OCR and two-way Zotero sync are not included.

**Back up before upgrading.** Schema 7 adds underline marks. The automatic pre-migration database snapshot does not replace a complete backup with attachments. Earlier schema-6 releases cannot directly open an upgraded library; restore a pre-upgrade backup to a separate library to roll back.

This is an ad-hoc signed Apple Silicon preview, without notarization. All verification uses isolated synthetic documents and local/mock services; paid provider accounts, restricted publishers and other platforms remain unverified. See the verification JSON for exact test results and the scope of the 200-page scrolling measurement.

Verification: 93 data/unit tests and 10 native desktop suites passed. A 200-page text PDF with 200 margin notes averaged 59.92fps during an 18,000px continuous wheel sample on this machine. This is a bounded synthetic measurement, not a guarantee for arbitrary PDFs or hardware.

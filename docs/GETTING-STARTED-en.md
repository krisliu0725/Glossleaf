# Glossleaf 0.9.3 · Getting started

Glossleaf keeps your reading and research in a local library. Its Chinese name, 笺, refers to a sheet of letter paper.

## Two places to return to

Use the **Library / Memoir** switch beside Settings at the top of either home page. Import is available in Library. Library holds your references and reading materials. Memoir brings together reading time, visited text, research interests, library activity, and model usage.

Search the Library by reference details, full text, or excerpts. Open an attachment with **Read**, a double-click, or Command-O. Long titles have two lines of space; hover over one or select it to see more. Collections and tags keep the same visual hierarchy.

## Citations and export

Select a document and open **Document actions → Cite and export**. Select multiple rows to export a selection.

Choose **GB/T 7714—2015**, **APA 7**, **MLA 9**, **Chicago Author–Date**, or **IEEE**. The panel shows a bibliography and an in-text citation. You can copy either; bibliography copying includes both plain text and rich HTML, preserving italics in compatible editors. Quick copy remembers your most recently selected style on this device.

Export a plain-text or HTML bibliography, RIS, BibTeX, CSL-JSON, or saved excerpts in Markdown / JSON. RIS and BibTeX are reference exchange formats; they do not contain PDFs or replace a full library backup.

## Find reliable reference details

Open **Document actions → Edit & find metadata → Find & enrich reference metadata**.

1. Glossleaf checks the first two indexed PDF pages for DOI hints on this device. If text has not been indexed, enter a DOI or search by the full title.
2. Review the visible query. Only that DOI or title is sent to Crossref or DataCite; the PDF and notes are not sent.
3. A DOI lookup returns an identifier match. A title search offers up to six suggestions ranked by title similarity. Verify the authors, year, and publication yourself.
4. Choose a suggestion. Empty fields are selected by default; existing values are kept. Select any existing fields you want to replace.
5. Apply the selected fields, check the editing form, then save.

Metadata coverage varies. Some Chinese journals and works without DOIs are absent from these public databases. Use manual editing or import the reference from your existing Zotero library when needed. No result is better than invented authorship.

## Choose your model service

Settings → Translation includes **DeepSeek, OpenAI / GPT, Anthropic / Claude, Google Gemini, Gemma, Kimi (global and China), Ollama**, and a custom option.

The endpoint, protocol, model ID, API key, target language, instructions, timeout, and supported sampling settings remain editable. For newly added services, load the account’s model list or enter an available model ID. A provider preset does not grant access to a model. Claude uses the native Anthropic Messages protocol; compatible APIs use Chat Completions.

Keys are encrypted separately for each protocol and endpoint. Changing the endpoint clears the draft key and cloud consent. Authorize a cloud service before translating or testing a sample sentence. Model discovery does not send a document. Leave Temperature blank for the service default; Claude’s current native protocol does not send that parameter.

Automatic translation is off by default. Original, Parallel, and the experimental interlinear mode remain available. The sidebar now has Translation and Notes tabs. Interface language is independent of document language and the translation target.

## Appearance and data

The interface pairs Source Serif 4 with a Chinese serif fallback. Source Serif is included for offline use; system fonts are referenced, never redistributed. Settings controls use the same spacing, arrows, and typography as the rest of the application.

Memoir groups activity by local dates without displaying technical timezone labels. Settings → Advanced & Diagnostics controls local activity tracking, usage exports, diagnostics, and cache maintenance. Unknown token usage stays unknown; reported usage is separate from estimates.

Create a full backup in **Library & Backup** before moving or restoring a library. Removed documents remain recoverable in Trash. The macOS preview uses local ad-hoc signing and is not notarized.


## Link your files, keep your space

Choose **Import → Link local files**, or drag a local document into Library. Glossleaf reads the original instead of making another attachment copy. Zotero import follows the same rule. The attachment’s **Linked original** label makes this visible; documents fetched online are labelled **Library file**.

Keep linked originals in a stable folder. If you move one, use **Locate original file** beside its attachment. Select the same content so existing annotations and reading position remain attached to the correct version. If you edit the document itself, import it again to create a new version. Removing a Library record does not delete the original.

Older copies already held inside a Glossleaf library are kept. This update does not silently delete existing files. Databases, indexes, translation caches and explicit backups still need disk space.

## Add a reference and fetch its full text

Choose **Import → Find by title or DOI**. You can also paste a filename; the final .pdf suffix is removed for the search. Select a candidate, verify its authors and publication details, and add it. **Download available full text after adding** is enabled by default.

Glossleaf looks up the confirmed DOI in OpenAlex and publisher-deposited PDF links. A valid accessible PDF is saved once inside Library. If a publisher blocks access or no direct PDF is available, your reference stays saved. Use **Document actions → Find and download full text** to retry, or **Link a local attachment** to use a file you already have. Downloads can be cancelled.

This search sends the DOI or title to public metadata services. It does not send your local PDF or notes. Automatic download depends on the source’s access rules; it cannot retrieve every article.

A **full backup** explicitly includes linked originals inside the backup, so restoring it does not require their old paths. Missing or changed originals must be resolved before a full backup can succeed. The live library keeps its links. Finish or cancel downloads and other background work before restoring. The update moves the library to schema 6; close older app versions before upgrading and use 0.9.0 or later afterward.

## Read, highlight, and write in the margin

Select PDF text to highlight it, add a margin note, or translate it. **H** uses the current highlight slot; **1–6** selects a numbered color. Choose from seven six-color palettes in Settings → Reading & Appearance. Opacity ranges from 25% to 55%; changing the palette affects future highlights, while existing colors stay intact.

Press **N** with text selected to write a note about that passage. Without a selection, N lets you place a note at a point on the page, including a scanned page. Notes save after 600 ms of inactivity. Command-Enter saves and closes; Escape saves and returns focus to the page marker. Empty new notes are discarded. Deleting a highlight keeps its linked notes.

Nearby margin markers gather into a count; open the group to select a particular note. The editor leaves your Translation tab and reading position intact. Command-Z and Command-Shift-Z undo and redo annotation operations during the current reading session.

The **Notes** tab combines excerpts and margin notes with All / Excerpts / Margin Notes filters. Export the current filter or selected items as Markdown, or copy them. These exports contain text and page references; a full library backup preserves the complete annotation data and original files.

## Your mark, in your preferred color

Reading & Appearance offers six Logo V3 colorways. The mark adapts to the light or dark interface, while action and note colors keep their meaning. The macOS Dock icon uses the default Ink & Vermilion mark. Chinese shows the mark with 笺; English shows it with Glossleaf.

## A more comfortable workspace in 0.9.1

Import sits before the Library / Memoir switch in Library. Memoir keeps the switch and Settings in the same position and has no Import button. Comfortable list spacing is the default; View still offers a compact option.

The sidebar starts with six frequently used tags. Expand the heading to see all tags, including those attached to one document. There are no count or name filters; the underlying tags stay intact.

In the reader, open the three-dot Reading options menu for Find; Command-F still works. Fit width uses the actual pane width. Zoom preserves the reading point, and trackpad gestures keep their focal point. The previous image remains visible while a sharper image is prepared.

Right-click selected source text to copy, highlight, translate, or add a note. Right-click a blank point to place a note there. Translation menus offer copy, edit, translation and annotation actions; paragraph detection repair is under its own secondary entry. Margin notes appear as a small speech bubble with a clear click target. Saving a highlight is silent.

Selected controls have a light surface, open menus and pressed buttons give visible feedback, and keyboard focus has its own outline. Translation and Notes panels have paper-like surfaces with their actions inside each card. The Mac window controls sit in a separate native title bar, outside the application content. The app toolbar uses a modest 60px height with a restrained serif title and 24px left inset. Full screen is managed by macOS.

## Clearer controls and complete scrolling in 0.9.2

The search scope at the end of the Library search field is a button. Open it to choose All, reference details, full text, or excerpts. Its menu marks the current scope. Memoir navigation keeps icons separate from their labels; each page scrolls to its final section, including research topics and fields. Changing sections returns to the top.

Daily / Weekly uses a segmented control with visible selected and pressed states. Action buttons have softened corners, a clear boundary, and feedback when pressed. Research labels and statistical values remain plain information; use the separate search button beside a topic to find related references. Teal accents identify controls and activity, while vermilion and ochre remain restrained supporting colors.

Select PDF text to open the labeled palette: **Copy, Highlight, Margin note, Translate, Paste**, and **Dismiss**. Copy keeps the selected text, including its line breaks. Paste opens a margin note at that selection and inserts clipboard text into its editor. It saves automatically after 600 ms. Paste does not modify the PDF; ordinary keyboard paste also works inside the note editor. Clipboard text is read only when you request Paste; empty or overlong text produces an inline message.

The selection overlay uses a light continuous fill for each line so the source text stays readable. Notes use a small speech-bubble marker; open one to edit it, or expand a grouped marker to choose a note. Close and Back controls now have visible button boundaries. The floating selection palette stays within the window when resized. Light and dark themes and both interface languages use the same control rules.

## The current workspace in 0.9.3

Memoir has three separate pages: **Journal** for reading time and visited text, **Themes** for topics and confirmed fields, and **Ledger** for model usage and library activity. The repeated Preface page has been removed. Rename your local profile in Settings → General.

Journal adds a daily reading-time / page-visits chart beside the existing calendar. Themes shows topic and field rankings with document-count and reading-time views. Ledger adds a reported-token trend, usage by model, and request outcomes. Hover over charts or focus a trend and use the arrow keys; expand **View chart data** for the exact source values. Unknown token usage stays unknown and creates gaps in the trend. Topic counts overlap and must not be added together.

The reader now has a compact second toolbar. Choose **Select**, enable **Highlight** to mark successive passages, or use **Margin note** to annotate a selection or a point on the page. Undo, redo, citations, note export, zoom, fit width, rotation and page navigation are available directly. Press Escape to leave Highlight mode. Find remains under Reading options or Command-F.

A selection opens a small sheet labelled **Selected passage** or **Selected translation**. Copy, highlight, comment and translate are primary actions. **Copy with citation** adds page references and a bibliography entry using the current citation style; **Save excerpt** stores a source-linked passage; **Paste as note** inserts clipboard text into a new margin note. PDF files remain read-only. For APA, MLA, GB/T, Chicago or IEEE settings and a formatted preview, open **Cite and export** from the reading toolbar.

Controls use restrained corners and thin ink-like boundaries. Translation / Notes and note filters use tab lines rather than individual pill buttons. Menus fit within the window even when opened from a scrolling pane.

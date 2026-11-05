---
version: 1
slug: "apps-mobile"
primary_target: "apps/mobile"
related_targets: []
---

Scope: the whole Nimbus Android app, Operate mode, phone-first with tablets usable. Audience, job and constraints are in apps/mobile/PRODUCT.md. Build path: code-led. The user's standing requirement: professional, smooth, easy to navigate and use.

## Direction contract

THESIS: Google Drive's Android layout, built to Nimbus's finish, so a Drive switcher knows where everything is before noticing the app. It refuses a web page squeezed onto a phone and any novelty navigation.

OWN-WORLD: DESIGN.md's neutral dark greys with hairline borders, near-white filled primary, Geist with tabular sizes, teal only for brand, selection and status, file-type hues only on file icons. Outlined tiles, 12dp card radius, full-pill search, Material 3 structure themed through these tokens.

STORY: The user opens the app, sees their files at once from cache, finds one by search or chips, taps to open, long-presses to act on several, and trusts backup without checking. They always know which server and account they are on.

FIRST VIEWPORT: Status bar, then a 56dp search pill with the account avatar inside its right end. Below it a scrolling row of filter chips: Type, Modified, Size, Tags. Then a row with the sort label on the left and grid/list toggle on the right. "Folders" as compact two-column one-row tiles, then "Files" as two-column cards with 4:3 thumbnails. Extended "New" FAB bottom-right, above a five-tab navigation bar: Files, Recent, Shared, Starred, More. Tablets swap the bar for a navigation rail and widen the grid.

FORM: chosen form: Google Drive standard, position 1 on the safer list. seed:82be718f2a11a3fd. Signature move: the avatar in the search pill wears a thin ring that is the backup state: teal progress while uploading, a complete teal ring when backed up, destructive when failing. Tapping it opens the account sheet naming the server. Motion grammar: Material container transform from tile to previewer, shared-axis for folder depth, FAB shrinks to an icon on scroll, all honouring the system's remove-animations setting.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

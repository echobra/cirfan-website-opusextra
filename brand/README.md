<!-- brand/README.md -->
# Brand sources

Vector sources for the logo. Open in Figma, Illustrator or Inkscape. Text is already converted to outlines.

- `logo-ink.svg`: lockup for light backgrounds (navy #111A2E)
- `logo-chalk.svg`: lockup for dark backgrounds (chalk #ECE8DF)
- `mark-ink.svg`, `mark-chalk.svg`: the tape measure "c" on its own
- `app-icon.svg`: favicon and app icon tile

Typeface: Bodoni Moda (wordmark and headings), Jost (body). Both SIL Open Font License.
Colors: oxford #E9EEF4, navy ink #111A2E, red pencil #9B3426, worsted #0E1628, chalk #ECE8DF, chalk yellow #E2CB7E.

If you export new PNGs, keep the names in `/public` the same (`logo.png`, `logo-on-dark.png`, `logo-mark.png`, `logo-mark-on-dark.png`) and keep the lockup ratio at 3.25:1, or update `src/components/Logo.astro`.

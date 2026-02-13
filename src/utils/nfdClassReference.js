/**
 * Condensed reference of all nfd-* utility classes from the site's design system.
 * Derived from wp-module-patterns/source/styles/utilities.css.
 *
 * Injected into editor context on-demand when blocks contain nfd-* classes,
 * so the AI knows exact CSS values and which classes to preserve.
 */
export const NFD_CLASS_REFERENCE = `## NFD Utility Classes Reference

IMPORTANT: Always prioritize native WordPress block options (color, typography, spacing settings in the block comment attributes) over nfd-* utility classes. Only use nfd-* classes when there is no native WP option to achieve the desired style. When editing existing blocks, preserve nfd-* classes that are already present unless the user explicitly asks to change them.

### Container
nfd-container — controls section width (default 1200px content, 1340px wide). NEVER remove.

### Themes — DEPRECATED (do NOT add these to new or edited blocks; preserve on existing blocks only)
nfd-theme-white — DEPRECATED. Use WP block background/text color settings instead.
nfd-theme-light — DEPRECATED. Use WP block background/text color settings instead.
nfd-theme-dark — DEPRECATED. Use WP block background/text color settings instead.
nfd-theme-darker — DEPRECATED. Use WP block background/text color settings instead.
nfd-theme-primary — DEPRECATED. Use WP block background/text color settings instead.

### Colors (theme-aware via CSS vars — preserve unless user asks to change)
nfd-bg-surface — background:var(--wndb--color--surface), text:var(--wndb--color--text)
nfd-bg-primary / nfd-bg-accent — background:var(--wndb--color--primary), text:white
nfd-bg-subtle — background:var(--wndb--color--borders-light), text:contrast
nfd-text-faded — color:var(--wndb--color--text--faded)
nfd-text-contrast — color:var(--wndb--color--text--contrast)
nfd-text-primary — color:var(--wndb--color--primary)
nfd-text-secondary — color:var(--wndb--color--secondary)
nfd-text-current — color:currentColor
nfd-text-subtle — color:var(--wndb--color--subtle)

### Spacing — Padding (scaled by --wndb--padding-factor)
nfd-p-xs=0.75rem  nfd-p-sm=1.5rem  nfd-p-md=2rem  nfd-p-lg=clamp(3.5rem,7vw,6.25rem)
nfd-py-xs nfd-py-sm nfd-py-md nfd-py-lg — padding-block at same scale
nfd-px-xs nfd-px-sm nfd-px-md — padding-inline at same scale
nfd-pt-xs nfd-pt-sm nfd-pt-md nfd-pt-lg — padding-block-start
nfd-pb-sm nfd-pb-md nfd-pb-lg — padding-block-end
nfd-pl-sm — padding-left:1.5rem
Card variants: nfd-p-card-sm(0.75rem 1.5rem) nfd-p-card-md(1.5rem 2rem) nfd-p-card-lg(2rem 2rem, desktop:2rem 3rem)
nfd-p-card-square=2.5rem  nfd-p-card-square-lg=2.5rem(desktop:4rem)
Tailwind overrides: nfd-p-0 nfd-p-2(0.5rem) nfd-p-4(1rem) nfd-p-8(2rem) nfd-p-10(2.5rem)
nfd-px-0 nfd-px-4(1rem) nfd-px-8(2rem) nfd-py-0 nfd-py-4(1rem) nfd-py-5(1.25rem) nfd-pt-0

### Spacing — Margin
nfd-my-0=0  nfd-mb-8=2rem  nfd-mt-8=2rem  -nfd-mx-2=-0.5rem

### Gap (scaled by --wndb--gap--scale-factor)
nfd-gap-0=0  nfd-gap-xs=0.25rem  nfd-gap-sm=0.5rem  nfd-gap-md=1rem  nfd-gap-lg=1.5rem
nfd-gap-xl=2rem  nfd-gap-2xl=2.5rem  nfd-gap-3xl=3.5rem  nfd-gap-4xl=6rem
Axis: nfd-gap-x-lg nfd-gap-x-4xl — column-gap; nfd-gap-y-lg nfd-gap-y-xl nfd-gap-y-2xl nfd-gap-y-3xl — row-gap

### Typography
nfd-text-xs=0.75rem(letter-spacing:0.05em)
nfd-text-sm=0.875rem
nfd-text-base=1rem(line-height:1.6)
nfd-text-md=1.125rem(line-height:1.6)
nfd-text-lg=1.5rem(line-height:1.4, font-weight:500)
nfd-text-xl=2.375rem(line-height:1.25, letter-spacing:-0.01em, font-weight:500)
nfd-text-huge=clamp(2.75rem,1.47rem+2.5vw,3.5rem)(line-height:1.1, letter-spacing:-0.025em, font-weight:500)
nfd-text-giga=clamp(3.25rem,2.55rem+2.25vw,4.375rem)(line-height:1.1, letter-spacing:-0.04em, font-weight:500)
nfd-text-balance — text-wrap:balance + max-width:min(65ch,1100px)
nfd-text-pretty — text-wrap:pretty
nfd-max-w-prose — max-width:min(65ch,1100px)
nfd-text-left — text-align:left

### Border Radius (scaled by --wndb--rounded--scale-factor)
nfd-rounded-none=0  nfd-rounded-sm=0.25rem  nfd-rounded / nfd-rounded-md=0.5rem
nfd-rounded-lg=0.75rem  nfd-rounded-xl=1rem  nfd-rounded-full=9999px
Top variants: nfd-rounded-t-md nfd-rounded-t-lg nfd-rounded-t-xl

### Shadows
nfd-shadow-xs=0 1px 2px 0 rgba(18,18,23,0.065)
nfd-shadow-sm=0 1px 3px 0 rgba(18,18,23,0.1), 0 1px 2px 0 rgba(18,18,23,0.06)

### Buttons (on wp-block-button wrapper — NEVER remove)
Size: nfd-btn-sm nfd-btn-lg nfd-btn-xl nfd-btn-wide
Variant: nfd-btn-secondary nfd-btn-tertiary

### Dividers (section shape dividers — NEVER remove)
nfd-divider-arrow(16px) nfd-divider-clouds(150px) nfd-divider-ellipse(50px)
nfd-divider-rounded(50px) nfd-divider-slant / nfd-divider-slant-invert(80px)
nfd-divider-triangle(80px) nfd-divider-zigzag(8px)

### Animations (entrance animations — NEVER remove)
nfd-wb-fade-in-bottom(1200ms) nfd-wb-fade-in-bottom-short(600ms)
nfd-wb-fade-in-top-short(600ms) nfd-wb-fade-in-left-short(600ms) nfd-wb-fade-in-right-short(600ms)
nfd-wb-zoom-in(1200ms) nfd-wb-zoom-in-short(600ms)
nfd-wb-twist-in(1000ms) nfd-wb-reveal-right(1500ms)
Delays: nfd-delay-{50,150,300,450,600,750,900,1050,1200,1350,1500}

### Background Effects (decorative CSS patterns — NEVER remove)
nfd-bg-effect-dots nfd-bg-effect-grid nfd-bg-effect-grid-perspective
nfd-bg-effect-grid-2 nfd-bg-effect-grid-3 nfd-bg-effect-lines nfd-bg-effect-lines-2
nfd-bg-effect-position-center nfd-mask-opacity-0

### Masks
nfd-mask-fade-to-b — gradient mask on cover overlay (top transparent → bottom opaque)
nfd-mask-radial-center — radial gradient mask on cover overlay

### Layout
nfd-grid=display:grid  nfd-grid-cols-2 nfd-grid-cols-11 nfd-grid-cols-12 nfd-grid-rows-1
nfd-col-start-{1-7} nfd-col-end-{7-13} nfd-row-start-1
nfd-items-center=align-items:center  nfd-shrink-0 nfd-grow=flex-grow:1
nfd-h-full=height:100%  nfd-w-full=width:100%  nfd-aspect-video=16/9
nfd-overflow-hidden  nfd-relative

### Responsive (mobile ≤782px overrides)
md:nfd-order-2 md:nfd-my-0 md:nfd-flex md:nfd-hidden md:nfd-basis-full
md:nfd-grid-cols-1 md:nfd-flex-wrap md:nfd-items-start md:nfd-justify-start
md:nfd-justify-end md:nfd-justify-center md:nfd-gap-5(1.25rem) md:nfd-gap-8(2rem)
md:nfd-self-start md:nfd-rounded-lg(0.5rem) md:nfd-border-none
md:nfd-p-0 md:nfd-px-0 md:nfd-py-0 md:nfd-text-left md:nfd-text-center

### Misc
nfd-absolute-header — position:absolute overlay header
nfd-pseudo-play-icon — CSS play button overlay
nfd-backdrop-blur-sm=blur(4px)  nfd-backdrop-blur-md=blur(8px)
nfd-border-b nfd-border-2 nfd-border-strong nfd-border-bg nfd-border-primary nfd-border-inherit
nfd-overlap-x — negative margin overlap for stacked items
nfd-stretch-cover-child — flex stretch cover inner container
nfd-list-check — checkmark list style
nfd-text-opacity-80 — 80% text opacity
nfd-scroll-slider-vertical / nfd-scroll-slider-horizontal — CSS scroll-snap sliders`;

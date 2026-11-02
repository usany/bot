---
name: brand-colors
description: Official brand colors (crimson, blue, gold, gray, silver) with RGB and HEX values. Use whenever styling, choosing colors, theming, or applying the brand-accurate palette to UI, CSS, SVG, charts, docs, or graphics.
---

# Brand Colors

Official brand identity palette. Use these exact values for any
styling, theming, or branding work.

## Primary Colors

### Crimson (Main)

- **RGB:** R164 G15 B22
- **HEX:** `#A40F16`

### Blue (PANTONE 295 C)

- **RGB:** R13 G50 B111
- **HEX:** `#0D326F`

### Gold (PANTONE 872 C)

- **RGB:** R192 G163 B83
- **HEX:** `#C0A353`

## Sub Colors

### Cool Gray (PANTONE Cool Gray 11C)

- **RGB:** R113 G113 B113
- **HEX:** `#717171`

### Silver (PANTONE 877 C)

- **RGB:** R181 G181 B181
- **HEX:** `#B5B5B5`

## Quick reference

| Name       | RGB             | HEX       | Role     |
|------------|-----------------|-----------|----------|
| Crimson    | 164, 15, 22     | `#A40F16` | Primary  |
| Blue       | 13, 50, 111     | `#0D326F` | Primary  |
| Gold       | 192, 163, 83    | `#C0A353` | Primary  |
| Cool Gray  | 113, 113, 113   | `#717171` | Sub      |
| Silver     | 181, 181, 181   | `#B5B5B5` | Sub      |

## Usage

Prefer Crimson as the dominant brand color; use Blue and Gold as secondary
accents; use Cool Gray and Silver for neutral text, borders, and backgrounds.

### CSS variables

```css
:root {
  --kh-crimson: #A40F16;
  --kh-blue: #0D326F;
  --kh-gold: #C0A353;
  --kh-gray: #717171;
  --kh-silver: #B5B5B5;
}
```

### Tailwind (if used)

```js
colors: {
  "kh-crimson": "#A40F16",
  "kh-blue": "#0D326F",
  "kh-gold": "#C0A353",
  "kh-gray": "#717171",
  "kh-silver": "#B5B5B5",
}
```

## Notes

- Use HEX (or the equivalent RGB) directly; do not approximate by eye.
- For print/PANTONE matches, Crimson corresponds to the main identity red,
  Blue to PANTONE 295 C, Gold to PANTONE 872 C, Cool Gray to Cool Gray 11C,
  and Silver to 877 C.

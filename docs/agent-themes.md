# Fonts and themes

Text normally carries `role-title`, `role-heading`, `role-body`,
`role-caption`, or `role-base`. Use a deliberate inline style for one object, a
class outside the generated block in `theme.css` for a reusable local treatment,
and a theme for role-wide or deck-wide changes.

## Create and apply a theme

    slide-agent theme list .
    slide-agent theme show . --id <closest-preset> > /tmp/deck-theme.json
    # edit id, name, fonts, palette and colors
    slide-agent theme create . --spec /tmp/deck-theme.json
    slide-agent theme apply . --id <new-id> --scope deck

Creating installs a preset but changes no slide. `theme choose` changes what new
slides inherit while preserving existing slides. `theme apply` restyles existing
slides and makes the theme current.

Narrow an adoption when the request is specific:

    slide-agent theme apply . --id <id> --scope deck \
      --roles title,heading --properties fonts,weights

    slide-agent theme apply . --id <id> --scope slides --slide 4,7 \
      --properties fonts,weights,scale

Other properties are `text-color`, `background`, and `object-colors`.
`--keep-overrides` preserves inline styling. `--detect-roles` is for legacy text
without role classes. Use `theme create --replace` while iterating on a custom
preset. `-dark` and `-light` select generated variants.

Never edit between the generated theme markers in `theme.css`; theme commands
replace that block. Hand-written rules belong outside it.

`asset import` does not import fonts. To carry a licensed webfont, copy `.woff2`
files into `assets/fonts/`, declare them with `@font-face` in `theme.css`, and
provide a fallback stack for the presentation machine.


## Templates

A template is a whole deck design kept apart from any one talk: the theme and
the type and colour choices made on it, the deck's own themes and layouts, the
layout masters, page numbers, slide size and the hand-written rules in
`theme.css`. Templates live in `~/.deckwerk/templates`, shared with the
editor's File › Save as Template.

    slide-agent template list
    slide-agent template save . --name "Lab talks"          # --replace to overwrite
    slide-agent template new ../next-talk --template lab-talks --title "Next talk"
    slide-agent template apply . --template lab-talks

`new` writes a fresh deck folder with one slide on the template's title layout.
`apply` restyles every existing slide like a deck-wide `theme apply`, adds the
template's layouts (replacing any with the same id) and appends its CSS rules
after the deck's own; the slide size is never changed.

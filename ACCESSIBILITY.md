# Accessibility

Waypoint aims for WCAG 2.2 AA. This report says what has been verified, by whom and how, and what has not.

**Status on 2026-11-09:** the automated checks pass, and the owner has gone through the hub with VoiceOver with no deviations. The real Azure DevOps page, in the dark theme and in Azure DevOps' high contrast themes, is still to be checked. See [What has not been verified](#what-has-not-been-verified).

## Results

| Check | How | By | Result |
| --- | --- | --- | --- |
| axe-core 4.14 in jsdom | In the test suite, for the hub, its messages, the filter row, dropdowns, the detail panel and the settings panel (`npm test`). jsdom cannot measure contrast. | Automated, on every pull request | No violations |
| axe-core 4.14 in real Chrome, with contrast | 11 states with and without forced colors: the board, the filter row, an open dropdown, an active filter with the row closed, the detail panel, dimmed cards, four messages and the settings panel, with invented data on the real page (`npm run browser`) | Automated, on every pull request | No violations, apart from the rule below |
| axe-core on the real Azure DevOps page | One test in `npm run e2e`, in the colors of the account's theme | Added here, and not yet run. The owner runs it for each release, and the release gate requires it to be green. | Not run yet |
| Keyboard | Playwright in Chrome: Tab reaches the filter, tabs, groups, board and cards, the arrow keys reach the gear, Esc closes the panel and gives focus back, a filter's dropdown can be opened and chosen in, and in the settings a phase can be moved and Save reached | Automated, on every pull request | Passes |
| Forced colors | The filter icon's dot, on light and dark backgrounds, and that it stays visible when a theme's blue is the color of the button | Automated, on every pull request | Passes |
| Reflow | At 320 px wide, only the board scrolls sideways (WCAG 1.4.10 exempts a board that needs two dimensions) | Automated, on every pull request | Passes |
| VoiceOver | Eleven steps on a local copy of the hub, the real code with invented data outside Azure DevOps. See [VoiceOver](#voiceover). | The owner, on 2026-11-09, with VoiceOver on macOS 27.2 in Safari | All eleven as expected, no deviations |

axe-core runs with the rules `label-content-name-mismatch` and `target-size` turned on, since they are WCAG's 2.5.3 and 2.5.8 and off by default. The rule `region` is off: it is a best practice and not a WCAG requirement, and it only objects to the library's tooltips, which live outside every landmark and repeat a button's name.

In forced colors axe-core cannot decide the contrast of some text, such as a primary button's. Screenshots checked by the reviewing agent show that text as readable.

## VoiceOver

The owner went through these steps and heard what the third column says, in every step.

| | Step | Heard |
| --- | --- | --- |
| A | The rotor's list of headings | "Waypoint", and one heading per phase with its count, such as "Idea 3 objects" |
| B | Opening the filter from the keyboard and typing a keyword | The button's name "Filter", and after a pause the number of objects the filter finds across all tabs |
| C | Closing the filter row with the filter still active | The icon's name "Filter, a filter is active" |
| D | The tabs | The selected tab, as tab 1 of 3, and the arrow keys change tab |
| E | The list of groups | "Groups", a list of 3 items |
| F | A card that waits on something | Its title, group, "Waiting on: …" and phase, with the current situation as its description |
| G | A card that waits on nothing | Its title, group, phase and "not waiting" |
| H | Opening a card | Focus moves into the detail panel, its title is read and its fields can be read |
| I | Closing the panel with Esc | Focus is back on the same card |
| J | The settings' headings | "Waypoint settings" first, then the sections |
| K | Moving a phase with its button | "… moved to position 2 of 6" |

## Fixed in this review

- **The filter icon's dot.** It now has a ring in the icon's own color, so it shows whatever a theme makes of the blue, also in Azure DevOps' own high contrast themes. In the operating system's high contrast mode it was already visible. Those Azure DevOps themes reach an extension only as colors, and they have not been tried on the real page. See [What has not been verified](#what-has-not-been-verified).
- **Names of filter dropdowns.** The name now holds the words shown, as WCAG 2.5.3 asks: "Waiting: All", not "Waiting filter: All".
- **Target size.** Checkboxes in the settings are at least 24 pixels high, as WCAG 2.5.8 asks.
- **Heading.** The settings panel has a level-one heading of its own, since the host's title lies in another frame.
- **Empty columns.** A phase without cards has its heading and no empty list.

## By criterion

Not a full list: these are where the board has something of its own to get right.

| Criterion | How Waypoint meets it | Verified by |
| --- | --- | --- |
| 1.1.1, 4.1.2 | Every control has a name. A card's name holds its title, group, phase and whether it is waiting. | axe-core, tests |
| 1.3.1 | Headings, lists, tabs and regions have their roles. Lists keep an explicit role, which VoiceOver is otherwise known to drop. | axe-core, tests, VoiceOver |
| 1.4.1 | Yellow is never alone: "Waiting on:" is written out. Dimmed cards are not the only signal, since the group's own cards are marked current. A group's color always has its name. | Tests |
| 1.4.3, 1.4.11 | Contrast in the light theme, with the library's fallback colors. | axe-core in Chrome. Real themes not run |
| 2.1.1, 2.4.3 | The main paths work from the keyboard, and focus returns from the panel to the card. Every path has not been walked through. | Playwright in Chrome |
| 2.4.7 | Cards, groups and the library's controls show focus. | Styles reviewed. Not measured |
| 2.5.3 | Names hold the words shown. | axe-core in Chrome, tests |
| 2.5.7 | Phases and fields can be moved with buttons as well as by dragging. | Tests |
| 2.5.8 | Targets are at least 24 pixels, or spaced as the criterion allows. | axe-core in Chrome |
| 3.3.1 | Problems in the settings are said in text, at the field. | Tests |
| 4.1.3 | The number of objects a filter finds is announced in a status region. | Tests, VoiceOver |

## What has not been verified

- **VoiceOver in Azure DevOps itself.** The steps above ran on a local copy of the hub, outside the host's frame.
- **The real page, in the dark theme and in Azure DevOps' high contrast themes.** The hub gets its colors from the host, and the checks above use the library's fallback colors for the light theme. The owner checks the filter icon's dot there after the next release to the test organization.
- **Other screen readers, voice control and other browsers.** The automated checks have not been run in Safari, Firefox or Edge, and NVDA, JAWS and Voice Control have not been used.
- **WCAG 1.4.12 (text spacing) and 2.4.11 (focus not obscured).** No check covers them.

## Known limits

- "Current situation" and "Waiting on" show at most two lines on a card. All of it is in the detail panel.
- Free text is part of a card's accessible name, so a title can be written to sound like something else. See [known limits](docs/kanda-granser.md#text-som-kan-vilseleda), in Swedish.
- Filter results are announced with a count across all tabs, since tabs show no numbers.

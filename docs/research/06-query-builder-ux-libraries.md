# Query / Filter Builder UX Patterns and React Libraries

Research for redesigning the cohort builder's compound-query UI (AND / OR / NOT / IN / RANGE).

Date: 2026-06-10
Status: research, recommendations included

---

## Executive summary

The current per-filter "AND / OR group A/B/C" dropdown is confusing because it
conflates two distinct decisions into one control: *which conjunction joins
sibling conditions* and *which group a condition belongs to*. Every mature
product and library in this space separates those concerns. The dominant,
well-established pattern is the **nested condition-group builder**: a group is a
visual container with a single AND/OR conjunction; rules live inside it; nested
groups give you the precedence that mixing AND and OR requires.

For a React + TypeScript + Tailwind app the recommendation is to **adopt
`react-querybuilder` as the engine** (query model, immutable update logic,
import/export, validation, drag-and-drop) and **provide our own Tailwind-styled
control components** via `controlElements` / `controlClassnames`. This gives us
the battle-tested data model and reducer logic without inheriting Bootstrap or
Material styling, and it lets us keep an Airtable-style "one conjunction per
group, toggled in place" interaction that non-engineers find approachable. A
fully bespoke builder is not justified: the recursive group/rule reducer,
move/clone/regenerate-id logic, and IC (independent-combinator) handling are
exactly the parts that are tedious and bug-prone to rebuild.

---

## 1. The canonical nested condition-group builder

The shared mental model across react-querybuilder, react-awesome-query-builder
and jQuery QueryBuilder:

- A **query is a tree**. The root is a **group**.
- A **group** has: a single **combinator** (AND / OR), an optional **NOT**
  (negation of the whole group), an ordered list of children, and buttons to
  **+ Rule** and **+ Group**.
- A **rule** has: **field**, **operator**, **value** (the value editor varies by
  field type and operator).
- **Nesting + indentation** communicate precedence. Mixing AND and OR is only
  possible by nesting a group, which mirrors parentheses in a boolean
  expression. Each individual group stays single-conjunction, which keeps each
  level unambiguous.

### 1a. react-querybuilder (de-facto standard)

Query object shape (`RuleGroupType`):

```js
{
  combinator: 'and',          // single conjunction for the whole group
  not: false,                 // negate the entire group
  rules: [
    { field: 'age', operator: 'between', value: '40,75' },
    { field: 'apoe', operator: 'in', value: ['e3/e4', 'e4/e4'] },
    {                          // nested group => precedence
      combinator: 'or',
      rules: [
        { field: 'diagnosis', operator: '=', value: 'AD' },
        { field: 'diagnosis', operator: '=', value: 'MCI' }
      ]
    }
  ]
}
```

Key API and UX features:

- **Combinator placement**: by default a single combinator selector lives in the
  group header. Set `showCombinatorsBetweenRules` to render the AND/OR selector
  *between* rules instead, which reads more like natural language and is closer
  to the Airtable feel.
- **Independent combinators** (`RuleGroupTypeIC`): instead of one combinator per
  group, combinator strings sit at odd indices of the `rules` array
  (`[rule, 'and', rule, 'or', rule]`), allowing different connectors between
  adjacent rules at the same level. Note: the old `independentCombinators` prop
  is deprecated; you opt in by using the `RuleGroupTypeIC` query type. This is
  powerful but harder for non-engineers to reason about than the
  one-conjunction-per-group model, because precedence becomes implicit.
- **NOT toggle**: `showNotToggle` renders a control that inverts the whole
  group's logic.
- **Value editors**: `getValueEditorType()` returns `text | select |
  multiselect | checkbox | radio | textarea | switch`. For range operators like
  `between`, the editor renders multiple inputs separated by configurable text
  via `getValueEditorSeparator()`. `multiselect` covers IN as chips.
  Operator arity controls whether a value editor renders at all (e.g.
  `is null` renders no value editor).
- **Add behaviour**: `addRuleToNewGroups` auto-inserts a starter rule when a
  group is created so the user is never staring at an empty group.
- **Lifecycle hooks**: `onAddRule`, `onAddGroup`, `onMoveRule`, `onMoveGroup`,
  `onRemove` can mutate or veto (return `false`) an action, which is how you'd
  enforce cohort rules (e.g. forbid removing the root, seed default fields).
- **Drag and drop**: the separate `@react-querybuilder/dnd` add-on supports
  dragging rules/groups, dragging across separate builders, and Alt/Option-drop
  to copy instead of move. A `dndDropNotAllowed` class styles invalid drop
  targets.
- **Styling**: `controlClassnames` swaps CSS classes per element; `controlElements`
  replaces whole sub-components. This is the seam for Tailwind. The layout
  components are explicitly HTML-agnostic, so re-skinning is supported and common.
- **Accessibility**: `accessibleDescriptionGenerator` produces unique `title`
  text on each group's container for assistive tech.

### 1b. react-awesome-query-builder (Awesome Query Builder)

- Same group(conjunction) / rule model, but ships **fully styled widget packs**:
  `@react-awesome-query-builder/antd`, `/mui` (MUI 5), `/bootstrap`, `/fluent`,
  plus a bare `/ui`. You import a config (e.g. `MuiConfig`, `AntdConfig`) that
  provides the rendered widgets and operators.
- Richer out-of-the-box widgets: range sliders, date/time pickers,
  autocomplete multi-select, and a `valueSourcesInfo` concept so the right-hand
  side of a rule can be a literal value, another field, or a function. That
  field-to-field and function comparison is more than a cohort builder needs and
  adds conceptual weight.
- Trade-off: heavier, opinionated styling tied to AntD/MUI. Harder to make look
  native in a Tailwind design system than re-skinning react-querybuilder.

### 1c. jQuery QueryBuilder (the original)

- Established the visual conventions everyone copied: each **group is a boxed,
  left-indented container** with an AND/OR toggle in its top-left, "+ Rule" and
  "+ Group" buttons in the top-right, and a delete affordance per row.
- Outputs structured JSON of rules, parseable to SQL/Mongo/etc.
- HTML templates for rules and groups are fully overridable. Not React, so it is
  a design reference, not a dependency candidate.

---

## 2. Filter-row patterns from mainstream products

How widely-used products make boolean logic approachable for non-engineers.

### Airtable (the most approachable model)

- First row reads **"Where [field] [operator] [value]"**.
- When you add a second condition, Airtable inserts **both a conjunction word
  and the new row**. The conjunction defaults to **And**.
- The conjunction is a **dropdown on the second row** showing "And" / "Or".
  Critically, **a group has exactly one conjunction**: changing the connector on
  any row **flips the whole group** ("Each level of a condition group can have
  either And or Or, but not both"). After the second row, subsequent rows show
  the chosen word as static text aligned in the connector column.
- **"+ Add condition group"** creates a nested, indented sub-group with its own
  conjunction. Nesting is capped at **3 levels**; the add-group button greys out
  at the deepest level.
- IN-style operators on linked records: **"has any of" / "has all of" /
  "has none of" / "is exactly"** with a chip multi-select.
- Dates use relative operators ("is within the past month").

This "one conjunction per group, toggled in place, applies to the whole group"
behaviour is the clearest pattern for non-technical users and is the strongest
candidate to emulate.

### Notion

- Simple filters are implicitly ANDed pills along a bar.
- **Advanced filters** introduce **filter groups** with an explicit
  **"All of" (AND) / "Any of" (OR)** selector per group; groups nest **up to 3
  levels** in the UI. The natural-language "All of / Any of" wording tests well
  with non-engineers.

### Linear / Jira

- **Filter pills**: each active filter is a removable pill ("Status is In
  Progress"); pills are implicitly ANDed. Fast for the common case, weak for OR.
- **Jira dual-mode**: a **Basic** structured builder and an **Advanced JQL**
  text editor with autocomplete/validation; you can convert Basic to JQL (one
  way). The dual-mode "structured builder with an escape hatch to raw query" is a
  good pattern for power users.

### Retool / Metabase

- **Metabase notebook editor**: multiple filters are implicitly **ANDed**; OR
  requires switching a filter to a **Custom Expression** with a code-like editor
  (`AND` / `OR`, comparison operators, a function browser, auto-format). The
  structured UI deliberately does not expose arbitrary nested OR; complex logic
  is pushed to the expression editor. Lesson: keep the visual builder for the
  common case, offer a text expression for the long tail.

### Kibana / Elastic

- **KQL query bar** (free text, `and`/`or`/ranges like `bytes > 10000 and bytes
  <= 20000`) plus **filter pills** built from a structured filter editor
  ("is one of", ranges). The query bar and pills coexist. Range is expressed by
  combining two comparisons.

### Salesforce report filter logic

- Each filter is **numbered** (1, 2, 3...). The default is AND across all.
- A separate **"Filter Logic" text field** lets you write the boolean structure
  as a string referencing the numbers: **`1 AND (2 OR 3)`**, `(1 OR 2) AND 3 AND
  NOT 4`. This decouples *the conditions* from *the boolean structure*.
- This is the most flexible non-nested approach and a strong **query-echo**
  pattern (see section 4), but writing the logic string by hand is error-prone;
  it works because the conditions themselves are still built with structured
  rows.

---

## 3. Range / IN / between editors

How range, IN and between are presented inside these builders:

- **IN / "is any of"**: a **multi-select with chips/tags**. Selected values show
  as removable pills inside the value cell; a dropdown adds more. This is
  `multiselect` in react-querybuilder and an autocomplete-tags widget in
  react-awesome-query-builder. This is the clearest representation of set
  membership for non-engineers and should be the default for categorical fields
  (e.g. APOE genotype, diagnosis).
- **RANGE / between**: two patterns dominate:
  1. **Dual numeric inputs** (`min` and `max`) with a separator word ("and" /
     "to") between them. react-querybuilder renders this for `between` via
     `getValueEditorSeparator()`; the value is stored as `"40,75"` or `[40,75]`.
  2. **Dual-thumb slider** for bounded continuous ranges (react-awesome-query-
     builder ships one). Good for age, scores; pair it with the numeric inputs so
     values are visible and keyboard-editable.
  - For half-open ranges, fall back to two comparison rules (`>= 40` AND `<= 75`)
    as Kibana does, or an operator menu offering `between / >= / <= / outside`.
- **between for dates**: a date-range picker (two date fields) is the expected
  editor; relative options ("last 30 days") are a useful add-on per Airtable.

Recommendation: model `between` as a first-class operator with a paired
min/max editor (slider + numeric inputs), and `in` / `not in` with a chip
multi-select. Both map directly to SQL `BETWEEN` and `IN` for the DuckDB-WASM
backend.

---

## 4. Readable query echo / preview

Showing the compiled query back to the user, in increasing fidelity:

- **Boolean sentence / string**: render the tree as
  `age BETWEEN 40 AND 75 AND apoe IN ('e3/e4','e4/e4') AND (diagnosis = 'AD' OR
  diagnosis = 'MCI')`. react-querybuilder's `formatQuery()` exports `sql`,
  `parameterized`, `mongodb`, `cel`, `spel`, `jsonlogic`, `natural_language`,
  etc. The `natural_language` and `sql` formats are ready-made previews.
- **Numbered + logic string (Salesforce style)**: list conditions `1..n` and
  show the structure as `1 AND (2 OR 3)`. Good as a compact summary above a
  results count.
- **Pill tree**: render the nested groups as indented pill rows (Notion/Linear
  feel) with the conjunction shown between siblings.
- **Live result count**: the single most reassuring preview for a cohort builder
  is "**N participants match**" updating as the query changes; pair it with the
  SQL echo behind a "show query" disclosure for transparency/audit.

Recommendation: always show a live matching-cohort count, plus an expandable
read-only SQL/natural-language echo via `formatQuery()`.

---

## 5. Accessibility and mobile

- **Keyboard**: every control (field, operator, value, combinator, add/remove,
  drag) must be reachable and operable by Tab/Enter/Space/arrows. Drag-and-drop
  must have a non-drag fallback (react-querybuilder exposes shift-up/shift-down
  "shift actions" precisely for keyboard reordering, gated by `showShiftActions`).
- **ARIA / screen readers**: use `accessibleDescriptionGenerator` to give each
  group a meaningful, unique label; ensure the NOT toggle and combinator are
  proper labelled controls (not bare clickable text). Group containers should be
  landmarks/regions so users can navigate level to level.
- **Mobile**: deep indentation breaks on narrow screens. Strategies:
  - Reduce indent to a thin left rule + colour band rather than wide padding.
  - Stack the field/operator/value of a rule **vertically** under ~480px instead
    of three-across.
  - Make the conjunction a full-width segmented control between rows.
  - Cap nesting depth (3 levels, like Airtable/Notion) so horizontal indentation
    stays bounded.
  - Replace drag handles with explicit "move up / move down / move into group"
    menu actions on touch.

---

## Candidate layouts (ASCII mockups)

### Candidate A: Airtable-style, one conjunction per group, toggled in place (recommended)

```
+--------------------------------------------------------------------+
| Cohort filters                              [ 1,284 participants ] |
+--------------------------------------------------------------------+
| Where  [ age ▾ ]   [ is between ▾ ]   [ 40 ] and [ 75 ]      [x]   |
|                                                                    |
| [ And ▾] [ apoe genotype ▾] [ is any of ▾] [e3/e4 ✕][e4/e4 ✕][+]  [x] |
|                                                                    |
| [ And  ] +-- Group (Any of) ----------------------------------+ [x]|
|          | [ diagnosis ▾ ] [ is ▾ ] [ AD ▾ ]              [x] |    |
|          | [ Or ▾] [ diagnosis ▾ ] [ is ▾ ] [ MCI ▾ ]     [x] |    |
|          | [ + Add condition ]                                |    |
|          +----------------------------------------------------+    |
|                                                                    |
| [ + Add condition ]   [ + Add condition group ]                    |
+--------------------------------------------------------------------+
| ▸ Show query   age BETWEEN 40 AND 75 AND apoe IN (...) AND ( ... ) |
+--------------------------------------------------------------------+
```

- The connector dropdown appears on the 2nd row of each level; changing it flips
  that whole group's conjunction. First row says "Where".
- IN renders as chips; BETWEEN renders as two inputs joined by "and".
- Result count is always visible; SQL echo is one disclosure away.

### Candidate B: explicit group header with AND/OR + NOT toggle (react-querybuilder default skin)

```
+--------------------------------------------------------------------+
|  ( ◉ All  ○ Any )   [ ☐ NOT ]        [+ Rule] [+ Group]  [⋮]       |
|  +--------------------------------------------------------------+  |
|  | ⠿  [ age ▾ ]  [ between ▾ ]  [40]—[75]                  [⧉][x]| |
|  | ⠿  [ apoe ▾ ] [ in ▾ ]  ⟨e3/e4⟩⟨e4/e4⟩ [+]             [⧉][x]| |
|  |                                                              |  |
|  |   ( ○ All  ◉ Any )  [ ☐ NOT ]      [+ Rule] [+ Group] [x]   |  |
|  |   +--------------------------------------------------------+ |  |
|  |   | ⠿ [ diagnosis ▾ ] [ is ▾ ] [ AD ▾ ]            [⧉][x] | |  |
|  |   | ⠿ [ diagnosis ▾ ] [ is ▾ ] [ MCI ▾ ]           [⧉][x] | |  |
|  |   +--------------------------------------------------------+ |  |
|  +--------------------------------------------------------------+  |
+--------------------------------------------------------------------+
```

- "All / Any" segmented control replaces the word AND/OR (Notion wording).
- NOT is an explicit checkbox per group; drag handles (⠿), clone (⧉), delete (x).
- Closest to react-querybuilder out of the box; least custom work.

### Candidate C: numbered conditions + Salesforce-style logic string (power-user escape hatch)

```
+--------------------------------------------------------------------+
| Conditions                                                          |
|  1. [ age ▾ ]   [ between ▾ ]  [40] to [75]                   [x]  |
|  2. [ diagnosis ▾ ] [ is ▾ ] [ AD ▾ ]                        [x]  |
|  3. [ diagnosis ▾ ] [ is ▾ ] [ MCI ▾ ]                       [x]  |
|  4. [ apoe ▾ ] [ is any of ▾ ] ⟨e3/e4⟩⟨e4/e4⟩ [+]            [x]  |
|  [ + Add condition ]                                                |
|                                                                     |
| Filter logic:  [ 1 AND (2 OR 3) AND 4 ]            ( valid ✓ )      |
+--------------------------------------------------------------------+
| Preview:  848 participants match                                    |
+--------------------------------------------------------------------+
```

- Decouples conditions from boolean structure; good for analysts who think in
  expressions. Weaker for novices (manual logic string). Best offered as an
  *advanced* tab alongside Candidate A, mirroring Jira Basic/Advanced.

---

## Recommendation detail

1. **Adopt `react-querybuilder`** for the model + reducer + import/export +
   validation + DnD. Render with **custom Tailwind `controlElements`** so it
   matches the design system; do **not** ship its Bootstrap/MUI skins.
2. **Use the one-conjunction-per-group model** (not independent combinators) and
   present it **Airtable-style** (Candidate A): "Where" first row, an in-place
   And/Or dropdown on the second row that flips the whole group, "+ Add condition"
   and "+ Add condition group", capped at 3 nesting levels. Use Notion's
   "All of / Any of" wording if user testing prefers it over "And / Or".
3. **Operators**: first-class `between` (paired min/max editor, optional slider)
   and `in` / `not in` (chip multi-select); these map cleanly to DuckDB
   `BETWEEN` / `IN`.
4. **Query echo**: always-on matching-cohort count, plus an expandable
   read-only SQL / natural-language preview via `formatQuery()`.
5. **Power-user tab** (later): offer Candidate C as an advanced mode, converting
   the structured query to a numbered-logic / SQL view (one-way like Jira).
6. **Accessibility/mobile**: enable `showShiftActions` for keyboard reordering,
   set `accessibleDescriptionGenerator`, collapse rules to vertical stacks and
   thin indent bands under ~480px.

**Why not bespoke**: the recursive group/rule update logic, stable id
regeneration on clone/move, IC handling, multi-format export and DnD are the
genuinely hard, well-tested parts of react-querybuilder. Rebuilding them buys
nothing; our differentiation is the *presentation*, which `controlElements`
already lets us own completely.

---

## Sources

- React Query Builder — QueryBuilder component: https://react-querybuilder.js.org/docs/components/querybuilder
- React Query Builder — RuleGroup component: https://react-querybuilder.js.org/docs/components/rulegroup
- React Query Builder — InlineCombinator: https://react-querybuilder.js.org/docs/components/inlinecombinator
- React Query Builder — Import/export & formatQuery: https://react-querybuilder.js.org/docs/utils/import
- React Query Builder — TypeScript reference (RuleGroupType / RuleGroupTypeIC): https://react-querybuilder.js.org/docs/typescript
- React Query Builder — Changelog (DnD, cross-builder drag, copy-on-drop): https://github.com/react-querybuilder/react-querybuilder/blob/main/CHANGELOG.md
- react-awesome-query-builder — repo & docs: https://github.com/ukrbublik/react-awesome-query-builder
- react-awesome-query-builder — live demo: https://ukrbublik.github.io/react-awesome-query-builder/
- react-awesome-query-builder — CONFIG (widgets, valueSources): https://github.com/ukrbublik/react-awesome-query-builder/blob/master/CONFIG.adoc
- react-awesome-query-builder — npm: https://www.npmjs.com/package/react-awesome-query-builder
- jQuery QueryBuilder: https://querybuilder.js.org/
- Airtable — Filter records using conditions: https://support.airtable.com/docs/filtering-records-using-conditions
- Notion — Views, filters & sorts: https://www.notion.com/help/views-filters-and-sorts
- Notion — Using advanced database filters: https://www.notion.com/help/guides/using-advanced-database-filters
- Notion API — compound filter (and/or): https://developers.notion.com/reference/post-database-query-filter
- Jira — example JQL / board filters: https://support.atlassian.com/jira-software-cloud/docs/example-jql-queries-for-board-filters/
- Jira filters guide (Basic vs Advanced/JQL): https://idalko.com/blog/jira-filters
- Metabase — Filtering: https://www.metabase.com/docs/latest/questions/query-builder/filters
- Metabase — Custom expressions (AND/OR): https://www.metabase.com/docs/latest/questions/query-builder/expressions
- Kibana — KQL & range syntax: https://www.elastic.co/docs/explore-analyze/query-filter/languages/kql
- Kibana — Using dashboards (filter pills): https://www.elastic.co/docs/explore-analyze/dashboards/using
- Salesforce — Filter your report / custom filter logic: https://trailhead.salesforce.com/content/learn/modules/lex_implementation_reports_dashboards/lex_implementation_reports_dashboards_filter_your_report
- Salesforce — How to use filter logic (1-min guide): https://www.storylane.io/tutorials/how-to-use-filter-logic-in-salesforce
- React Aria — Accessibility (keyboard, ARIA, adaptive): https://react-spectrum.adobe.com/react-aria/accessibility.html

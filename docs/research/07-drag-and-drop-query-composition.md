# Drag-and-Drop and Block/Visual Approaches to Boolean Query Composition

**Scope:** An honest, evidence-based assessment of drag-and-drop (DnD) and block/visual
paradigms for composing compound boolean filters (AND / OR / NOT / IN / RANGE) in our
React cohort builder. The product owner suggested *possibly* using drag-and-drop; this
report answers whether it should be the primary interaction, a secondary enhancement, or
avoided, and which library and accessibility fallback to use if adopted.

**Bottom line up front:** Do **not** make drag-and-drop the primary way to compose
AND/OR/NOT for a novice-facing cohort builder. Build a **click-based group/rule builder**
(ATLAS-style "match ALL / ANY" quantifiers + a separate Exclude region, as already
decided in `00-decisions-and-architecture.md`). Add drag-and-drop only as a **progressive
enhancement** for **reordering and regrouping** rules, layered on top of click controls.
If DnD is added, use **dnd-kit**, and it is **mandatory** under WCAG 2.2 SC 2.5.7 to ship
a non-drag alternative (move up/down buttons + a "move to group" menu) plus keyboard and
screen-reader support.

This report is consistent with, and extends, `03-cohort-builder-ux.md`, which already
recommends a faceted-default layout with an opt-in advanced query-builder mode.

---

## 1. How real tools use drag-and-drop for query / logic composition

The first question is always: **what exactly is dragged, and what are the drop targets?**
DnD only works when both the dragged object and the drop zone are *visible, persistent,
and meaningful*. Here is how the prominent tools answer that.

### 1.1 i2b2 — drag concepts into Boolean group panels

i2b2 is the canonical biomedical example and is already analysed in `03`. Its model:

- **Left pane:** a navigable ontology tree of concepts grouped into folders.
- **Right pane (Query Tool):** numbered **Query Groups / panels** (Groups 1–3 by default,
  more addable).
- **What is dragged:** a *concept term* from the ontology tree.
- **Drop target:** a *Group panel*. Dropping opens an inline **constraint window** (value,
  date range, etc.).
- **Boolean semantics (quoted):** *"items within each Group are first **ORed** together;
  the Groups are then **ANDed** together."* A per-group **Exclude** checkbox turns the
  group into NOT.

Critically, in i2b2 **the boolean operator is implied by the drop location, not chosen by
the user.** You express OR by dropping into the same group; AND by dropping into a
different group. The drag is a *placement* gesture, not a *logic-authoring* gesture. This
is the key insight that separates "good" DnD from "bad" DnD (see §3).
Sources: [i2b2 Query Tool](https://www.i2b2.org/webclient/help/3.-Query-Tool_9995021.html),
[Creating a Query in the Query View](https://community.i2b2.org/wiki/display/webclient/Creating+a+Query+in+the+Query+View),
[Query Panel Layout — Detailed Review](https://community.i2b2.org/wiki/display/webclient/Query+Panel+Layout+-+Detailed+Review).

### 1.2 Tableau / Power BI / Looker — "shelves" and "field wells"

These BI tools popularised the **shelf / well** pattern, which is DnD-for-binning, not
DnD-for-boolean-logic.

- **Tableau:** drag *fields* from the Data pane onto **Rows / Columns shelves**, the
  **Marks card**, and the **Filters shelf**. The drop target *is* the semantic role: a
  field on Rows becomes a row header; a field on Filters becomes a filter. Boolean
  combination of filters is configured *inside* a filter dialog, not by dragging.
- **Power BI:** drag fields from the Fields pane onto **field wells** (Axis, Legend,
  Values, Filters) of a visual. Same model: the well determines the role.
- **Looker:** the field picker is a **click-to-add** model (click a dimension/measure to
  add it to the query); drag is used mainly to **reorder result columns**, not to author
  filter logic. Looker filters are edited in a structured filter UI.

Lesson: BI tools use DnD to assign a field to a *role/zone*, and they keep boolean filter
logic in structured dialogs. None of them ask a novice to *drag an AND operator*.
Sources: [Tableau — Build by Dragging Fields](https://help.tableau.com/current/pro/desktop/en-us/buildmanual_dragging.htm),
[Power BI for Tableau Developers](https://interworks.com/blog/2024/07/22/a-guide-to-power-bi-desktop-for-tableau-developers/),
[Looker — Creating and editing Explores](https://docs.cloud.google.com/looker/docs/creating-and-editing-explores),
[Looker — field picker](https://cloud.google.com/looker/docs/changing-explore-menu-and-field-picker).

### 1.3 Scratch / Blockly — block programming for boolean logic

Block environments are the strongest precedent for *visually composing boolean logic*.

- **What is dragged:** typed blocks from a palette. **Boolean expressions are
  diamond-shaped**; value/expression blocks are rounded; statement blocks are puzzle
  pieces. The *shape dictates which blocks can connect*, which **prevents syntax errors**
  by construction.
- **Drop targets:** shaped slots in other blocks (e.g. an `if` block has a diamond-shaped
  hole that only accepts a boolean block).
- **Why it works for logic:** the shape system is a *constraint and a signifier* at once.
  AND/OR are themselves diamond blocks with two diamond slots, so nesting `(A OR B) AND C`
  is physically modelled.

This is the genuinely successful case of "drag-to-build-logic", and it works because the
domain is *teaching programming*, where building the logic structure manually **is the
learning objective**, and the audience invests time. A cohort builder's goal is the
opposite: get a count fast, with the logic as a means, not an end.
Sources: [Blockly — Wikipedia](https://en.wikipedia.org/wiki/Blockly),
[A Block-Based Testing Framework for Scratch (arXiv)](https://arxiv.org/pdf/2410.08835).

### 1.4 Node-RED — flow-based "wire the nodes" canvas

Node-RED is a flow-based, low-code tool: drag *nodes* from a palette onto a canvas and
**wire them together** with connections; data flows node to node. It is the archetype of
the "query canvas" idea, where AND/OR/NOT could be nodes joined by wires. It is powerful
for engineers and IoT integrators but is explicitly a developer/maker tool. The wire-graph
metaphor carries high cognitive load and weak discoverability for novices, and node graphs
are notoriously hard to make accessible.
Sources: [Node-RED — Wikipedia](https://en.wikipedia.org/wiki/Node-RED),
[Node-RED programming model](https://noderedguide.com/node-red-lecture-5-the-node-red-programming-model/).

### 1.5 Pill / token drag-reordering (react-querybuilder)

The most relevant React-native pattern: a **click-based** nested rule/group builder where
DnD is a *layered enhancement for reordering*. In `react-querybuilder`, with the optional
DnD add-on, **a drag handle is rendered at the front of every rule and rule-group header**;
you drag a rule by its handle to reorder it within a group or to move it into another
group; holding a modifier key copies instead of moves. The combinator (AND/OR) is still
chosen from a *dropdown*, not by dragging. This is exactly the hybrid pattern we recommend.
Source: [react-querybuilder CHANGELOG](https://github.com/react-querybuilder/react-querybuilder/blob/main/CHANGELOG.md),
[RuleGroup docs](https://react-querybuilder.js.org/docs/components/rulegroup).

**Summary of "what is dragged / drop target":**

| Tool | What is dragged | Drop target | Is the boolean operator *dragged*? |
|---|---|---|---|
| i2b2 | Ontology concept | Group panel | No — OR=same group, AND=other group, NOT=Exclude toggle |
| Tableau / Power BI | Field | Shelf / field well | No — logic lives in filter dialogs |
| Looker | Field (click); column (drag) | Query / result columns | No |
| Scratch / Blockly | Typed block (AND/OR are diamond blocks) | Shaped slot | Yes — but for *teaching* logic |
| Node-RED | Node | Canvas + wires | Partially — developer tool |
| react-querybuilder | Rule/group by drag handle | Another group | No — combinator stays a dropdown |

---

## 2. React drag-and-drop libraries — trade-offs for this use

If we adopt DnD as an enhancement, the library choice is dominated by **accessibility**
(keyboard + screen reader) and **touch support**, not animation polish.

### 2.1 dnd-kit (recommended)

- **Accessibility:** built into the core. A `DndContext` renders an off-screen **ARIA
  live region** that announces drag start, drag-over a droppable, drag end, and cancel;
  these **announcements are customisable** with domain language (e.g. *"Rule 'APOE = e4/e4'
  picked up. Use arrow keys to move within Inclusion Group 1; space to drop; escape to
  cancel."*). Keyboard sensor: **Space to start, arrow keys to move, Escape to cancel**.
- **Bundle size:** ~**6 KB core**; modular architecture means you ship only the sensors
  and modifiers you use.
- **Touch:** Pointer and Touch sensors. Recommended config for touch is **delay-based
  activation (~250 ms delay, 5 px tolerance)** so a tap-scroll is not mistaken for a drag,
  plus `touch-action: none`/`manipulation` on draggable elements.
- **Verdict:** the current community standard for new React projects; best documentation
  and the only one whose a11y story is genuinely first-class out of the box.
Sources: [dnd-kit Accessibility](https://docs.dndkit.com/guides/accessibility),
[dnd-kit Pointer sensor](https://docs.dndkit.com/api-documentation/sensors/pointer),
[dnd-kit Touch sensor](https://docs.dndkit.com/api-documentation/sensors/touch),
[Top 5 DnD Libraries for React (Puck)](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react).

### 2.2 @hello-pangea/dnd (the maintained react-beautiful-dnd fork)

- **Accessibility:** excellent and *higher-level* — keyboard dragging and screen-reader
  announcements ship by default, following WAI-ARIA guidance. Often praised as having the
  best out-of-the-box a11y for **lists**.
- **Bundle size:** larger and heavier than dnd-kit (it is a higher abstraction).
- **Limitation:** **built for lists/columns** (kanban-style). Nested rule-groups with
  arbitrary regrouping and an Exclude zone stretch its model; it does not offer the
  breadth of dnd-kit.
- **Verdict:** great if our DnD need were purely "reorder a flat list"; less ideal for
  nested group/regroup semantics.
Sources: [hello-pangea/dnd (GitHub)](https://github.com/hello-pangea/dnd),
[hello-pangea/dnd accessibility docs](https://github.com/hello-pangea/dnd/blob/HEAD/docs/about/accessibility.md),
[npm-compare: hello-pangea vs react-dnd](https://npm-compare.com/@hello-pangea/dnd,react-beautiful-dnd,react-dnd,react-draggable).

### 2.3 react-dnd

- **Accessibility:** **low-level**; keyboard and screen-reader support are **not provided**
  and must be implemented manually. This is a significant burden and a common source of
  inaccessible implementations.
- **Bundle size:** heavier; HTML5 backend plus a separate touch backend.
- **Touch:** requires the `react-dnd-touch-backend` and manual wiring.
- **Verdict:** maximum flexibility, but for a novice-facing, accessibility-critical tool
  the manual a11y burden is a liability. Not recommended.
Source: [Top 5 DnD Libraries for React (Puck)](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react).

### 2.4 framer-motion `Reorder` (and Motion)

- **Accessibility:** designed for **animation**, not accessible reordering. There is **no
  built-in keyboard dragging and no built-in screen-reader announcement** for `Reorder`;
  you would build the entire a11y layer yourself.
- **Touch:** known issues distinguishing scroll from drag on mobile (open GitHub issues
  #1506, #1597).
- **Verdict:** use Motion for *transitions/animation* if desired, but **not** as the DnD
  engine for query composition.
Sources: [Motion accessibility guide](https://www.framer.com/motion/guide-accessibility/),
[Reorder mobile scroll-vs-drag issue #1506](https://github.com/framer/motion/issues/1506).

### 2.5 Pragmatic drag-and-drop (Atlassian) — worth noting

Atlassian's newer `pragmatic-drag-and-drop` is **<4 KB** and framework-agnostic, designed
for performance at scale. It is a credible alternative to dnd-kit but has a thinner React
ecosystem and you assemble more of the a11y affordances yourself.
Source: [dnd-kit vs react-beautiful-dnd vs Pragmatic DnD 2026 (PkgPulse)](https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026).

**Library scorecard (for our nested group/regroup enhancement):**

| Library | Keyboard DnD | SR announcements | Touch | Bundle | Nested/regroup fit | Verdict |
|---|---|---|---|---|---|---|
| **dnd-kit** | Yes (built-in) | Yes (customisable live region) | Yes (sensors) | ~6 KB core | Good | **Recommended** |
| hello-pangea/dnd | Yes (built-in) | Yes (built-in) | Yes | Larger | Lists only | Good for flat lists |
| react-dnd | Manual | Manual | Manual (extra backend) | Heavier | Flexible but DIY | Avoid for a11y reasons |
| framer-motion Reorder | No | No | Buggy | n/a (anim lib) | Poor | Animation only |
| pragmatic-drag-and-drop | Partial/DIY | DIY | Yes | <4 KB | Good | Viable, thinner ecosystem |

---

## 3. UX research and heuristics — when DnD helps vs hurts

### 3.1 When drag-and-drop helps

Nielsen Norman Group (Laubheimer, *"Drag-and-Drop: How to Design for Ease of Use"*) states
DnD is a form of **direct manipulation** that is *"particularly useful for grouping,
reordering, moving, or resizing objects."* It works when:

- **Items of interest are visible on screen** (icons, cards, pills) — *"dragging invisible
  objects would surely suffer in usability."*
- There are **clear signifiers** of grabbability: a **grab-handle icon** and a **hover
  cursor change**.
- There is **clear feedback at every stage**: object-grabbed state, a drag preview/ghost,
  highlighted valid drop zones, and a settle animation.
- The mapping from gesture to outcome is **spatial and obvious** (move this card here).

This is precisely the *reorder/regroup* case, which is why it is the right enhancement
target (see §4).
Source: [NN/g — Drag-and-Drop: How to Design for Ease of Use](https://www.nngroup.com/articles/drag-drop/).

### 3.2 When drag-and-drop hurts

The same research, plus accessibility literature, documents recurring failure modes:

- **Discoverability:** DnD is **hidden** — there is no visible affordance telling a user
  *"you can drag this"* until they try. Novices frequently do not discover it at all.
- **Off-screen / small drop targets:** *"when the desired drop target is off-screen, users
  must wait and hold the object while the list scrolls"*, and *"the small size of some drop
  targets and their proximity to other targets increase the likelihood of dropping on the
  wrong target."*
- **Extra cognitive load:** DnD is *"more of an abstraction than direct reordering"* —
  it adds a layer of indirection versus a plain "move up" button.
- **Motor demands:** sustained press-and-hold-and-move is hard for users with tremor,
  limited dexterity, or using trackballs, head pointers, eye-gaze, or speech control.
- **Touch:** touchscreens **lack hover states** (the usual signifier of grabbability), and
  press-and-drag conflicts with scroll. *"Touch users generally don't have a keyboard,"*
  so a keyboard alternative alone is insufficient on mobile.
Sources: [NN/g — Drag-and-Drop](https://www.nngroup.com/articles/drag-drop/),
[Smart Interface Design Patterns — Drag-and-Drop UX](https://smart-interface-design-patterns.com/articles/drag-and-drop-ux/),
[Vispero — The Road to Accessible Drag and Drop (Part 2)](https://vispero.com/resources/the-road-to-accessible-drag-and-drop-part-2/),
[Liferay.Design — Making Drag and Drop fully accessible](https://liferay.design/articles/2023/accessible-drag-drop/).

### 3.3 The accessibility mandate: WCAG 2.2 SC 2.5.7 "Dragging Movements" (Level AA)

This is **not optional** if we claim WCAG 2.2 AA conformance:

> *"All functionality that uses a dragging movement for operation can be achieved by a
> single pointer without dragging, unless dragging is essential or [...] determined by the
> user agent and not modified by the author."*

Key implications:

- Every drag action must have a **single-pointer (click/tap) alternative**. For DnD, the
  accepted alternatives are **select-then-activate "Move" buttons / menu options** (e.g.
  "move up", "move down", "move to group X") or cut-and-paste commands.
- **A keyboard alternative is necessary but NOT sufficient** to satisfy 2.5.7, *"as mobile
  users often do not have access to a keyboard."* So we need *both* keyboard support (for
  SC 2.1.1) *and* a single-pointer non-drag path (for SC 2.5.7).
- Failure **F108** is "no single-pointer method that avoids dragging"; technique **G219**
  is "ensure an alternative is available for dragging movements."
Sources: [W3C — Understanding SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html),
[W3C — G219 technique](https://www.w3.org/WAI/WCAG22/Techniques/general/G219.html),
[W3C — F108 failure](https://www.w3.org/WAI/WCAG22/Techniques/failures/F108).

### 3.4 Domain fit for a novice cohort builder

From `03-cohort-builder-ux.md`: our audience is researchers, not programmers; our boolean
needs are modest (OR-within-variable, AND-across-variable, an Exclude region, occasional
cross-variable OR); and our variable set is **fixed at ~47**, not an open ontology of
millions. The justifications for i2b2-style concept-dragging (huge searchable ontology,
expert users) **do not apply to us**. The fast path most users need is faceted filtering
with implicit AND — no dragging at all.

---

## 4. Hybrid patterns — drag-as-enhancement vs drag-as-primary

### 4.1 Drag-as-primary (avoid for novices)

The whole interaction depends on dragging: you must drag an operator or a concept to make
*any* logic. Examples: i2b2 concept-drag, Node-RED wiring, a pure block canvas. Costs:
poor discoverability, full 2.5.7 burden, hard on touch, steep for novices. Appropriate
only for expert, desktop-first, training-investment tools.

### 4.2 Drag-as-enhancement (recommended middle ground)

The builder is **fully operable by clicking** — add rule, choose field, choose operator,
pick value, choose group quantifier (ALL/ANY), toggle Exclude. **Drag is layered on top**
purely to make **reordering and regrouping** faster and more tactile, exactly the
"grouping / reordering / moving" case NN/g endorses. `react-querybuilder`'s optional drag
handle on each rule/group header is the reference implementation: drag to reorder or move
between groups, but **the AND/OR combinator stays a dropdown** and every drag has a
button/menu equivalent.

This satisfies the **progressive enhancement** principle: remove the DnD layer entirely
and the builder still works for keyboard, screen-reader, and touch users; add it and mouse
users on desktop get a faster path. It is the only pattern that cleanly satisfies 2.5.7
without compromising the core flow.
Source: [react-querybuilder RuleGroup / drag handle](https://react-querybuilder.js.org/docs/components/rulegroup),
[NN/g — Drag-and-Drop](https://www.nngroup.com/articles/drag-drop/).

### 4.3 ASCII mockup — drag-enhanced click-first group builder

Each rule and group header carries a **grab handle (⠿)** for optional drag-reorder, **plus
explicit ▲▼ move buttons and a "⋯ → Move to group" menu** as the required non-drag path.
The combinator is a dropdown, never dragged.

```
ADVANCED QUERY BUILDER (opt-in toggle; faceted mode is the default)
+-------------------------------------------------------------------------------+
|  INCLUDE subjects who match:                                                  |
|                                                                               |
|  +-- Group 1 ----------------------------------------------------[⠿]--------+ |
|  |  Subjects must match  [ ANY  v ]  of:        (ANY = OR, ALL = AND)        | |
|  |                                                                          | |
|  |  [⠿] [ APOE genotype  v ] [ is one of v ] [ e3/e4 , e4/e4         ]  [⋯]  | |   IN / multi-select (OR within)
|  |        ▲ ▼   <- non-drag move (WCAG 2.5.7 alternative)                    | |
|  |  ── OR ──                                                                | |   combinator = dropdown, not dragged
|  |  [⠿] [ Diagnosis      v ] [ equals    v ] [ Alzheimer's disease   ]  [⋯]  | |
|  |        ▲ ▼                                                                | |
|  |                                          [ + Add rule ]  [ + Add group ]  | |
|  +--------------------------------------------------------------------------+ |
|                                                                               |
|                              ──  AND  ──   (across groups)                    |
|                                                                               |
|  +-- Group 2 ----------------------------------------------------[⠿]--------+ |
|  |  Subjects must match  [ ALL  v ]  of:                                     | |
|  |  [⠿] [ Age at baseline v ] [ between v ] [ 65 ] to [ 85 ]            [⋯]  | |   RANGE
|  |        ▲ ▼                                                                | |
|  +--------------------------------------------------------------------------+ |
|                                                                               |
|  ===========================================================================  |
|  EXCLUDE subjects who match:   (separate region = NOT; clearer than per-row)  |
|  +-- Exclude Group ---------------------------------------------[⠿]---------+ |
|  |  [⠿] [ hasMRI         v ] [ equals    v ] [ Not available          ] [⋯]  | |
|  |        ▲ ▼                                                                | |
|  +--------------------------------------------------------------------------+ |
+-------------------------------------------------------------------------------+
|  Plain-language summary:                                                      |
|   Include: (APOE in {e3/e4, e4/e4}) OR (Diagnosis = Alzheimer's)              |
|            AND (Age between 65 and 85)                                         |
|   Exclude: hasMRI = Not available                                             |
|                                                  Live count:  1,240  (± noise) |
+-------------------------------------------------------------------------------+

[⋯] row menu (the non-drag move path):
     +-------------------------+
     | Move up            ▲    |
     | Move down          ▼    |
     | Move to group  >  Group 2|
     |                   Exclude|
     | Duplicate               |
     | Delete                  |
     +-------------------------+
```

Keyboard drag (dnd-kit) mirrors this: focus a `⠿` handle, **Space** to lift (announced),
**↑/↓** to move, **Space** to drop, **Esc** to cancel.

---

## 5. Concrete recommendation

**Drag-and-drop should be a SECONDARY enhancement, not the primary interaction, and is
optional even then. For composing AND/OR/NOT specifically, do not use drag-and-drop at
all — use click controls (quantifier dropdowns + buttons).**

Rationale, tied to evidence:

1. **The default path needs zero dragging.** Per `03`, ~90% of users are served by the
   faceted filter panel with implicit AND-across / OR-within. Adding DnD there would only
   add cognitive load and discoverability problems (NN/g).
2. **Operators must be clicked, not dragged.** Dragging an "AND" token is the worst of both
   worlds: hidden, abstract, and motor-demanding. ATLAS-style "match ALL / ANY" dropdowns
   and a separate Exclude region (already decided) are clearer for non-programmers and
   trivially accessible. i2b2, Tableau, Power BI, Looker and react-querybuilder all keep
   boolean logic in *controls*, not in drags.
3. **DnD's legitimate niche is reorder/regroup.** NN/g endorses DnD for "grouping,
   reordering, moving." So *if* we want polish, add a drag handle to reorder rules and move
   them between groups, as a pure enhancement over working click buttons.
4. **WCAG 2.2 SC 2.5.7 is binding.** Any drag we ship must have a single-pointer
   alternative (▲▼ buttons + "Move to group" menu) and keyboard support. A keyboard path
   alone does not satisfy 2.5.7 for touch users.
5. **Library:** if DnD is added, use **dnd-kit** — built-in keyboard sensor, customisable
   ARIA live-region announcements, touch sensors, ~6 KB core. Avoid react-dnd (manual a11y)
   and framer-motion Reorder (no keyboard/SR support) for this purpose.

**Phasing suggestion**

- **Phase 1 (ship):** faceted default + click-based advanced group builder (quantifier
  dropdowns, Exclude region, ▲▼ move buttons, row "⋯" menu). No DnD. Fully WCAG 2.2 AA.
- **Phase 2 (optional enhancement):** add dnd-kit drag handles for reorder/regroup, keeping
  every button and menu in place. Treat DnD as removable garnish, never a dependency.

### Accessibility checklist (must-have if any DnD ships)

- [ ] **Non-drag alternative for every drag (WCAG 2.5.7):** ▲ Move up / ▼ Move down buttons
      on every rule and group, plus a "Move to group →" submenu. Verifiable without a mouse.
- [ ] **Keyboard operable (WCAG 2.1.1):** focusable grab handle; Space lift, arrows move,
      Space drop, Esc cancel (dnd-kit keyboard sensor).
- [ ] **Screen-reader announcements:** customised dnd-kit live-region messages using domain
      language ("Rule picked up", "moved over Inclusion Group 1", "dropped", "cancelled").
- [ ] **Visible focus indicator** on handles and move buttons (WCAG 2.4.7 / 2.4.11).
- [ ] **Touch target size ≥ 24×24 CSS px** for handles and ▲▼ buttons (WCAG 2.5.8).
- [ ] **Touch:** delay-activated drag (~250 ms / 5 px tolerance) so scroll is not hijacked;
      `touch-action` set appropriately; non-drag buttons work without hover.
- [ ] **Clear signifiers (NN/g):** visible grab handle + hover cursor change; drag preview/
      ghost; highlighted valid drop zones; settle animation.
- [ ] **No reliance on drag for any state change:** the query must be fully buildable,
      reorderable, and editable with clicks and keyboard alone.
- [ ] **`prefers-reduced-motion` respected** for drag/settle animations.
- [ ] **Plain-language query summary** stays in sync and is the source of truth for SR users.

---

## Sources

- i2b2 Web Client — Query Tool: https://www.i2b2.org/webclient/help/3.-Query-Tool_9995021.html
- i2b2 — Creating a Query in the Query View: https://community.i2b2.org/wiki/display/webclient/Creating+a+Query+in+the+Query+View
- i2b2 — Query Panel Layout (Detailed Review): https://community.i2b2.org/wiki/display/webclient/Query+Panel+Layout+-+Detailed+Review
- Tableau — Start Building a Visualization by Dragging Fields: https://help.tableau.com/current/pro/desktop/en-us/buildmanual_dragging.htm
- Power BI for Tableau Developers (InterWorks): https://interworks.com/blog/2024/07/22/a-guide-to-power-bi-desktop-for-tableau-developers/
- Looker — Creating and editing Explores: https://docs.cloud.google.com/looker/docs/creating-and-editing-explores
- Looker — Changing the Explore menu and field picker: https://cloud.google.com/looker/docs/changing-explore-menu-and-field-picker
- Blockly — Wikipedia: https://en.wikipedia.org/wiki/Blockly
- A Block-Based Testing Framework for Scratch (arXiv): https://arxiv.org/pdf/2410.08835
- Node-RED — Wikipedia: https://en.wikipedia.org/wiki/Node-RED
- Node-RED programming model: https://noderedguide.com/node-red-lecture-5-the-node-red-programming-model/
- react-querybuilder — CHANGELOG (drag handle / DnD): https://github.com/react-querybuilder/react-querybuilder/blob/main/CHANGELOG.md
- react-querybuilder — RuleGroup: https://react-querybuilder.js.org/docs/components/rulegroup
- dnd-kit — Accessibility: https://docs.dndkit.com/guides/accessibility
- dnd-kit — Pointer sensor: https://docs.dndkit.com/api-documentation/sensors/pointer
- dnd-kit — Touch sensor: https://docs.dndkit.com/api-documentation/sensors/touch
- hello-pangea/dnd (GitHub): https://github.com/hello-pangea/dnd
- hello-pangea/dnd — accessibility docs: https://github.com/hello-pangea/dnd/blob/HEAD/docs/about/accessibility.md
- npm-compare — hello-pangea/dnd vs react-dnd: https://npm-compare.com/@hello-pangea/dnd,react-beautiful-dnd,react-dnd,react-draggable
- Top 5 Drag-and-Drop Libraries for React (Puck): https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react
- dnd-kit vs react-beautiful-dnd vs Pragmatic DnD 2026 (PkgPulse): https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026
- Motion (framer-motion) — Accessibility guide: https://www.framer.com/motion/guide-accessibility/
- framer-motion — Reorder mobile scroll/drag issue #1506: https://github.com/framer/motion/issues/1506
- NN/g — Drag-and-Drop: How to Design for Ease of Use (Laubheimer): https://www.nngroup.com/articles/drag-drop/
- Smart Interface Design Patterns — Drag-and-Drop UX: https://smart-interface-design-patterns.com/articles/drag-and-drop-ux/
- Vispero — The Road to Accessible Drag and Drop (Part 2): https://vispero.com/resources/the-road-to-accessible-drag-and-drop-part-2/
- Liferay.Design — Making Drag and Drop fully accessible: https://liferay.design/articles/2023/accessible-drag-drop/
- W3C — Understanding SC 2.5.7 Dragging Movements: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- W3C — G219 (alternative for dragging movements): https://www.w3.org/WAI/WCAG22/Techniques/general/G219.html
- W3C — F108 (failure of SC 2.5.7): https://www.w3.org/WAI/WCAG22/Techniques/failures/F108

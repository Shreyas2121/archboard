# Frontend coding guidelines

These rules apply to `apps/web`. Follow them for new code and code changed for the
requested task. Existing inconsistent code is not permission to repeat the pattern.
Do not refactor unrelated code just to bring it into compliance. Explicit user
instructions take precedence; explain any necessary departure briefly.

## Start here

1. Read the component you are changing and its nearest related components.
2. Search `src/components/ui`, `src/app/components`, and the relevant feature for
   something to reuse before creating a component, hook, utility, or style.
3. Check `components.json`, `src/styles.css`, and `package.json` before making
   assumptions about available primitives, design tokens, or dependencies.
4. Use the smallest change that fits the existing structure. Do not introduce a new
   styling system, UI library, router, or state-management library.

## Styling: Tailwind first

- Use Tailwind utility classes in `className` for layout, spacing, sizing,
  typography, colors, borders, responsive behavior, and interaction states.
- This project uses Tailwind v4 with the Vite plugin and CSS theme configuration.
  Do not introduce a Tailwind v3 configuration or replace the existing setup.
- Do not create component CSS files, CSS modules, Sass, styled-components, Emotion,
  `<style>` blocks, or custom CSS classes for things Tailwind can express.
- Keep `src/styles.css` for theme tokens, global base styles, Tailwind setup, and
  necessary third-party integration styles. Do not put page/component styling
  there, including custom classes that merely bundle utilities with `@apply`.
- Use semantic tokens such as `bg-background`, `bg-card`, `text-foreground`,
  `text-muted-foreground`, `border-border`, and `text-destructive`. Avoid hardcoded
  hex/RGB colors and one-off palette colors for ordinary interface surfaces.
- Reuse the existing spacing, typography, radius, and size scales. Use arbitrary
  values only for a concrete layout or canvas requirement the scale cannot express.
- Use `cn` from `@/lib/utils` to combine conditional classes and caller-supplied
  `className`. Do not create another class-name helper or add helper dependencies.
- Keep Tailwind class names complete and statically visible. Use a map or `cn`
  conditions, never constructions such as `` `bg-${color}-500` ``.
- Prefer responsive utilities and `data-*`/`aria-*` variants for finite UI states.
  Do not use inline styles for ordinary spacing, colors, or fixed layout variants.

Allowed exceptions are runtime values such as measured coordinates, zoom,
user-resized dimensions, and third-party APIs requiring style objects. Required
library CSS and narrowly scoped overrides of library-owned DOM are also allowed
when utilities cannot target it adequately. Keep each exception small and add a
short code comment explaining why utilities are insufficient. An exception is not
permission to style the rest of the component with custom CSS.

## Components: reuse shadcn/ui

Use this decision order:

1. Reuse an existing product component if it already provides the behavior.
2. Otherwise compose the checked-in primitives from `@/components/ui/*`.
3. If a standard primitive is missing, add the matching shadcn/ui primitive using
   the existing configuration. Do not build a homemade replacement.
4. Write custom components for Archboard-specific behavior and composition, such
   as an editor toolbar, inspector, canvas card, or brand mark.

- Use the existing `Button`, `Input`, `Label`, `Dialog`, `Tooltip`, and `Collapsible`
  components. Inspect their source for supported props; do not guess APIs from
  another shadcn style or version.
- Use `src/app/components/icon-button.tsx` for toolbar-style icon actions with a
  label and tooltip. Do not recreate that combination at each call site.
- Do not hand-roll buttons, inputs, dialogs, menus, tooltips, selects, tabs, or
  checkboxes when the corresponding shadcn primitive is appropriate. Native
  semantic layout elements such as `section`, `header`, and `main` are encouraged.
- `src/components/ui` contains reusable shadcn primitives, not feature logic,
  editor state, API calls, or product-specific components.
- Prefer existing `variant` and `size` props over restyling a primitive at every
  call site. Use the existing `class-variance-authority` pattern for genuinely
  reusable variants. Do not add a shared variant for a single screen's layout.
- Preserve primitive accessibility, focus behavior, refs, event handlers, and
  composition APIs when wrapping or editing them. Avoid nested buttons/links;
  use the supported `asChild` composition where appropriate.
- Preserve `components.json`: Radix Nova, CSS variables, Lucide, and the existing
  aliases. Do not rerun initialization, switch to Base UI, or overwrite existing
  customized primitives to add a missing component.
- When adding a primitive, use the exact shadcn CLI version recorded in
  `docs/evidence/phase2/P2-01.md` (paths here are relative to the repository root).
  Run it for `apps/web`; add only the needed component. Inspect generated changes
  and keep them compatible with the existing `cn` helper and dependency catalog.
  Do not use `@latest`. If generation is unavailable, report that limitation;
  do not silently substitute a hand-built primitive.

## Visual consistency and accessibility

- Use `lucide-react` for interface icons. Do not add an icon library, emoji icons,
  or hand-drawn SVG replacements for icons Lucide already supplies. Product artwork
  such as the existing `BrandMark` may remain custom.
- Reuse the existing Geist font and theme provider. Do not introduce remote fonts,
  separate theme state, or another dark-mode mechanism.
- Design with the existing light/dark tokens. When a new semantic token is needed,
  define its light and dark values together and expose it through the existing
  Tailwind theme in `src/styles.css`.
- Keep visible keyboard focus. Give icon-only controls an accessible name, pair
  form controls with labels, and supply dialog titles/descriptions as appropriate.
  A tooltip alone is not an accessible name.
- Use buttons for actions and TanStack Router links for internal navigation.
  Set `type="button"` on non-submit buttons. Do not make clickable `div` elements.
- Respect reduced-motion preferences for decorative animation. Preserve the
  existing narrow-screen/read-only editor behavior unless the task changes it.
- Handle relevant loading, empty, error, and disabled states explicitly. Controls
  must reflect actual availability; do not make unfinished actions appear usable.

## File organization and React patterns

- Use TypeScript and function components. Follow nearby naming conventions:
  kebab-case filenames, PascalCase component names, and `use` prefixes for hooks.
- Put application routes, providers, and shell composition in `src/app`; editor
  capabilities in `src/features/editor/<capability>`; browser/config adapters in
  `src/platform`; and shadcn primitives in `src/components/ui`.
- Reuse current folders before adding new ones. Keep feature-specific components
  with their feature; put shared application compositions in `src/app/components`.
  Do not create empty architecture folders or generic dumping grounds.
- Use the `@/` alias for cross-folder frontend imports and follow nearby relative
  imports within a module. Use `import type` for type-only imports.
- Keep components focused. Extract cohesive repeated UI or substantial behavior;
  do not create a wrapper for every element or a general framework for one use.
- Use typed props and existing domain types. Avoid `any`, unsafe casts, duplicated
  contracts, and suppression comments used to bypass type errors.
- Derive values during render where possible. Use effects for external
  synchronization, not to maintain duplicate derived state. Clean up listeners
  and subscriptions, and use stable domain IDs for list keys.

## Frontend state and dependencies

- Use local React state for local transient UI and the existing Zustand store and
  selectors for shared editor UI. Subscribe to the specific state needed rather
  than the entire store.
- Zustand holds ephemeral UI state such as selection IDs, panels, and dialogs.
  Do not store editable graph copies, nodes, edges, or documents in it.
- Preserve the editor's state ownership: Y.Doc is the editable graph source;
  document-model commands perform durable mutations; React Flow renders derived
  models and reports user intent. Do not bypass these boundaries in UI callbacks.
- Reuse TanStack Router for routing and `@xyflow/react` for canvas interaction.
  Do not implement parallel routing, canvas, persistence, or undo systems.
- Use existing platform adapters and shared package APIs. Do not import backend
  application code or shared-package internals into frontend components.
- Keep secrets out of browser code and `VITE_*` variables. Render user content as
  text; do not introduce raw HTML rendering or execute code-card content.
- Use pnpm and the existing exact-version catalog conventions. Add dependencies
  only when the requested behavior needs them and existing packages cannot serve
  it. Do not mix package managers, add alternate lockfiles, or upgrade unrelated
  packages.

## Examples

```tsx
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Reuse a primitive, its variants, and the existing theme.
<Button type="button" variant="outline" size="sm" onClick={onCancel}>
  Cancel
</Button>;

// Keep conditional utilities complete and statically visible.
<section className={cn('rounded-lg border bg-card p-4', selected && 'ring-2 ring-ring')} />;
```

Avoid a custom `.cancel-button` class, a raw button styled to imitate `Button`, or
inline `backgroundColor`/`padding` for the same UI.

Before handing off, review your changed code against these conventions: reused
components, Tailwind styling, semantic tokens, accessible controls, correct file
ownership, and no duplicate state or unnecessary dependencies. Mention any
necessary exception in the handoff. This guide adds no testing requirements.

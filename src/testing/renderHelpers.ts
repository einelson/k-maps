/** Small helpers for driving react-test-renderer trees in screen/component tests. Test-only. */
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

/** Lets pending promises (database calls, effects) finish and the resulting renders flush. */
export async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Every string rendered anywhere in the tree; sibling strings in one element (`{n} items`) are joined. */
export function renderedTexts(renderer: ReactTestRenderer): string[] {
  const out: string[] = [];
  const walk = (node: ReturnType<ReactTestRenderer['toJSON']>) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    let run = '';
    for (const child of node.children ?? []) {
      if (typeof child === 'string') run += child;
      else walk(child);
    }
    if (run) out.push(run);
  };
  walk(renderer.toJSON());
  return out;
}

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

/** The innermost pressable whose rendered text is (or contains) `label` — what a tap on that text would hit. */
export function pressableWith(renderer: ReactTestRenderer, label: string | RegExp): ReactTestInstance {
  const matches = renderer.root.findAll(
    (node) =>
      typeof node.props.onPress === 'function' &&
      (typeof label === 'string' ? textOf(node).includes(label) : label.test(textOf(node)))
  );
  if (matches.length === 0) throw new Error(`No pressable with text ${String(label)}`);
  return matches[matches.length - 1];
}

/** Every pressable whose rendered text is exactly `text`, in tree order — e.g. each row's "Rename" button. */
export function pressablesNamed(renderer: ReactTestRenderer, text: string): ReactTestInstance[] {
  return renderer.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === text);
}

/** Taps the innermost pressable containing `label`. */
export async function press(renderer: ReactTestRenderer, label: string | RegExp): Promise<void> {
  const target = pressableWith(renderer, label);
  await act(async () => {
    await target.props.onPress();
  });
  await settle();
}

/** Types into the text field with this placeholder (or the nth, when several match). */
export async function typeInto(renderer: ReactTestRenderer, placeholder: string, value: string, nth = 0): Promise<void> {
  const inputs = renderer.root.findAll((node) => node.props.placeholder === placeholder && typeof node.props.onChangeText === 'function');
  if (!inputs[nth]) throw new Error(`No input with placeholder "${placeholder}"`);
  await act(async () => {
    inputs[nth].props.onChangeText(value);
  });
}

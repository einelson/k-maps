import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { SQLiteDatabase } from 'expo-sqlite';

import { createFeature } from '../../data/featuresRepo';
import { addTagToFeature, createTag, listTags, listTagsForFeature } from '../../data/tagsRepo';
import { POINT } from '../../testing/featureFixtures';
import { press, pressablesNamed, renderedTexts, settle, typeInto } from '../../testing/renderHelpers';
import { createTestDb } from '../../testing/sqliteTestDb';
import { TagManagerSheet } from './TagManagerSheet';

let mockDb: SQLiteDatabase;
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));
// The real sheet needs a Modal and safe-area insets; the content is what's under test.
jest.mock('./BottomSheet', () => ({ BottomSheet: ({ visible, children }: { visible: boolean; children: unknown }) => (visible ? children : null) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;
const onChanged = jest.fn();
const onClose = jest.fn();

async function mount() {
  await act(async () => {
    renderer = create(<TagManagerSheet visible onClose={onClose} onChanged={onChanged} />);
  });
  await settle();
}

const has = (text: string) => renderedTexts(renderer).includes(text);
const dbTagNames = async () => (await listTags(mockDb)).map((t) => t.name);

beforeEach(async () => {
  mockDb = createTestDb();
  jest.clearAllMocks();
  // elk on two items, deer on none
  const elk = await createTag(mockDb, 'elk');
  await createTag(mockDb, 'deer');
  const a = await createFeature(mockDb, { geometry: POINT, name: 'a' });
  const b = await createFeature(mockDb, { geometry: POINT, name: 'b' });
  await addTagToFeature(mockDb, a, elk);
  await addTagToFeature(mockDb, b, elk);
});

afterEach(() => {
  act(() => renderer.unmount());
});

describe('TagManagerSheet', () => {
  it('lists every tag with how many items use it', async () => {
    await mount();
    expect(has('elk')).toBe(true);
    expect(has('2 items')).toBe(true);
    expect(has('deer')).toBe(true);
    expect(has('0 items')).toBe(true);
  });

  it('adds a tag without needing any items selected', async () => {
    await mount();
    await typeInto(renderer, 'New tag name…', '  camp ');
    await press(renderer, 'Add');
    expect(await dbTagNames()).toEqual(['camp', 'deer', 'elk']);
    expect(has('camp')).toBe(true);
    expect(onChanged).toHaveBeenCalledWith({});
  });

  it('shows why an add failed and keeps what was typed', async () => {
    await mount();
    await typeInto(renderer, 'New tag name…', 'ELK');
    await press(renderer, 'Add');
    expect(has('A tag named "ELK" already exists')).toBe(true);
    expect(await dbTagNames()).toEqual(['deer', 'elk']);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('renames a tag in place, and its items keep it', async () => {
    await mount();
    // The "Rename" beside elk (the list is alphabetical: deer, elk).
    await act(async () => pressablesNamed(renderer, 'Rename')[1].props.onPress());
    const edit = renderer.root.findAll((n) => n.props.value === 'elk' && typeof n.props.onChangeText === 'function')[0];
    expect(edit).toBeDefined(); // prefilled with the current name
    await act(async () => edit.props.onChangeText('Elk hunting'));
    await press(renderer, 'Save');

    expect(await dbTagNames()).toEqual(['deer', 'Elk hunting']);
    expect(has('Elk hunting')).toBe(true);
    expect(has('2 items')).toBe(true);
    const items = await mockDb.getAllAsync<{ id: number }>('SELECT id FROM features');
    for (const { id } of items) expect((await listTagsForFeature(mockDb, id)).map((t) => t.name)).toEqual(['Elk hunting']);
    expect(onChanged).toHaveBeenCalledWith({});
  });

  it('refuses a rename onto another tag and stays in edit mode with the reason shown', async () => {
    await mount();
    await act(async () => pressablesNamed(renderer, 'Rename')[1].props.onPress());
    const edit = renderer.root.findAll((n) => n.props.value === 'elk' && typeof n.props.onChangeText === 'function')[0];
    await act(async () => edit.props.onChangeText('Deer'));
    await press(renderer, 'Save');
    expect(has('A tag named "Deer" already exists')).toBe(true);
    expect(await dbTagNames()).toEqual(['deer', 'elk']);
    expect(has('Save')).toBe(true); // still editing
  });

  it('asks before deleting, says how many items lose the tag, then removes it and keeps the items', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.text === 'Delete')?.onPress?.();
    });
    await mount();
    await act(async () => pressablesNamed(renderer, 'Delete')[1].props.onPress()); // elk
    await settle();

    expect(alert).toHaveBeenCalledWith(
      'Delete tag "elk"?',
      'It will be removed from 2 items. The items themselves are kept.',
      expect.any(Array)
    );
    expect(await dbTagNames()).toEqual(['deer']);
    expect(has('elk')).toBe(false);
    const items = await mockDb.getAllAsync('SELECT id FROM features');
    expect(items).toHaveLength(2);
    expect(onChanged).toHaveBeenCalledWith({ deletedTagId: expect.any(Number) });
    alert.mockRestore();
  });

  it('cancelling the delete confirmation changes nothing', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await mount();
    await act(async () => pressablesNamed(renderer, 'Delete')[1].props.onPress());
    expect(await dbTagNames()).toEqual(['deer', 'elk']);
    expect(onChanged).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

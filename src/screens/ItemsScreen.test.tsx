import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { SQLiteDatabase } from 'expo-sqlite';

import { createFeature, listFeatures } from '../data/featuresRepo';
import { createFolder, listFolders } from '../data/foldersRepo';
import { EMPTY_FILTERS } from '../state/types';
import { useFiltersStore } from '../state/useFiltersStore';
import { POINT } from '../testing/featureFixtures';
import { press, pressablesNamed, renderedTexts, settle, typeInto } from '../testing/renderHelpers';
import { createTestDb } from '../testing/sqliteTestDb';
import { ItemsScreen } from './ItemsScreen';

let mockDb: SQLiteDatabase;
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));
jest.mock('@react-navigation/native', () => ({
  // Focus effects run on mount and whenever the callback changes, like the real hook does for a focused screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../data/importExport', () => ({ exportFeatures: jest.fn() }));
jest.mock('./components/BottomSheet', () => ({ BottomSheet: ({ visible, children }: { visible: boolean; children: unknown }) => (visible ? children : null) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;
const texts = () => renderedTexts(renderer);
const has = (text: string) => texts().includes(text);

/** Hunting > Elk, plus a top-level Fishing; 'blind' is in Hunting, 'elk camp' in Elk, 'loose' is unfiled. */
let ids: { hunting: number; elk: number; fishing: number; blind: number; elkCamp: number; loose: number };

beforeEach(async () => {
  mockDb = createTestDb();
  useFiltersStore.setState(useFiltersStore.getInitialState(), true);
  const hunting = await createFolder(mockDb, { name: 'Hunting' });
  const elk = await createFolder(mockDb, { name: 'Elk', parentId: hunting });
  const fishing = await createFolder(mockDb, { name: 'Fishing' });
  ids = {
    hunting,
    elk,
    fishing,
    blind: await createFeature(mockDb, { geometry: POINT, name: 'blind', folderId: hunting }),
    elkCamp: await createFeature(mockDb, { geometry: POINT, name: 'elk camp', folderId: elk }),
    loose: await createFeature(mockDb, { geometry: POINT, name: 'loose pin' }),
  };
  await act(async () => {
    renderer = create(<ItemsScreen />);
  });
  await settle();
});

afterEach(() => {
  act(() => renderer.unmount());
  jest.restoreAllMocks();
});

const folderOfItem = async (id: number) => (await listFeatures(mockDb)).find((f) => f.id === id)?.folder_id;
const parentOfFolder = async (id: number) => (await listFolders(mockDb)).find((f) => f.id === id)?.parent_id;

describe('ItemsScreen as a folder browser', () => {
  it('starts at the top level: its folders and unfiled items, not what is inside the folders', () => {
    expect(has('Hunting')).toBe(true);
    expect(has('Fishing')).toBe(true);
    expect(has('loose pin')).toBe(true);
    expect(has('blind')).toBe(false);
    expect(has('elk camp')).toBe(false);
  });

  it('summarises each folder by everything inside it, nested folders included', () => {
    expect(has('2 items · 1 folder')).toBe(true); // Hunting: blind + elk camp, and the Elk folder
    expect(has('0 items')).toBe(true); // Fishing
  });

  it('opens a folder, shows a breadcrumb, and goes deeper and back up', async () => {
    await press(renderer, 'Hunting');
    expect(has('blind')).toBe(true);
    expect(has('Elk')).toBe(true); // the subfolder
    expect(has('loose pin')).toBe(false);
    expect(has('All items')).toBe(true);

    await press(renderer, 'Elk');
    expect(has('elk camp')).toBe(true);
    expect(has('blind')).toBe(false);

    await press(renderer, 'Hunting'); // the breadcrumb, one level up
    expect(has('blind')).toBe(true);
    expect(has('elk camp')).toBe(false);

    await press(renderer, 'All items');
    expect(has('loose pin')).toBe(true);
    expect(has('blind')).toBe(false);
  });

  it('says so when a folder is empty', async () => {
    await press(renderer, 'Fishing');
    expect(has('This folder is empty.')).toBe(true);
  });

  it('creates a folder inside the one being browsed', async () => {
    await press(renderer, 'Hunting');
    await press(renderer, '+ Folder');
    await typeInto(renderer, 'Folder name…', 'Camps');
    await press(renderer, 'Create');

    const camps = (await listFolders(mockDb)).find((f) => f.name === 'Camps');
    expect(camps?.parent_id).toBe(ids.hunting);
    expect(has('Camps')).toBe(true);
  });

  it('shows the reason and keeps the sheet open when the folder name is empty', async () => {
    await press(renderer, '+ Folder');
    await typeInto(renderer, 'Folder name…', '   ');
    await press(renderer, 'Create');
    expect(has('Enter a folder name')).toBe(true);
    expect((await listFolders(mockDb)).length).toBe(3);
  });

  it('renames a folder from its menu', async () => {
    await act(async () => pressablesNamed(renderer, '⋯')[0].props.onPress()); // Fishing (alphabetical: Fishing, Hunting)
    await press(renderer, 'Rename');
    await typeInto(renderer, 'Folder name…', 'Angling');
    await press(renderer, 'Save');
    expect((await listFolders(mockDb)).map((f) => f.name).sort()).toEqual(['Angling', 'Elk', 'Hunting']);
    expect(has('Angling')).toBe(true);
  });

  it('moves a folder into another; the picker never offers the folder itself', async () => {
    await press(renderer, 'Hunting');
    await act(async () => pressablesNamed(renderer, '⋯')[0].props.onPress()); // Elk
    await press(renderer, 'Move to…');
    expect(has('Top level')).toBe(true);
    // Picker rows are labelled with just the folder name (the list rows behind it also carry a subtitle).
    expect(pressablesNamed(renderer, 'Fishing').length).toBe(1); // a valid target is offered
    expect(pressablesNamed(renderer, 'Elk').length).toBe(0); // the folder being moved is not
    await press(renderer, 'Fishing');
    expect(await parentOfFolder(ids.elk)).toBe(ids.fishing);
    expect(has('elk camp')).toBe(false); // Elk is gone from Hunting
  });

  it('deleting a folder asks first, then moves its contents up instead of deleting them', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.text === 'Delete')?.onPress?.();
    });
    await press(renderer, 'Hunting');
    await act(async () => pressablesNamed(renderer, '⋯')[0].props.onPress()); // Elk
    await press(renderer, 'Delete folder');
    await settle();

    expect(alert).toHaveBeenCalledWith(
      'Delete folder "Elk"?',
      'Its 1 item will move up to "Hunting". Nothing else is deleted.',
      expect.any(Array)
    );
    expect((await listFolders(mockDb)).map((f) => f.name).sort()).toEqual(['Fishing', 'Hunting']);
    expect(await folderOfItem(ids.elkCamp)).toBe(ids.hunting); // promoted, not deleted
    expect(has('elk camp')).toBe(true); // now directly in Hunting
  });

  it('searching switches to one flat list across every folder, showing where each item lives', async () => {
    act(() => useFiltersStore.getState().setFilters({ ...EMPTY_FILTERS, text: 'camp' }));
    await settle();
    expect(has('Showing matches from every folder')).toBe(true);
    expect(has('elk camp')).toBe(true);
    expect(texts().some((t) => t.includes('Hunting / Elk'))).toBe(true);
    expect(has('Fishing')).toBe(false); // folders aren't listed while searching
    expect(has('All items')).toBe(false);
  });

  it('a filter on a parent folder finds pins in its subfolders', async () => {
    act(() => useFiltersStore.getState().setFilters({ ...EMPTY_FILTERS, folderIds: [ids.hunting] }));
    await settle();
    expect(has('blind')).toBe(true);
    expect(has('elk camp')).toBe(true);
    expect(has('loose pin')).toBe(false);
  });

  it('has a Tags button that opens the tag manager', async () => {
    await press(renderer, 'Tags');
    expect(has('New tag name…') || texts().includes('Done')).toBe(true);
    expect(pressablesNamed(renderer, 'Done').length).toBeGreaterThan(0);
  });
});

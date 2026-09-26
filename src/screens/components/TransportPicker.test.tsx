import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { TRANSPORT_MODES } from '../../features/transport';
import { pressableWith, renderedTexts } from '../../testing/renderHelpers';
import { TransportChips, TransportSheet } from './TransportPicker';

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined, removeItemSync: () => undefined },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));

const mount = (element: React.ReactElement) => act(() => void (renderer = create(element)));

describe('TransportChips', () => {
  it('shows a chip for every way of getting around', () => {
    mount(<TransportChips value={null} onChange={jest.fn()} />);
    expect(renderedTexts(renderer)).toEqual(TRANSPORT_MODES.map((m) => m.label));
  });

  it('marks the selected chip', () => {
    mount(<TransportChips value="horse" onChange={jest.fn()} />);
    expect(pressableWith(renderer, 'Horse').props.accessibilityState).toEqual({ selected: true });
    expect(pressableWith(renderer, 'On foot').props.accessibilityState).toEqual({ selected: false });
  });

  it('reports the tapped mode', () => {
    const onChange = jest.fn();
    mount(<TransportChips value="foot" onChange={onChange} />);
    act(() => pressableWith(renderer, 'Vehicle').props.onPress());
    expect(onChange).toHaveBeenCalledWith('vehicle');
  });

  it('clears when the selected chip is tapped again', () => {
    const onChange = jest.fn();
    mount(<TransportChips value="foot" onChange={onChange} />);
    act(() => pressableWith(renderer, 'On foot').props.onPress());
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps the selection when clearing is turned off', () => {
    const onChange = jest.fn();
    mount(<TransportChips value="foot" onChange={onChange} allowClear={false} />);
    act(() => pressableWith(renderer, 'On foot').props.onPress());
    expect(onChange).toHaveBeenCalledWith('foot');
  });
});

describe('TransportSheet', () => {
  it('starts recording as soon as a mode is tapped', () => {
    const onSelect = jest.fn();
    mount(<TransportSheet visible onClose={jest.fn()} onSelect={onSelect} />);
    expect(renderedTexts(renderer)).toContain('How are you getting around?');
    act(() => pressableWith(renderer, 'ATV / UTV').props.onPress());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('atv');
  });

  it('closes without choosing on Cancel', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    mount(<TransportSheet visible onClose={onClose} onSelect={onSelect} />);
    act(() => pressableWith(renderer, 'Cancel').props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

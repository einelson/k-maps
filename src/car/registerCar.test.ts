import { Platform } from 'react-native';

import { registerCar } from './registerCar';

const mockRegisterCarApp = jest.fn();
jest.mock('./carApp', () => ({ registerCarApp: () => mockRegisterCarApp() }));

beforeEach(() => {
  mockRegisterCarApp.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('registerCar', () => {
  it('starts the car integration on Android', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    registerCar();
    expect(mockRegisterCarApp).toHaveBeenCalledTimes(1);
  });

  it('does nothing on iOS, where the car library is not linked', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    registerCar();
    expect(mockRegisterCarApp).not.toHaveBeenCalled();
  });

  it('logs instead of crashing the app when the car library cannot start', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockRegisterCarApp.mockImplementation(() => {
      throw new Error('native module not found');
    });
    expect(() => registerCar()).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith('Could not set up the car screen', expect.any(Error));
  });
});

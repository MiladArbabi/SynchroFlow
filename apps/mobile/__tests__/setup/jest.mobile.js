jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => {
  const values = new Map();
  return {
    getItemAsync: jest.fn(async (key) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key, value) => { values.set(key, value); }),
    deleteItemAsync: jest.fn(async (key) => { values.delete(key); }),
    __values: values,
  };
});

if (typeof global.atob !== 'function') {
  global.atob = (value) => Buffer.from(value, 'base64').toString('binary');
}

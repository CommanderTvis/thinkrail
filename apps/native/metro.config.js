const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withSwcTransformer } = require('@react-native-swc/core');
const {resolve} = require('node:path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {watchFolders: [resolve(__dirname, '../../packages/contracts')]};

module.exports = {
  ...withSwcTransformer(mergeConfig(getDefaultConfig(__dirname), config)),
  transformerPath: require.resolve('./metro-transform-worker'),
};

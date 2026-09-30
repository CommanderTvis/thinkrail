const {Buffer} = require('node:buffer');
const path = require('node:path');
const {TraceMap, originalPositionFor} = require('@jridgewell/trace-mapping');
const {transformSync} = require('oxc-transform-react');
const swc = require('@react-native-swc/core/transform-worker');

const sourceRoot = path.join(__dirname, 'src') + path.sep;
const compilerRuntime = 'react/compiler-runtime';

function compile(filename, source, dev) {
  const result = transformSync(filename, source, {
    jsx: 'preserve',
    sourcemap: true,
    reactCompiler: {environment: {enableResetCacheOnSourceFileChanges: dev}},
  });
  if (result.fatal) {
    throw new SyntaxError(
      result.errors.map(error => error.codeframe ?? error.message).join('\n'),
    );
  }
  return result;
}

function remap(mappings, compiledMap) {
  const tracer = new TraceMap(compiledMap);
  return mappings.map(mapping => {
    if (mapping.length < 4) {
      return mapping;
    }
    const [line, column, sourceLine, sourceColumn, ...name] = mapping;
    const original = originalPositionFor(tracer, {
      line: sourceLine,
      column: sourceColumn,
    });
    return original.line == null
      ? [line, column]
      : [line, column, original.line, original.column, ...name];
  });
}

async function transform(config, projectRoot, filename, data, options) {
  const absolute = path.resolve(projectRoot, filename);
  if (!absolute.startsWith(sourceRoot) || !/\.tsx?$/.test(absolute)) {
    return swc.transform(config, projectRoot, filename, data, options);
  }
  const compiled = compile(absolute, data.toString('utf8'), options.dev);
  if (!compiled.code.includes(compilerRuntime)) {
    return swc.transform(config, projectRoot, filename, data, options);
  }
  const result = await swc.transform(
    config,
    projectRoot,
    filename,
    Buffer.from(compiled.code),
    options,
  );
  return {
    ...result,
    output: result.output.map(module => ({
      ...module,
      data: {...module.data, map: remap(module.data.map, compiled.map)},
    })),
  };
}

function getCacheKey(config, options) {
  const {version} = require('oxc-transform-react/package.json');
  return `${swc.getCacheKey(config, options)}$oxc-transform-react@${version}`;
}

module.exports = {transform, getCacheKey};

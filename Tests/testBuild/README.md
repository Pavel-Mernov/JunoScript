# `junode --build` fixtures

Run from the repository root:

```sh
npm run build
node Tests/testBuild/run.cjs
```

The runner builds JS and TS wrappers, runs the CommonJS consumer, checks the
TypeScript consumer with `tsc`, and removes `Tests/testBuild/.generated`.

Fixtures:

- `testBuild.jn` — variables, functions, constructor and static method exports;
- `dependency.jn` + `imports.jn` — relative JN imports and generic constructor;
- `runtimeTypes.jn` — object type defaults and exported JN methods;
- `nativeClass.ts` + `classInterop.jn` — TypeScript class imported as a JN constructor;
- `checkInference.cjs` — regression check that an imported class and its instance do not degrade to `any`;
- `consumeBuilt.cjs` — runtime assertions for generated CommonJS modules;
- `consumeTypes.ts` — TypeScript-side consumption of a generated TS wrapper.

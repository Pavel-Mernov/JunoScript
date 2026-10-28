# JunoScript

JunoScript is an experimental indentation-based language with TypeScript-inspired types.

## Build the `junode` command

Requirements: Node.js and TypeScript (`tsc`, installed globally). From the project directory:

```sh
npm install
npm run build
npm link
```

`npm link` installs the `junode` executable globally through npm. You can then run:

```sh
junode path/to/program.jn arg1 arg2
```

From a checkout without linking, use `npm start -- path/to/program.jn arg1 arg2`.
The program can read the arguments after its file path with `console.args()` from
`juno:node`. For example:

```junoscript
import { console } from 'juno:node'

console.log(console.args())
```

The current `junode` runtime is an early interpreter and supports the subset of
JunoScript represented by the parser AST. It is not yet a complete compiler or
static/runtime type checker.

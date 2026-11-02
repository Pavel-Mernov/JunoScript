/** Standard JunoScript console module; mirrors the JavaScript/TypeScript console. */
import { types } from './types'

export const console = globalThis.console
export { types }

const juno = { 
    console,
    Math,
    types
}
export default juno

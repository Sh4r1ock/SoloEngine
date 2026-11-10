/**
 * Cordis YAML loading shared by repository checks and plain-Node scripts.
 *
 * The one implementation lives here so the audit script (plain `node`) and the TypeScript
 * gates (`scripts/cordis-yaml.ts`) cannot drift apart in `!!js` handling.
 * @module scripts/cordis-yaml
 */

import * as yaml from 'js-yaml'

const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  construct: (data) => {
    if (typeof data !== 'string') throw new TypeError('!!js requires a scalar string')
    return { __jsExpr: data }
  },
})
const schema = yaml.JSON_SCHEMA.extend(jsExprType)

/**
 * Parse a Cordis config while preserving Loader `!!js` expressions as data.
 * @param {string} source - Cordis YAML source text.
 * @returns {unknown} the parsed YAML value.
 */
export function loadCordisYaml(source) {
  return yaml.load(source, { schema })
}

/**
 * Test whether a value is a preserved Loader `!!js` expression.
 * @param {unknown} value - parsed YAML value.
 * @returns {boolean} whether the value is one preserved expression.
 */
export function isJsExpr(value) {
  return typeof value === 'object'
    && value !== null
    && typeof value.__jsExpr === 'string'
}

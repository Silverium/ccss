// @ts-nocheck

import * as t from '@babel/types'
import * as babylon from '@babel/parser'
import traverse from '@babel/traverse'
import './handlers'

const isReactCreateElement = node =>
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    t.isIdentifier(node.callee.object, { name: 'React' }) &&
    t.isIdentifier(node.callee.property, { name: 'createElement' }) &&
    !node.callee.computed

CallExpression(path) {
    const node = getJSXNode(path.node)
    if (node === null) return null
    path.replaceWith(node)
}

const colorRegExp = /^#(?:[0-9a-f]{2}){2,4}$|(#[0-9a-f]{3}$)|(rgb|hsl)a?\((-?\d+%?[,\s]+){2,3}\s*[\d.]+%?\)/g
const isColor = v => typeof v === 'string' && colorRegExp.test(v)
export const collectColors = (input, path = [], all = []) => {
    for (const key of Object.keys(input)) {
        const i = input[key]
        if (isColor(i)) {
            all.push([[...path, key], i])
        } else if (!Array.isArray(i) && typeof i === 'object' && i !== null) {
            collectColors(i, [...path, key], all)
        }
    }
    return all
}

const objectToAST = <T>(literal: T) => {
    if (literal === null) {
        return t.nullLiteral()
    }
    switch (typeof literal) {
        case 'function':
            const ast = babylon.parse(literal.toString(), {
                allowReturnOutsideFunction: true,
                allowSuperOutsideMethod: true
            })
            return traverse.removeProperties(ast)
        case 'number':
            return t.numericLiteral(literal)
        case 'string':
            return t.stringLiteral(literal)
        case 'boolean':
            return t.booleanLiteral(literal)
        case 'undefined':
            return t.unaryExpression('void', t.numericLiteral(0), true)
        default:
            if (Array.isArray(literal)) {
                return t.arrayExpression(literal.map(objectToAST))
            }
            return t.objectExpression(
                Object.keys(literal)
                    .filter(k => {
                        return typeof literal[k] !== 'undefined'
                    })
                    .map(k => {
                        return t.objectProperty(t.stringLiteral(k), objectToAST(literal[k]))
                    })
            )
    }
}

export const isCCSSTag = (path, state) => {
    const nodeName = path.node.name.object?.name || path.node.name.name
    const { identifiers } = state.opts

    return identifiers[nodeName]
}

export const covertToStringLiteralTag = (path, state, tagName) => {
    if (path.node.name?.object?.name) {
        const o = path.node.name.object
        delete path.node.name.object
        delete path.node.name.property
        Object.assign(path.node.name, o)
    }
    path.node.name.name = tagName
}

export const getIdentifierByValueType = (value, t, wrapContainer = true) => {
    if (typeof value === 'string') {
        return t.stringLiteral(value)
    }

    if (typeof value === 'boolean') {
        if (wrapContainer) {
            return t.jsxExpressionContainer(t.booleanLiteral(value))
        }
        return t.booleanLiteral(value)
    }

    if (typeof value === 'number') {
        if (wrapContainer) {
            return t.jsxExpressionContainer(t.numericLiteral(value))
        }
        return t.numericLiteral(value)
    }

    if (Array.isArray(value)) {
        const v = t.arrayExpression(value.map(v => getIdentifierByValueType(v, t, false)))
        if (wrapContainer) {
            return t.jsxExpressionContainer(v)
        }
        return v
    }

    if (typeof value === 'object') {
        const v = objectToAST(value)
        if (wrapContainer) {
            return t.jsxExpressionContainer(v)
        }
        return v
    }

    return value
}

export const isAttrValueString = attr => attr.value && attr.value.type === 'StringLiteral'
export const isAttrValueSingleStringLiteral = attr =>
    attr.value &&
    attr.value?.expression?.type === 'TemplateLiteral' &&
    attr.value.expression.expressions.length === 0 &&
    attr.value.expression.quasis.length === 1 &&
    typeof attr.value.expression.quasis?.[0].value.raw === 'string' &&
    attr.value.expression.quasis[0].value.raw === attr.value.expression.quasis[0].value.cooked
export const isAttrValueNumeric = attr => attr.value && attr.value?.expression?.type === 'NumericLiteral'
export const isAttrArray = attr => attr?.value?.expression?.type === 'ArrayExpression'
export const isAttrObject = attr => attr?.value?.expression?.type === 'ObjectExpression'

export const resolveConstantExpression = (value, state) => {
    const { constants } = state.opts

    // Nothing to resolve...
    if (!constants || value.computed) return

    let obj = value
    const path = []
    while (obj) {
        obj.name && path.push(obj.name)
        obj.property?.name && path.push(obj.property.name)
        obj = obj.object
    }
    path.reverse()

    // Not a constant or no such constant was found
    if (path.length === 0 || !constants[path[0]]) return

    let v = constants
    let key

    while ((key = path.shift())) {
        // No such constant found, quit
        if (!v.hasOwnProperty(key)) return
        v = v[key]
    }
    return v
}

const walkTree = (value, cb, method = 'forEach') => {
    const v = value
    //console.log('methodman', method, v.type)
    if (v.type === 'ObjectExpression') {
        //console.log(method, typeof value, v.properties)
        const newProps = v.properties[method](v => {
            //console.log(v)
            const ret = walkTree(v, cb, method)
            //console.log('ret', method, ret, v)
            return ret
        })
        //console.log(newProps)
        v.properties = (newProps || v.properties).filter(Boolean)
        return v
    } else if (v.type === 'ArrayExpression') {
        v.elements = (v.elements[method](v => walkTree(v, cb, method)) || v.elements).filter(Boolean)
        return v
    } else if (v.type === 'ObjectProperty') {
        v.value = walkTree(v.value, cb, method) || v.value
        return v
    } else {
        return cb(value)
    }
}

const resolveConstantsInTree = (value, state, t) => {
    walkTree(
        value,
        v => {
            const resolved = resolveConstantExpression(v, state)
            if (resolved) {
                return getIdentifierByValueType(resolved, t, false)
            }
            return v
        },
        'map'
    )
}

const isValueTreeStatic = (value, t) => {
    let foundDynamic = false
    walkTree(value, v => {
        foundDynamic =
            foundDynamic ||
            (!t.isNumericLiteral(v) &&
                !t.isStringLiteral(v) &&
                !(t.isUnaryExpression(v) && t.isNumericLiteral(v.argument)))
    })
    return !foundDynamic
}

const extractStaticValuesFromArray = (value, state, t, isCCSSContext) => {
    const extracted = []

    value.elements = value.elements.filter(v => {
        if (t.isNumericLiteral(v) || t.isStringLiteral(v)) {
            extracted.push(v.value)
            return false
        } else if (t.isUnaryExpression(v) && t.isNumericLiteral(v.argument)) {
            extracted.push(v.argument.value * -1)
            return false
        } else if (t.isArrayExpression(v)) {
            const ext = extractStaticValues(v, state, t, isCCSSContext)
            if (ext.length) {
                extracted.push(ext)
            }
            return !!v.elements.length
        } else if (t.isObjectExpression(v)) {
            const ext = extractStaticValues(v, state, t, isCCSSContext)
            if (Object.keys(ext).length) {
                extracted.push(ext)
            }
            return !!v.properties.length
        }
        return true
    })

    return extracted
}

const extractStaticValuesFromObject = (value, state, t, isCCSSContext) => {
    const extracted = {}

    value.properties = value.properties.filter(v => {
        const _value = v.value
        const _key = v.key.name || v.key.value
        const ccssProp = state.opts.ccssPropMap[_key]

        if (t.isNumericLiteral(_value) || t.isStringLiteral(_value)) {
            extracted[(isCCSSContext && ccssProp?.camelShort) || _key] = v.value.value
            return false
        } else if (t.isUnaryExpression(_value) && t.isNumericLiteral(_value.argument)) {
            extracted[(isCCSSContext && ccssProp?.camelShort) || _key] = v.value.argument.value * -1
            return false
        } else if (t.isArrayExpression(_value)) {
            if (isCCSSContext && ccssProp) {
                const { pureValue } = ccssProp.processor.babelPluginHandler(
                    {
                        name: { name: _key },
                        value: { expression: _value },
                        realValue: _value
                    },
                    state,
                    t,
                    api
                )
                extracted[ccssProp.camelShort] = pureValue
            } else {
                const ext = extractStaticValues(_value, state, t)
                if (ext.length) {
                    extracted[_key] = ext
                }
            }
            return _value.elements.length
        } else if (t.isObjectExpression(_value)) {
            if (ccssProp && ccssProp) {
                const { pureValue } = ccssProp.processor.babelPluginHandler(
                    {
                        name: { name: _key },
                        value: { expression: _value },
                        realValue: _value
                    },
                    state,
                    t,
                    api
                )
                extracted[ccssProp.camelShort] = pureValue
            } else {
                // If there is no such ccss prop but this is a ccss context, pass it
                const ext = extractStaticValues(_value, state, t, isCCSSContext)
                if (Object.keys(ext).length) {
                    extracted[_key] = ext
                }
            }
            return _value.properties.length
        } else if (isCCSSContext && ccssProp) {
            if (v.key.name) {
                v.key.name = ccssProp.camelShort
            } else {
                v.key.value = ccssProp.camelShort
            }
        }
        return true
    })

    return extracted
}

const extractStaticValues = (value, state, t, isCCSSContext) => {
    if (t.isObjectExpression(value)) {
        return extractStaticValuesFromObject(value, state, t, isCCSSContext)
    } else if (t.isArrayExpression(value)) {
        return extractStaticValuesFromArray(value, state, t, isCCSSContext)
    }
}

export const getAttrDetails = (attr, state, t) => {
    const name = attr.name.name
    let realValue =
        attr.value?.expression?.type === 'JSXExpressionContainer'
            ? attr.value.expression.value.expression
            : attr?.value?.expression || attr.value

    if (realValue === null) {
        realValue = t.booleanLiteral(true)
    }

    attr.realValue = realValue
    const resolved = resolveConstantExpression(realValue, state)

    if (resolved) {
        attr.value = getIdentifierByValueType(resolved, t)

        realValue = attr.realValue = attr.value.expression || attr.value
    } else {
        resolveConstantsInTree(realValue, state, t)
    }

    switch (true) {
        case isAttrValueString(attr): {
            const pureValue = attr.value.value
            return {
                name,
                pureValue,
                ccssValue: { [name]: pureValue },
                isStatic: true
            }
        }
        case isAttrValueSingleStringLiteral(attr): {
            const pureValue = attr.value.expression.quasis[0].value.cooked
            return {
                name,
                pureValue,
                ccssValue: { [name]: pureValue },
                isStatic: true
            }
        }
        case isAttrValueNumeric(attr): {
            const pureValue = attr.value.expression.value
            return {
                name,
                pureValue,
                ccssValue: { [name]: pureValue },
                isStatic: true
            }
        }
        case t.isUnaryExpression(attr.realValue) && t.isNumericLiteral(attr.realValue.argument): {
            const pureValue = attr.realValue.argument.value
            return {
                name,
                pureValue: pureValue * -1,
                ccssValue: { [name]: pureValue * -1 },
                isStatic: true
            }
        }
        case isAttrObject(attr):
        case isAttrArray(attr): {
            const handler = attr.descriptor.processor.babelPluginHandler

            return {
                name,
                ...handler(attr, state, t, api, attr.descriptor.processor.babelPluginCCSSContext)
            }
        }
        case t.isBooleanLiteral(realValue): {
            return {
                name,
                pureValue: realValue.value,
                ccssValue: { [name]: realValue.value },
                isStatic: true
            }
        }
    }
}

const api = {
    isCCSSTag,
    isAttrArray,
    isAttrObject,
    isAttrValueNumeric,
    isAttrValueSingleStringLiteral,
    isAttrValueString,
    isValueTreeStatic,
    extractStaticValues
}

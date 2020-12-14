import * as t from '@babel/types'
import traverse from '@babel/traverse'
import ExtractorAbstract from './abstract'
import Processor from '@/processor'
import * as handlers from '@/handlers'

export default class CCSSExtractor extends ExtractorAbstract {
    classNames: string[] = []
    styleProps: [string, string][] = []
    classNameProp
    styleProp

    onCallExpression(processor: Processor) {
        super.onCallExpression(processor)

        // Clear
        this.classNames = []
        this.styleProps = []

        // Filter and remove CCSS Props
        processor.walkProperties('filter', this.processProp)
        // Save classNames
        this.classNames.length && this.addClassNames(this.classNames, this.classNameProp)
        // Save style props
        this.styleProps.length && this.addStyleProps(this.styleProps, this.styleProp)

        // Convert from component to DOM element (only if prop is not a variable either)
        if (!processor.path.isComputed && !t.isIdentifier(processor.path.node.arguments[1])) {
            this.toDOM(processor)
        }
    }
    processProp = (path, prop) => {
        const propName = prop.key.name || prop.key.value
        const { processor } = this

        if (propName === 'style') {
            this.styleProp = prop
        } else if (propName === 'className') {
            this.classNameProp = prop
        }

        // Not a CCSSProp, we need to keep it as-is
        if (!processor.isCCSSProp(propName)) {
            path.skip()
            return true
        }

        const ccssDescriptor = processor.ccss.registry.get(propName)

        // Check all properties
        // If we find a non-CSS context property with dynamic value, we skip, we cannot extract that
        traverse(
            prop.value,
            {
                ObjectProperty(p) {
                    const propName = p.node.key.name || p.node.key.value
                    const ccssDescriptor = processor.ccss.registry.get(propName)

                    if (
                        ccssDescriptor &&
                        ccssDescriptor.ccssContext === false &&
                        !processor.isValueTreeStatic(p.node)
                    ) {
                        prop.noExtract = true
                        p.stop()
                    }
                }
            },
            processor.path,
            processor.path.scope
        )

        // Leave this prop as is
        if (prop.noExtract) {
            // Flag it as computed so dom won't be converted
            processor.setComputed(true)
            path.skip()
            return true
        }

        // Prop has its own extractor
        if (ccssDescriptor.babelPluginHandler) {
            const handler =
                typeof ccssDescriptor.babelPluginHandler === 'string'
                    ? handlers[ccssDescriptor.babelPluginHandler]
                    : ccssDescriptor.babelPluginHandler
            handler(processor, prop, this)
        }

        const { isComputed, ccssString, pureValue, cssVarName } = processor.getPropDescriptor(prop, () => {
            const cssVarName = this.getCSSVar(prop.key.name || prop.key.value)
            const cssVar = `var(${cssVarName})`
            return {
                cssVar,
                cssVarName,
                pureValue: cssVar,
                ccssValue: { [propName]: cssVar },
                ccssString: processor.ccss.toValue(propName, cssVar)
            }
        })
        console.log(ccssString)
        const className = this.getClassName(propName, pureValue, ccssString)
        this.classNames.push(className)

        // Not computed, we're done
        if (!isComputed) return

        // Computed, move value into variable and assign it to a CSS variable
        const variableId = processor.createVariable(prop)
        this.styleProps.push([cssVarName, variableId])
    }
}

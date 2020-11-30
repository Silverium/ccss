import * as t from '@babel/types'
import ExtractorAbstract from './abstract'
import Processor from '@/processor'

export default class CCSSExtractor extends ExtractorAbstract {
    classNames: string[] = []
    styleProps: [string, string][] = []

    onCallExpression(processor: Processor) {
        super.onCallExpression(processor)

        // Clear
        this.classNames = []
        this.styleProps = []

        // Only loop of it has props
        if (processor.properties) {
            // Filter and remove CCSS Props
            processor.properties = processor.properties.filter(this.processProp)
            // Save classNames
            this.classNames.length && this.addClassNames(this.classNames)
            // Save style props
            this.styleProps.length && this.addStyleProps(this.styleProps)
        }

        // Convert from component to DOM element
        if (!processor.path.isComputed) {
            this.toDOM(processor)
        }
    }
    processProp = prop => {
        const propName = prop.key.name
        const { processor } = this

        // Not a CCSSProp, we need to keep it as-is
        if (!processor.isCCSSProp(propName)) return true

        const ccssDescriptor = processor.ccss.registry.get(propName)

        // Prop has its own extractor
        if (ccssDescriptor.babelPluginHandler) {
            ccssDescriptor.babelPluginHandler(processor, prop, this)
        }

        const { isComputed, ccssString, pureValue, cssVarName } = processor.getPropDescriptor(prop, () => {
            const cssVarName = this.getCSSVar(prop.key.name)
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